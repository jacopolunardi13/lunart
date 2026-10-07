/**
 * A booking is not always one room.
 *
 * Booking.com sold seven adults the whole floor: booking 5639466196, Bina Kang,
 * 25 to 27 October, rooms 305, 302, 303 and 304. QuoVai's notification lists all
 * four. The parser kept the first number it found, the canonical reservation had
 * one `room` field to put it in, and from there everything downstream believed
 * it — the Staff app printed "Camera 305 · 7 ospiti", the guide email said Camera
 * 305, and a breakfast ordered without a room was filed against 305 as well.
 *
 * None of that is a display bug. A tray goes to the wrong door, and the order's
 * own record says the guest asked for it there. So what these tests pin down is
 * the shape of the truth: every room read from the table and no others, one field
 * that names a room only when there is exactly one to name, and a checkout that
 * refuses to pick on the guest's behalf.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseQuovaiEmail } from '../server/ingest/quovai-email.js';
import { repairFromMailbox } from '../server/ingest/repair.js';
import { createMemoryMailbox } from '../server/ingest/mailbox.js';
import { ingestEvent, ingestMessage } from '../server/ingest/index.js';
import { createStore } from '../server/store.js';
import { createMockStripe } from '../server/stripe.js';
import { createApp, roomForOrder } from '../server/app.js';
import {
  buildReservation, guestContext, staffView, roomPhrase, changesBetween,
  RESERVATION_STATUS,
} from '../server/reservations.js';
import { renderGuideEmail, DELIVERY_STATUS } from '../server/delivery.js';
import { passForReservation } from '../server/pass.js';
import { syncOverview } from '../server/staff.js';
import { reconcile } from '../server/ingest/ical.js';
import { previewGuideCatchUp } from '../server/catchup.js';
import { roomsOf, roomList, roomFields, isMultiRoom, ROOM_IDS } from '../commerce/rooms.js';
import { applyPriceOverrides } from '../commerce/prices.js';
import { DEV_PRICES } from '../commerce/prices.dev.js';
import { propertyDate, addDays } from '../commerce/time.js';
import { BINA, BINA_MODIFIED, IRENE, MARTIN, KELLY, FLORIAN } from './fixtures/quovai.js';

const store = () => createStore();
const BINA_ROOMS = ['302', '303', '304', '305'];

/* ══ A/B. The room table, all of it and only it ═══════════════════════════ */

test('A the parser reads every room on the real four-room booking', () => {
  const parsed = parseQuovaiEmail(BINA);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  assert.equal(parsed.event.booking_reference, '5639466196');
  assert.equal(parsed.event.adults, 7);
  assert.equal(parsed.event.check_in, '2026-10-25');
  assert.equal(parsed.event.check_out, '2026-10-27');

  assert.deepEqual(parsed.event.rooms, BINA_ROOMS, 'all four, in a deterministic order');
  assert.equal(parsed.event.room, '', 'and no single room, because there is not one');
  assert.ok(!parsed.warnings.includes('no-room'));
});

test('B the per-night price table adds no rooms, and a price is not a room', () => {
  const parsed = parseQuovaiEmail(BINA);

  // The fixture's price table repeats all four numbers, twice each.
  assert.equal(parsed.event.rooms.length, 4, 'no duplicates, and nothing extra');
  assert.equal(new Set(parsed.event.rooms).size, 4);

  // `302,00` is a total in this table. It must not read as room 302 by itself.
  const priceOnly = parseQuovaiEmail({
    subject: '🔔 QuoVai — nuova prenotazione',
    from: 'QuoVai <noreply@quovai.com>',
    messageId: '<price-only@quovai.com>',
    body: [
      'Numero prenotazione: 9999999999 NEW', 'Prova Prezzo',
      'Struttura: LUNART', 'Check-in: 25/10/2026', 'Check-out: 27/10/2026',
      'Stanza', 'Tariffa', 'Prezzo totale', 'Stato',
      '302,00', '1.304,50', '305,00', 'new',
    ].join('\n'),
  });
  assert.equal(priceOnly.ok, true);
  assert.deepEqual(priceOnly.event.rooms, [], 'three amounts, no rooms');
  assert.ok(priceOnly.warnings.includes('no-room'));
});

test('B a room in a guest note is still not a room', () => {
  const parsed = parseQuovaiEmail({
    subject: '🔔 QuoVai — nuova prenotazione',
    from: 'QuoVai <noreply@quovai.com>',
    messageId: '<note@quovai.com>',
    body: [
      'Numero prenotazione: 8888888888 NEW', 'Nota Ospite',
      'Struttura: LUNART', 'Check-in: 25/10/2026', 'Check-out: 27/10/2026',
      'Note: 301 would be lovely if it is free',
      'Stanza', 'Tariffa', 'Stato',
      '303 sup', '303 sup /NR BB OTA', 'new',
    ].join('\n'),
  });
  assert.deepEqual(parsed.event.rooms, ['303'], 'the table, not the request');
});

test('B the same rooms in another order are not a change', () => {
  const held = buildReservation(parseQuovaiEmail(BINA).event);
  const again = parseQuovaiEmail(BINA_MODIFIED).event;

  assert.deepEqual(again.rooms, held.rooms, 'normalised, so the order QuoVai sent does not matter');
  assert.deepEqual(changesBetween(held, again), {}, 'and nothing reads as modified');

  // A room genuinely dropped from the booking does read as a change, both fields.
  const fewer = changesBetween(held, { rooms: ['302', '303'] });
  assert.deepEqual(fewer, { rooms: ['302', '303'], room: '' });
  // And down to one room, which fills the legacy field again.
  assert.deepEqual(changesBetween(held, { rooms: ['303'] }), { rooms: ['303'], room: '303' });
  // A notification that carried no room at all changes nothing.
  assert.deepEqual(changesBetween(held, { room: '' }), {});
});

/* ══ C. The canonical invariant ═══════════════════════════════════════════ */

test('C a multi-room reservation holds every room and names none of them as the room', async () => {
  const db = store();
  const { reservation } = await ingestMessage({ store: db, message: BINA });

  assert.deepEqual(reservation.rooms, BINA_ROOMS);
  assert.equal(reservation.room, '', 'not 305, which is the bug this is about');
  assert.equal(reservation.guest_count, 7);
  assert.equal(isMultiRoom(reservation), true);
});

test('C a single-room reservation is exactly as it was', async () => {
  const db = store();
  const { reservation } = await ingestMessage({ store: db, message: IRENE });
  assert.equal(reservation.room, '302');
  assert.deepEqual(reservation.rooms, ['302']);
  assert.equal(isMultiRoom(reservation), false);
});

test('C a legacy record with only a room reads as one room', () => {
  const legacy = buildReservation({ room: '304', check_in: '2026-10-02', check_out: '2026-10-03' });
  assert.deepEqual(legacy.rooms, ['304']);
  assert.equal(legacy.room, '304');

  // And a record from before `rooms` existed, read straight out of the store.
  const stored = { room: '305' };
  assert.deepEqual(roomsOf(stored.rooms ?? stored.room), ['305']);
});

test('C a room nobody recognises is kept rather than discarded', () => {
  const typed = buildReservation({ room: 'Suite', check_in: '2026-10-02', check_out: '2026-10-03' });
  assert.equal(typed.room, 'Suite', 'a hand-typed value is not lost');
  assert.deepEqual(typed.rooms, []);
});

test('C the room set is unique, valid and ordered however it arrives', () => {
  assert.deepEqual(roomsOf(['305 sup', '302 queen', '305', '304', '303 sup']), BINA_ROOMS);
  assert.deepEqual(roomsOf(['307', '299', '3050', 'nothing']), [], 'only LunArt rooms');
  assert.deepEqual(roomFields(['305']), { rooms: ['305'], room: '305' });
  assert.deepEqual(roomFields(['305', '302']), { rooms: ['302', '305'], room: '' });
  assert.deepEqual(ROOM_IDS, ['301', '302', '303', '304', '305', '306']);
});

/* ══ D. Staff ════════════════════════════════════════════════════════════ */

test('D the staff view carries the set, and the phrase is plural', async () => {
  const db = store();
  const { reservation } = await ingestMessage({ store: db, message: BINA });
  const view = staffView(reservation);

  assert.deepEqual(view.rooms, BINA_ROOMS);
  assert.equal(view.room, '');
  assert.equal(
    roomPhrase(view, { one: 'Camera', many: 'Camere' }),
    'Camere 302, 303, 304 e 305',
  );
  assert.notEqual(roomPhrase(view, { one: 'Camera', many: 'Camere' }), 'Camera 305');
});

test('D a single-room staff row still reads "Camera 302"', async () => {
  const db = store();
  const { reservation } = await ingestMessage({ store: db, message: IRENE });
  assert.equal(roomPhrase(staffView(reservation), { one: 'Camera', many: 'Camere' }), 'Camera 302');
});

test('D the sync screen does not ask staff to go and find a room that is there', async () => {
  const db = store();
  const { reservation } = await ingestMessage({ store: db, message: BINA });
  const overview = await syncOverview({ store: db });
  const row = overview.rows.find((entry) => entry.reservation_id === reservation.id);

  assert.ok(row, 'the booking is on the sync screen');
  assert.ok(!row.problems.includes('no-room'), `four rooms is not no room: ${row.problems}`);
  assert.deepEqual(row.rooms, BINA_ROOMS);
  assert.equal(row.room, '302, 303, 304 e 305');
});

/* ══ E. The guest, and the email ═════════════════════════════════════════ */

test('E the guest context names the rooms and claims none of them as the room', async () => {
  const db = store();
  const { reservation } = await ingestMessage({ store: db, message: BINA });
  const context = guestContext(reservation);

  assert.equal(context.room, null, 'null rather than 305');
  assert.deepEqual(context.rooms, BINA_ROOMS);
  assert.equal(context.guest_count, 7);

  // And nothing in it says room 305 on its own.
  assert.ok(!JSON.stringify(context).includes('"room":"305"'));
});

test('E the guide email says Camere, in both languages', async () => {
  const db = store();
  const { reservation } = await ingestMessage({ store: db, message: BINA });

  const it = renderGuideEmail({ reservation, origin: 'https://g.example', lang: 'it' });
  assert.match(it.text, /Camere 302, 303, 304 e 305/);
  assert.ok(!/Camera 305/.test(it.text), 'and never the single room');
  assert.match(it.html, /Camere 302, 303, 304 e 305/);

  const en = renderGuideEmail({ reservation, origin: 'https://g.example', lang: 'en' });
  assert.match(en.text, /Rooms 302, 303, 304 and 305/);
});

test('E a single-room email is unchanged', async () => {
  const db = store();
  const { reservation } = await ingestMessage({ store: db, message: IRENE });
  const it = renderGuideEmail({ reservation, origin: 'https://g.example', lang: 'it' });
  assert.match(it.text, /^Camera 302$/m);
  assert.match(renderGuideEmail({ reservation, origin: 'https://g.example', lang: 'en' }).text, /^Room 302$/m);
});

test('E the Pass carries the set and its face names no single room', async () => {
  const db = store();
  const { reservation } = await ingestMessage({ store: db, message: BINA });
  const pass = await passForReservation({ store: db, reservation });

  assert.equal(pass.room, null, 'the artwork has a line for a number, not a list');
  assert.deepEqual(pass.rooms, BINA_ROOMS);
  // Nothing about the Pass itself moved.
  assert.equal(pass.tier, 'pass', 'still a standard Pass, not upgraded by having four rooms');
  assert.deepEqual(pass.entitlements, []);
  assert.equal(pass.reference, reservation.staff_ref);
});

test('E the catch-up preview names the rooms it would write about', async () => {
  const db = store();
  const now = new Date('2026-10-23T08:00:00Z');
  const { reservation } = await ingestMessage({ store: db, message: BINA });
  await db.reservations.update(reservation.id, { guest_email: 'bina@example.invalid' });

  const preview = await previewGuideCatchUp({ store: db, now });
  const row = preview.rows.find((entry) => entry.reservation_id === reservation.id);
  assert.ok(row, `not eligible: ${JSON.stringify(preview.breakdown)}`);
  assert.equal(row.room, '302, 303, 304 e 305');
  assert.deepEqual(row.rooms, BINA_ROOMS);
});

/* ══ F. One room still behaves as one room ═══════════════════════════════ */

test('F every single-room notification parses exactly as before', () => {
  for (const [fixture, room] of [[MARTIN, '304'], [KELLY, '305'], [IRENE, '302'], [FLORIAN, '305']]) {
    const parsed = parseQuovaiEmail(fixture);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.event.room, room);
    assert.deepEqual(parsed.event.rooms, [room]);
  }
});

test('F one room reads as one room everywhere', async () => {
  const db = store();
  const { reservation } = await ingestMessage({ store: db, message: MARTIN });

  assert.equal(guestContext(reservation).room, '304');
  assert.deepEqual(guestContext(reservation).rooms, ['304']);
  assert.equal(staffView(reservation).room, '304');
  assert.equal((await passForReservation({ store: db, reservation })).room, '304');
  assert.equal(roomList(['304']), '304', 'and the list of one is just the number');
});

/* ══ G/H/I. Checkout ═════════════════════════════════════════════════════ */

test('G a multi-room booking gets no automatic room, and a single-room one still does', () => {
  const many = { rooms: BINA_ROOMS, room: '' };
  const one = { rooms: ['302'], room: '302' };

  assert.deepEqual(roomForOrder({ claimed: '', lines: [{}], reservation: many }),
    { ok: true, room: '', rooms: BINA_ROOMS });
  assert.deepEqual(roomForOrder({ claimed: '', lines: [{}], reservation: one }),
    { ok: true, room: '302' });
  // No reservation at all: the guest's own answer is the only one there is.
  assert.deepEqual(roomForOrder({ claimed: '303', lines: [], reservation: null }),
    { ok: true, room: '303' });
});

test('H a room the guest names from their own group is accepted', () => {
  const many = { rooms: BINA_ROOMS, room: '' };
  assert.deepEqual(roomForOrder({ claimed: '303', lines: [], reservation: many }),
    { ok: true, room: '303', rooms: BINA_ROOMS });
  // Named on the line rather than in the customer details.
  assert.deepEqual(roomForOrder({ claimed: '', lines: [{ room: '304' }], reservation: many }),
    { ok: true, room: '304', rooms: BINA_ROOMS });
});

test('I a room outside the group is refused', () => {
  const many = { rooms: BINA_ROOMS, room: '' };
  for (const bad of [{ claimed: '301' }, { lines: [{ room: '301' }] }, { claimed: '999' }]) {
    const verdict = roomForOrder({ claimed: '', lines: [], ...bad, reservation: many });
    assert.equal(verdict.ok, false, JSON.stringify(bad));
    assert.equal(verdict.reason, 'room-not-in-reservation');
  }
});

test('G checkout over HTTP never files a multi-room guest against one room', async (t) => {
  applyPriceOverrides(DEV_PRICES);
  t.after(() => applyPriceOverrides({}));

  const db = store();
  const day = addDays(propertyDate(), 2);
  const { reservation } = await ingestEvent({
    store: db,
    event: {
      kind: 'new', source: 'quovai', booking_reference: '5639466196',
      first_name: 'Bina', last_name: 'Kang', guest_email: 'bina@example.invalid',
      rooms: BINA_ROOMS, adults: 7, guest_count: 7,
      check_in: propertyDate(), check_out: addDays(propertyDate(), 4),
      message_id: '<bina-http@quovai>',
    },
  });

  const app = await createApp({
    store: db, stripe: createMockStripe(), allowPlaceholderPrices: true,
    cardSigningKey: 'multi-room-test-key', staffToken: '', mode: 'development',
    publicUrl: 'http://127.0.0.1',
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const checkout = async (body) => {
    const response = await fetch(`${base}/api/checkout`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };

  const CUSTOMER = { name: 'Bina Kang', email: 'bina@example.invalid' };
  const card = {
    productId: 'privilege-card', variantId: '2d', quantity: 1,
    date: day, fields: { holderName: 'Bina Kang' },
  };

  // Nothing named: nothing guessed.
  const quiet = await checkout({ guideToken: reservation.guide_token, lang: 'it', customer: CUSTOMER, lines: [card] });
  assert.ok(quiet.body.accessToken, `refused: ${JSON.stringify(quiet.body)}`);
  const quietOrder = await db.orders.findByAccessToken(quiet.body.accessToken);
  assert.equal(quietOrder.customer.room, '', 'not 305');
  assert.equal(quietOrder.reservation_id, reservation.id, 'and still filed against the stay');

  // One of theirs: taken.
  const theirs = await checkout({
    guideToken: reservation.guide_token, lang: 'it',
    customer: { ...CUSTOMER, room: '303' },
    lines: [{ productId: 'light-breakfast', quantity: 1, date: day, slotId: 'b-0900', room: '303' }],
  });
  assert.ok(theirs.body.accessToken, `refused: ${JSON.stringify(theirs.body)}`);
  assert.equal((await db.orders.findByAccessToken(theirs.body.accessToken)).customer.room, '303');

  // Somebody else's: refused, before any order exists.
  const before = (await db.orders.list({})).length;
  const other = await checkout({
    guideToken: reservation.guide_token, lang: 'it',
    customer: { ...CUSTOMER, room: '301' },
    lines: [{ productId: 'light-breakfast', quantity: 1, date: day, slotId: 'b-0900', room: '301' }],
  });
  assert.equal(other.status, 422);
  assert.equal(other.body.error, 'room-not-in-reservation');
  assert.equal(other.body.room, '301');
  assert.equal((await db.orders.list({})).length, before, 'and nothing was written');
});

/* ══ J/K. Repairing the record that is already in production ═════════════ */

test('J the repair turns the already-filed room 305 into all four, in place', async () => {
  const db = store();

  /**
   * The record exactly as the old parser left it: one room, seven adults. This is
   * what production holds for booking 5639466196 right now.
   */
  const filed = await db.reservations.create(buildReservation({
    source: 'quovai', booking_reference: '5639466196',
    first_name: 'Bina', last_name: 'Kang',
    check_in: '2026-10-25', check_out: '2026-10-27',
    adults: 7, guest_count: 7, room: '305', channel: 'BOOKING.COM',
  }));
  assert.equal(filed.room, '305');
  assert.deepEqual(filed.rooms, ['305'], 'the old shape, read forward');

  const outcome = await repairFromMailbox({
    store: db, mailbox: createMemoryMailbox([BINA]),
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.matched, 1);
  assert.equal(outcome.repaired, 1);
  assert.equal(outcome.unmatched, 0);
  assert.ok(outcome.changes[0].fields.includes('rooms'));
  assert.ok(outcome.changes[0].fields.includes('room'));

  const fixed = await db.reservations.get(filed.id);
  assert.deepEqual(fixed.rooms, BINA_ROOMS);
  assert.equal(fixed.room, '', 'and no misleading single room is left behind');
  assert.equal(fixed.booking_reference, '5639466196', 'the external identity is untouched');
  assert.equal(fixed.guest_count, 7);
  assert.match(
    (fixed.history ?? []).map((entry) => entry.detail).join(' '),
    /room/,
    'and the correction is written down',
  );

  // Running it again finds nothing left to do.
  const second = await repairFromMailbox({ store: db, mailbox: createMemoryMailbox([BINA]) });
  assert.equal(second.repaired, 0);
  assert.equal(second.unchanged, 1);
});

test('K the repair rotates no token, creates no reservation and sends no email', async () => {
  const db = store();
  const filed = await db.reservations.create(buildReservation({
    source: 'quovai', booking_reference: '5639466196',
    first_name: 'Bina', last_name: 'Kang', guest_email: 'bina@example.invalid',
    check_in: '2026-10-25', check_out: '2026-10-27',
    adults: 7, guest_count: 7, room: '305',
  }));
  // A guest who has already had the email, so the repair has something to spare.
  await db.deliveries.create({
    reservation_id: filed.id, to: filed.guest_email, lang: 'it',
    send_at: '2026-10-22T08:00:00.000Z', status: DELIVERY_STATUS.sent,
    attempts: 1, sent_at: '2026-10-22T08:00:01.000Z', provider: 'gmail', error: null,
  });
  await db.reservations.update(filed.id, { guide_email_status: DELIVERY_STATUS.sent });

  await repairFromMailbox({ store: db, mailbox: createMemoryMailbox([BINA]) });

  const after = await db.reservations.get(filed.id);
  assert.equal(after.guide_token, filed.guide_token, 'the link a guest may already hold');
  assert.equal(after.staff_ref, filed.staff_ref);
  assert.equal(after.guide_created_at, filed.guide_created_at);
  assert.equal(after.check_in, '2026-10-25', 'the dates are not a repair’s business');
  assert.equal(after.check_out, '2026-10-27');
  assert.equal(after.status, filed.status, 'and a repair is not a modification');

  assert.equal((await db.reservations.list({})).length, 1, 'no second reservation');
  const deliveries = await db.deliveries.list({});
  assert.equal(deliveries.length, 1, 'no second delivery');
  assert.equal(deliveries[0].status, DELIVERY_STATUS.sent, 'and nothing was re-sent');
  assert.equal(after.guide_email_status, DELIVERY_STATUS.sent);
});

/* ══ The calendar, which must not adopt half a booking ═══════════════════ */

test('a single-room calendar entry is never merged into a multi-room booking', async () => {
  const db = store();
  const { reservation } = await ingestMessage({ store: db, message: BINA });
  const live = [reservation];

  const result = reconcile({
    events: [{ uid: 'cal-303', room: '303', check_in: '2026-10-25', check_out: '2026-10-27', summary: 'Booking.com' }],
    reservations: live,
    room: '303',
    now: new Date('2026-10-20T08:00:00Z'),
  });

  assert.equal(result.matched.length, 0, 'one entry cannot say which of four rooms this is');
  assert.equal(result.unmatched.length, 1);
  assert.equal(result.unmatched[0].ambiguous, 'multi-room-booking',
    'flagged for a person rather than held as a second stay');
});

test('a single-room booking still reconciles exactly as before', async () => {
  const db = store();
  const { reservation } = await ingestMessage({ store: db, message: IRENE });

  const result = reconcile({
    events: [{ uid: 'cal-302', room: '302', check_in: '2026-11-07', check_out: '2026-11-08', summary: 'Booking.com' }],
    reservations: [reservation],
    room: '302',
    now: new Date('2026-11-01T08:00:00Z'),
  });

  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].reservation_id, reservation.id);
  assert.equal(result.unmatched.length, 0);
});

test('the QuoVai notification for a multi-room booking adopts no provisional stay', async () => {
  const db = store();

  // Occupancy the feed knew about first: one room, the right nights.
  await db.reservations.create(buildReservation({
    source: 'ical', provisional: true, ical_uid: 'cal-305',
    room: '305', check_in: '2026-10-25', check_out: '2026-10-27',
    guide_email_status: 'no-address',
  }));

  const { action, reservation } = await ingestMessage({ store: db, message: BINA });

  assert.equal(action, 'created', 'a new stay, not somebody else’s room completed');
  assert.deepEqual(reservation.rooms, BINA_ROOMS);
  assert.equal((await db.reservations.list({})).length, 2, 'the occupancy is left for a person');
  assert.equal((await db.reservations.provisional()).length, 1);
});

/* ══ A cancellation still cancels ════════════════════════════════════════ */

test('the four-room booking can still be called off, once', async () => {
  const db = store();
  await ingestMessage({ store: db, message: BINA });
  const off = await ingestMessage({
    store: db,
    message: {
      ...BINA,
      subject: '⛔ QuoVai — cancellazione',
      messageId: '<quovai-5639466196-cancel@quovai.com>',
      body: BINA.body.replace('5639466196 NEW', '5639466196 CANCELLED'),
    },
  });

  assert.equal(off.reservation.status, RESERVATION_STATUS.cancelled);
  assert.deepEqual(off.reservation.rooms, BINA_ROOMS, 'and still knows which rooms it was');
  assert.equal((await db.reservations.list({})).length, 1);
});
