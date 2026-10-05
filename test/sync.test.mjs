/**
 * Keeping the reservations in step with the mailbox, and recovering when they are not.
 *
 * Three operations that look alike and are not, which is the whole reason they are
 * three. The poll keeps up with what arrives; the backfill recovers what was never
 * seen; the repair corrects what was seen badly. Only the first two create anything,
 * none of them sends a guest a second email, and all three have to be safe to run
 * twice by somebody who is not sure whether the first one worked.
 *
 * The expensive failure is never a duplicate row. It is a guest who gets two guide
 * links, or a stay that looks live because a cancellation was applied before the
 * modification that preceded it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../server/store.js';
import { createMemoryMailbox } from '../server/ingest/mailbox.js';
import { ingestMessages } from '../server/ingest/index.js';
import {
  backfillFromMailbox, backfillQuery, DEFAULT_BACKFILL_DAYS,
} from '../server/ingest/backfill.js';
import {
  groupReservations, reservationGroup, syncJobStates, SYNC_JOBS, syncOverview,
} from '../server/staff.js';
import { buildReservation } from '../server/reservations.js';
import { propertyDate, addDays } from '../commerce/time.js';

const store = () => createStore({});

/** A QuoVai notification, as one arrives. */
const notification = (over = {}) => {
  const {
    kind = 'NEW', reference = '6703524869', name = 'Marta Venturi',
    room = '303 queen std', from = '12/10/2026', to = '15/10/2026',
    receivedAt = '2026-09-01T09:00:00Z', id = `<${reference}-${kind}@quovai>`,
  } = over;
  return {
    messageId: id,
    receivedAt,
    from: 'noreply@quovai.com',
    subject: `Prenotazione ${kind} ${reference}`,
    body: [
      `Numero prenotazione: ${reference} ${kind}`,
      name,
      `Check-in: ${from}`,
      `Check-out: ${to}`,
      'Camera Ospiti Trattamento',
      `${room} 2 bb`,
      'Email: marta@example.invalid',
    ].join('\n'),
  };
};

/* ── The backfill query ──────────────────────────────────────────────────── */

test('the backfill replaces the poll’s window rather than adding a second one', () => {
  // Two `newer_than:` in one Gmail query is not an error — the narrower one simply
  // wins, which would make the backfill silently do nothing.
  assert.equal(backfillQuery('from:quovai newer_than:7d', 365), 'from:quovai newer_than:365d');
  assert.equal(backfillQuery('from:quovai NEWER_THAN:2d', 30), 'from:quovai newer_than:30d');
  assert.equal(backfillQuery('', 365), 'from:quovai newer_than:365d');
  assert.equal(backfillQuery('from:quovai -label:done', 90), 'from:quovai -label:done newer_than:90d');
  assert.equal(backfillQuery('from:quovai', 0), 'from:quovai newer_than:1d', 'never a window of nothing');
});

/* ── Recovering what was never seen ──────────────────────────────────────── */

test('the backfill creates the stays the poll’s window had already slid past', async () => {
  const db = store();
  const mailbox = createMemoryMailbox([
    notification({ reference: '1111111111', name: 'Marta Venturi' }),
    notification({ reference: '2222222222', name: 'Irene Bianchi', room: '302 queen std' }),
  ]);

  const result = await backfillFromMailbox({ store: db, mailbox, ingest: ingestMessages, days: 365 });

  assert.equal(result.ok, true);
  assert.equal(result.scanned, 2);
  assert.equal(result.reservationEvents, 2);
  assert.equal(result.created, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.recovered.length, 2);
  assert.deepEqual(
    result.recovered.map((r) => r.guest).sort(),
    ['Irene Bianchi', 'Marta Venturi'],
    'each one named, so the report can be checked rather than trusted',
  );
});

test('running the backfill twice creates nothing the second time', async () => {
  const db = store();
  const messages = [notification({ reference: '1111111111' })];
  const first = await backfillFromMailbox({
    store: db, mailbox: createMemoryMailbox([...messages]), ingest: ingestMessages,
  });
  assert.equal(first.created, 1);

  const again = await backfillFromMailbox({
    store: db, mailbox: createMemoryMailbox([...messages]), ingest: ingestMessages,
  });
  assert.equal(again.created, 0);
  assert.equal(again.duplicates, 1, 'the message id was remembered the first time');
  assert.equal((await db.reservations.list({ limit: 50 })).length, 1);
});

test('the backfill never reissues a guide link or re-dates a sent email', async () => {
  const db = store();
  const messages = [notification({ reference: '1111111111' })];
  await backfillFromMailbox({ store: db, mailbox: createMemoryMailbox([...messages]), ingest: ingestMessages });

  const [before] = await db.reservations.list({ limit: 5 });
  // Pretend the guest already has the email.
  const delivery = await db.deliveries.findByReservation(before.id);
  await db.deliveries.update(delivery.id, { status: 'sent', sent_at: '2026-09-02T08:00:00Z' });

  await backfillFromMailbox({ store: db, mailbox: createMemoryMailbox([...messages]), ingest: ingestMessages });

  const [after] = await db.reservations.list({ limit: 5 });
  assert.equal(after.guide_token, before.guide_token, 'the link in the guest’s inbox still works');
  assert.equal(after.guide_created_at, before.guide_created_at);
  const settled = await db.deliveries.findByReservation(before.id);
  assert.equal(settled.status, 'sent', 'and sent stays sent');
  assert.equal(settled.sent_at, '2026-09-02T08:00:00Z');
  assert.equal((await db.deliveries.list({ limit: 10 })).length, 1, 'one delivery per stay, always');
});

test('a booking made, changed and cancelled over three weeks ends up cancelled', async () => {
  const db = store();
  // Handed over newest-first, the way Gmail lists them.
  const mailbox = createMemoryMailbox([
    notification({ kind: 'CANCELLED', reference: '3333333333', receivedAt: '2026-09-20T09:00:00Z' }),
    notification({ kind: 'MODIFIED', reference: '3333333333', to: '16/10/2026', receivedAt: '2026-09-10T09:00:00Z' }),
    notification({ kind: 'NEW', reference: '3333333333', receivedAt: '2026-09-01T09:00:00Z' }),
  ]);

  const result = await backfillFromMailbox({ store: db, mailbox, ingest: ingestMessages });

  assert.equal(result.created, 1);
  assert.equal(result.cancelled, 1);
  const [stay] = await db.reservations.list({ limit: 5 });
  assert.equal(stay.status, 'cancelled', 'applied in the wrong order this would look live');
  assert.ok(stay.cancelled_at);
});

test('the backfill ignores the mailbox’s own noise without raising anything', async () => {
  const db = store();
  const mailbox = createMemoryMailbox([
    notification({ reference: '1111111111' }),
    { messageId: '<s1@q>', from: 'noreply@quovai.com', subject: 'Schedine alloggiati da inviare', body: 'Ricorda di inviare le schedine.' },
    { messageId: '<s2@q>', from: 'noreply@quovai.com', subject: 'Check-in online completato', body: 'Un ospite ha completato il check-in online.' },
  ]);

  const result = await backfillFromMailbox({ store: db, mailbox, ingest: ingestMessages });

  assert.equal(result.scanned, 3);
  assert.equal(result.reservationEvents, 1, 'only one of these was a reservation');
  assert.equal(result.ignored, 2);
  assert.equal(result.failed, 0, 'a police form is not an unreadable notification');
  assert.equal((await db.alerts.open()).length, 0, 'and it is not something anybody has to look at');
});

test('a mailbox that is not configured is a refusal, not an empty inbox', async () => {
  const db = store();
  const result = await backfillFromMailbox({
    store: db,
    mailbox: { id: 'gmail', configured: false, fetchMessages: async () => [] },
    ingest: ingestMessages,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'source-not-configured');
});

test('the backfill looks back a season by default', () => {
  assert.equal(DEFAULT_BACKFILL_DAYS, 365);
});

/* ── The three jobs, each reported on its own ────────────────────────────── */

test('a job that has never run says so, rather than looking fine', async () => {
  const db = store();
  const states = await syncJobStates({ store: db });

  assert.deepEqual(Object.keys(states).sort(), [...SYNC_JOBS].sort());
  for (const job of SYNC_JOBS) {
    assert.equal(states[job].everRan, false, job);
    assert.equal(states[job].lastSuccessAt, null, job);
    assert.equal(states[job].runs, 0, job);
  }
});

test('each job keeps its own last run, and survives a restart', async () => {
  const db = store();
  await db.syncRuns.record('gmail-incremental', { ok: true, scanned: 4, created: 1 });
  await db.syncRuns.record('ical', { ok: false, reason: 'no-feeds-configured' });

  const states = await syncJobStates({ store: db });
  assert.equal(states['gmail-incremental'].everRan, true);
  assert.equal(states['gmail-incremental'].counts.scanned, 4);
  assert.equal(states['gmail-incremental'].counts.created, 1);
  assert.equal(states['gmail-incremental'].lastError, null);

  assert.equal(states.ical.everRan, true);
  assert.equal(states.ical.lastError, 'no-feeds-configured');
  assert.equal(states.ical.lastSuccessAt, null, 'a failure does not count as a success');

  // The backfill is the one whose "never run" matters most, and it is still never run.
  assert.equal(states['gmail-backfill'].everRan, false);
});

test('a failure after a success keeps the last success', async () => {
  const db = store();
  await db.syncRuns.record('gmail-incremental', { ok: true, scanned: 2 });
  const after = await db.syncRuns.get('gmail-incremental');
  await db.syncRuns.record('gmail-incremental', { ok: false, reason: 'gmail refused' });

  const states = await syncJobStates({ store: db });
  assert.equal(states['gmail-incremental'].lastError, 'gmail refused');
  assert.equal(states['gmail-incremental'].lastSuccessAt, after.lastSuccessAt, 'it did work, once');
  assert.equal(states['gmail-incremental'].runs, 2);
});

test('the sync overview carries the three jobs and counts the provisional stays', async () => {
  const db = store();
  await db.reservations.create(buildReservation({
    source: 'ical', provisional: true, ical_uid: 'u1',
    check_in: '2026-10-20', check_out: '2026-10-22', room: '305',
  }));
  const overview = await syncOverview({ store: db, now: new Date('2026-10-01T10:00:00Z') });

  assert.equal(overview.provisional, 1);
  assert.deepEqual(Object.keys(overview.jobs).sort(), [...SYNC_JOBS].sort());
  const row = overview.rows[0];
  assert.equal(row.provisional, true);
  assert.deepEqual(row.incomplete, ['first_name', 'last_name', 'guest_email']);
  assert.ok(row.problems.includes('provisional'));
});

/* ── The order a person works in ─────────────────────────────────────────── */

test('reservations are grouped by what a person needs first', () => {
  const now = new Date('2026-10-12T08:00:00Z');
  const today = propertyDate(now);
  const stay = (over) => buildReservation({ source: 'quovai', booking_reference: over.booking_reference, ...over });

  const rows = [
    stay({ booking_reference: 'IN', check_in: addDays(today, -2), check_out: addDays(today, 2), room: '301' }),
    stay({ booking_reference: 'TODAY', check_in: today, check_out: addDays(today, 3), room: '302' }),
    stay({ booking_reference: 'SOON', check_in: addDays(today, 4), check_out: addDays(today, 6), room: '303' }),
    stay({ booking_reference: 'LATER', check_in: addDays(today, 40), check_out: addDays(today, 42), room: '304' }),
    stay({ booking_reference: 'NODATES', check_in: null, check_out: null, room: '305' }),
    stay({ booking_reference: 'PAST', check_in: addDays(today, -9), check_out: addDays(today, -6), room: '301' }),
  ];

  const grouped = groupReservations(rows, { now });
  assert.equal(grouped.counts['in-house'], 1);
  assert.equal(grouped.groups['in-house'][0].booking_reference, 'IN');
  assert.equal(grouped.groups['arriving-today'][0].booking_reference, 'TODAY');
  assert.equal(grouped.groups['arriving-soon'][0].booking_reference, 'SOON');
  assert.equal(grouped.groups.upcoming[0].booking_reference, 'LATER');
  assert.equal(grouped.groups.incomplete[0].booking_reference, 'NODATES');
  assert.equal(grouped.groups.history[0].booking_reference, 'PAST');

  // A stay beginning today is an arrival, not somebody already upstairs: nobody
  // has met them and the keys are still at the desk.
  assert.equal(reservationGroup(rows[1], today), 'arriving-today');
  assert.equal(reservationGroup(rows[0], today), 'in-house');
  // History is last, always.
  assert.equal(grouped.order[grouped.order.length - 1], 'history');
});

test('a provisional stay arriving today stays with today’s arrivals, flagged', () => {
  const now = new Date('2026-10-12T08:00:00Z');
  const today = propertyDate(now);
  const provisional = buildReservation({
    source: 'ical', provisional: true, ical_uid: 'u1',
    check_in: today, check_out: addDays(today, 2), room: '304',
  });

  const grouped = groupReservations([provisional], { now });
  assert.equal(grouped.counts['arriving-today'], 1, 'urgent because of when it is, not because of what it lacks');
  assert.equal(grouped.counts.incomplete, 0);
  assert.equal(grouped.groups['arriving-today'][0].provisional, true);
  assert.deepEqual(grouped.groups['arriving-today'][0].incomplete, ['first_name', 'last_name', 'guest_email']);
  assert.equal(grouped.needsData, 1, 'and counted, so nothing has to be hunted for');
});

test('a cancelled stay is history whatever its dates say', () => {
  const today = propertyDate(new Date('2026-10-12T08:00:00Z'));
  const cancelled = buildReservation({
    source: 'quovai', booking_reference: 'X',
    check_in: addDays(today, 3), check_out: addDays(today, 5), status: 'cancelled',
  });
  assert.equal(reservationGroup(cancelled, today), 'history');
});
