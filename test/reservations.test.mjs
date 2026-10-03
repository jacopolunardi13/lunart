/**
 * Reservations: the model, the upsert, and what a guest link may carry.
 *
 * The two that matter most are the idempotency test and the token test. A duplicate
 * notification producing a second reservation is a guest emailed twice; a token that
 * encodes who the guest is, is a stay broadcast to anyone who sees the URL.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../server/store.js';
import {
  buildReservation, upsertReservation, cancelReservation, completePastStays,
  guestContext, staffView, rotateGuideToken, phaseOf, stayOf,
  RESERVATION_STATUS, isLive,
} from '../server/reservations.js';
import { resolveGuideLink, guideContextView, recoverGuideLink } from '../server/guide-link.js';
import { ingestEvent } from '../server/ingest/index.js';
import { stayDates, cardFitsStay, cardStartDates, cardVariantsForStay } from '../commerce/stay.js';
import { propertyDate, addDays } from '../commerce/time.js';

const store = () => createStore();

const event = (over = {}) => ({
  kind: 'new',
  source: 'quovai',
  booking_reference: '5312447891',
  channel: 'Booking.com',
  first_name: 'Marta',
  last_name: 'Venturi',
  guest_email: 'marta.4h9k@guest.booking.com',
  guest_phone: '+39 348 112 4455',
  check_in: '2026-10-12',
  check_out: '2026-10-15',
  adults: 2,
  children: 0,
  room: '303',
  message_id: '<one@quovai>',
  ...over,
});

/* ── The model ───────────────────────────────────────────────────────────── */

test('a reservation is built with everything the rest of the system needs', () => {
  const reservation = buildReservation(event());
  assert.equal(reservation.object, 'reservation');
  assert.equal(reservation.status, RESERVATION_STATUS.active);
  assert.equal(reservation.booking_reference, '5312447891');
  assert.equal(reservation.guest_count, 2);
  assert.ok(reservation.guide_token.length >= 20, 'the token is long');
  assert.ok(reservation.staff_ref.length === 6, 'and there is a short one for the phone');
  assert.equal(reservation.guide_email_status, 'pending');
});

test('a guide token carries nothing about the guest', () => {
  const reservation = buildReservation(event());
  const token = reservation.guide_token.toLowerCase();
  for (const secret of ['marta', 'venturi', '303', '5312447891', '2026', 'booking', 'guest']) {
    assert.equal(token.includes(secret), false, `${secret} must not be in the token`);
  }
  assert.match(reservation.guide_token, /^[A-Za-z0-9_-]+$/, 'url-safe and opaque');

  // Two reservations one after another must not produce related tokens.
  const second = buildReservation(event({ booking_reference: 'X' }));
  assert.notEqual(reservation.guide_token, second.guide_token);
  assert.equal(reservation.guide_token.slice(0, 8) === second.guide_token.slice(0, 8), false);
});

test('a stay runs from arrival to the end of the checkout day', () => {
  const dates = stayDates({ check_in: '2026-10-10', check_out: '2026-10-13' });
  assert.deepEqual(dates, ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']);
  assert.deepEqual(stayDates({ check_in: '2026-10-10', check_out: '2026-10-09' }), [], 'nonsense gives nothing');
});

test('which part of the stay a guest is in comes from the dates', () => {
  const reservation = buildReservation(event({ check_in: '2026-10-12', check_out: '2026-10-15' }));
  assert.equal(phaseOf(reservation, '2026-10-10'), 'before');
  assert.equal(phaseOf(reservation, '2026-10-12'), 'staying');
  assert.equal(phaseOf(reservation, '2026-10-15'), 'leaving', 'checkout day is leaving');
  assert.equal(phaseOf(reservation, '2026-10-20'), 'leaving');
});

/* ── Upsert and idempotency ──────────────────────────────────────────────── */

test('the same notification twice makes one reservation', async () => {
  const db = store();
  const first = await ingestEvent({ store: db, event: event() });
  const second = await ingestEvent({ store: db, event: event() });

  assert.equal(first.action, 'created');
  assert.equal(second.action, 'duplicate', 'the second delivery is recognised');
  const all = await db.reservations.list({});
  assert.equal(all.length, 1);
});

test('a modification updates the same reservation rather than making another', async () => {
  const db = store();
  await ingestEvent({ store: db, event: event() });
  const changed = await ingestEvent({
    store: db,
    event: event({ kind: 'modified', check_out: '2026-10-17', adults: 3, room: '305', message_id: '<two@quovai>' }),
  });

  assert.equal(changed.action, 'modified');
  assert.equal(changed.reservation.status, RESERVATION_STATUS.modified);
  assert.equal(changed.reservation.check_out, '2026-10-17');
  assert.equal(changed.reservation.room, '305');
  assert.deepEqual(Object.keys(changed.changed).sort(), ['adults', 'check_out', 'guest_count', 'room']);
  assert.equal((await db.reservations.list({})).length, 1);

  // And the link did not change, because the guest may already have it open.
  const original = await db.reservations.findByBooking('quovai', '5312447891');
  assert.equal(original.guide_token, changed.reservation.guide_token);
});

test('a modification that changes nothing is recognised as such', async () => {
  const db = store();
  await ingestEvent({ store: db, event: event() });
  const again = await ingestEvent({ store: db, event: event({ kind: 'modified', message_id: '<three@quovai>' }) });
  assert.equal(again.action, 'unchanged');
});

test('a cancellation keeps the record and everything bought against it', async () => {
  const db = store();
  const created = await ingestEvent({ store: db, event: event() });
  const cancelled = await ingestEvent({ store: db, event: event({ kind: 'cancelled', message_id: '<four@quovai>' }) });

  assert.equal(cancelled.action, 'cancelled');
  assert.equal(cancelled.reservation.status, RESERVATION_STATUS.cancelled);
  assert.ok(cancelled.reservation.cancelled_at);
  assert.equal(cancelled.reservation.id, created.reservation.id, 'the same record');
  assert.equal(isLive(cancelled.reservation), false);
  assert.equal((await db.reservations.list({})).length, 1, 'nothing was deleted');
});

test('a cancellation for a stay we never saw is still recorded', async () => {
  const db = store();
  const result = await ingestEvent({ store: db, event: event({ kind: 'cancelled', message_id: '<five@quovai>' }) });
  assert.equal(result.action, 'cancelled-unknown');
  const all = await db.reservations.list({});
  assert.equal(all.length, 1);
  assert.equal(all[0].status, RESERVATION_STATUS.cancelled);
});

test('a reinstated booking comes back to life rather than being duplicated', async () => {
  const db = store();
  await ingestEvent({ store: db, event: event() });
  await ingestEvent({ store: db, event: event({ kind: 'cancelled', message_id: '<c@quovai>' }) });
  const back = await ingestEvent({ store: db, event: event({ kind: 'new', message_id: '<r@quovai>', room: '304' }) });
  assert.equal(back.action, 'reinstated');
  assert.equal(back.reservation.status, RESERVATION_STATUS.active);
  assert.equal(back.reservation.cancelled_at, null);
  assert.equal((await db.reservations.list({})).length, 1);
});

test('a notification with no booking number is refused rather than guessed at', async () => {
  const db = store();
  const result = await ingestEvent({ store: db, event: event({ booking_reference: '' }) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-booking-reference');
  assert.equal((await db.reservations.list({})).length, 0);
});

test('a stay past its checkout is retired, once', async () => {
  const db = store();
  await ingestEvent({ store: db, event: event({ check_in: '2026-01-10', check_out: '2026-01-12' }) });
  const done = await completePastStays({ store: db, now: new Date('2026-02-01T10:00:00Z') });
  assert.equal(done.length, 1);
  assert.equal(done[0].status, RESERVATION_STATUS.completed);
  const again = await completePastStays({ store: db, now: new Date('2026-02-01T10:00:00Z') });
  assert.equal(again.length, 0, 'nothing to do the second time');
});

/* ── What the browser is told ────────────────────────────────────────────── */

test('a personal link gives the guide a first name, a room and the dates — and no more', async () => {
  const db = store();
  const { reservation } = await ingestEvent({ store: db, event: event() });
  const resolved = await resolveGuideLink({ store: db, token: reservation.guide_token });
  const view = guideContextView(resolved);

  assert.equal(view.first_name, 'Marta');
  assert.equal(view.room, '303');
  assert.equal(view.check_in, '2026-10-12');
  assert.equal(view.nights, 3);
  assert.equal(view.can_purchase, true);

  for (const leak of ['last_name', 'guest_email', 'guest_phone', 'booking_reference', 'rate',
    'total_amount', 'guide_token', 'channel', 'history', 'id']) {
    assert.equal(leak in view, false, `${leak} must not reach the browser`);
  }
});

test('an unknown or malformed token resolves to nothing, without saying why', async () => {
  const db = store();
  await ingestEvent({ store: db, event: event() });
  assert.equal(await resolveGuideLink({ store: db, token: 'short' }), null);
  assert.equal(await resolveGuideLink({ store: db, token: 'x'.repeat(32) }), null);
  assert.equal(await resolveGuideLink({ store: db, token: '' }), null);
});

test('a cancelled stay still resolves, and cannot be bought against', async () => {
  const db = store();
  const { reservation } = await ingestEvent({ store: db, event: event() });
  await cancelReservation({ store: db, reservation });

  const resolved = await resolveGuideLink({ store: db, token: reservation.guide_token });
  const view = guideContextView(resolved);
  assert.equal(view.cancelled, true);
  assert.equal(view.can_purchase, false, 'nothing new is sold against a cancelled stay');
  assert.equal(view.check_in, '2026-10-12', 'the dates are still shown, so the guest knows what we mean');
});

test('rotating the link invalidates the old one', async () => {
  const db = store();
  const { reservation } = await ingestEvent({ store: db, event: event() });
  const rotated = await rotateGuideToken({ store: db, reservation });

  assert.notEqual(rotated.guide_token, reservation.guide_token);
  assert.equal(await resolveGuideLink({ store: db, token: reservation.guide_token }), null);
  assert.ok(await resolveGuideLink({ store: db, token: rotated.guide_token }));
});

/* ── Recovery ────────────────────────────────────────────────────────────── */

test('a lost link comes back from a surname and a booking number', async () => {
  const db = store();
  const today = propertyDate();
  const { reservation } = await ingestEvent({
    store: db,
    event: event({ check_in: today, check_out: addDays(today, 3) }),
  });

  const found = await recoverGuideLink({ store: db, lastName: 'Venturi', reference: '5312447891', origin: 'https://g.example' });
  assert.equal(found.ok, true);
  assert.equal(found.link, `https://g.example/g/${reservation.guide_token}`);
  assert.equal(found.first_name, 'Marta');
});

test('every failed recovery gives the same answer', async () => {
  const db = store();
  const today = propertyDate();
  await ingestEvent({ store: db, event: event({ check_in: today, check_out: addDays(today, 2) }) });

  const attempts = [
    { lastName: 'Venturi', reference: '0000000000' },   // right name, wrong number
    { lastName: 'Rossi', reference: '5312447891' },      // wrong name, right number
    { lastName: 'Nobody', reference: 'NOTHING' },        // neither
    { lastName: '', reference: '' },                      // nothing at all
  ];
  for (const attempt of attempts) {
    const result = await recoverGuideLink({ store: db, ...attempt });
    assert.deepEqual(result, { ok: false, reason: 'not-found' }, JSON.stringify(attempt));
  }
});

test('recovery does not hand back a cancelled or finished stay', async () => {
  const db = store();
  const { reservation } = await ingestEvent({ store: db, event: event({ booking_reference: 'CANCELLED-1' }) });
  await cancelReservation({ store: db, reservation });
  assert.equal((await recoverGuideLink({ store: db, lastName: 'Venturi', reference: 'CANCELLED-1' })).ok, false);

  await ingestEvent({ store: db, event: event({ booking_reference: 'OLD-1', check_in: '2026-01-02', check_out: '2026-01-04', message_id: '<old@q>' }) });
  const old = await recoverGuideLink({ store: db, lastName: 'Venturi', reference: 'OLD-1', now: new Date('2026-06-01T10:00:00Z') });
  assert.equal(old.ok, false);
});

test('a surname typed as two words still works, with the right booking number', async () => {
  const db = store();
  const today = propertyDate();
  await ingestEvent({
    store: db,
    event: event({ booking_reference: 'EXP-1', first_name: 'Giulio De', last_name: 'Santis',
      check_in: today, check_out: addDays(today, 2) }),
  });
  assert.equal((await recoverGuideLink({ store: db, lastName: 'De Santis', reference: 'EXP-1' })).ok, true);
  assert.equal((await recoverGuideLink({ store: db, lastName: 'Santis', reference: 'EXP-1' })).ok, true);
});

/* ── The card inside the stay ────────────────────────────────────────────── */

test('a card must fit inside the stay, checkout day included', () => {
  const stay = { check_in: '2026-10-10', check_out: '2026-10-13' };

  // The brief's own example: 10, 11, 12, 13 are usable days.
  assert.deepEqual(cardStartDates(stay, 2, { from: '2026-10-01' }), ['2026-10-10', '2026-10-11', '2026-10-12']);
  assert.deepEqual(cardStartDates(stay, 5, { from: '2026-10-01' }), [], 'five days do not fit');
  assert.deepEqual(cardStartDates(stay, 8, { from: '2026-10-01' }), [], 'nor do eight');

  assert.equal(cardFitsStay(stay, '2026-10-12', 2), true, 'ending on the checkout day is fine');
  assert.equal(cardFitsStay(stay, '2026-10-13', 2), false, 'running past it is not');
  assert.equal(cardFitsStay(stay, '2026-10-09', 2), false, 'nor starting before arrival');
});

test('only the card lengths that fit are offered', () => {
  const variants = [
    { id: '2d', meta: { days: 2 } },
    { id: '5d', meta: { days: 5 } },
    { id: '8d', meta: { days: 8 } },
  ];
  const short = cardVariantsForStay(variants, { check_in: '2026-10-10', check_out: '2026-10-13' }, { from: '2026-10-01' });
  assert.deepEqual(short.map((v) => v.id), ['2d']);

  const long = cardVariantsForStay(variants, { check_in: '2026-10-10', check_out: '2026-10-20' }, { from: '2026-10-01' });
  assert.deepEqual(long.map((v) => v.id), ['2d', '5d', '8d']);

  // With no stay known there is nothing to narrow by, and nothing is hidden.
  assert.equal(cardVariantsForStay(variants, null).length, 3);
});

test('what staff see includes the things the guest view leaves out', async () => {
  const db = store();
  const { reservation } = await ingestEvent({ store: db, event: event() });
  const view = staffView(reservation);
  assert.equal(view.last_name, 'Venturi');
  assert.equal(view.guest_email, 'marta.4h9k@guest.booking.com');
  assert.equal(view.booking_reference, '5312447891');
  assert.equal('guide_token' in view, false, 'the link is fetched deliberately, not sprayed into a list');
  assert.deepEqual(stayOf(reservation), { check_in: '2026-10-12', check_out: '2026-10-15' });
  assert.ok(guestContext(reservation).stay_days.length === 4);
});
