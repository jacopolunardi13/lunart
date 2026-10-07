/**
 * The launch catch-up only writes to guests who are already owed the guide.
 *
 * A real production dry run on the morning of 7 October read: 85 reservations
 * considered, 19 would receive, 66 excluded — 65 of them reported as "cancelled".
 * Both halves of that were wrong, and in the way that costs the most.
 *
 * The 19 included Eileen Bernstein, arriving in April 2027. Pressing send would
 * have written to her seven months early, because eligibility asked whether a
 * guest still needed the guide and never whether they needed it *yet*. The
 * catch-up exists for one thing: guests whose T-3 moment went by while production
 * mail was not running. It must not pull a single future email forward.
 *
 * And "cancelled: 65" was a store whose real cancellations were five and whose
 * other sixty were guests who had simply gone home — `skipReason` opened with
 * `if (!isLive) return cancelled`, so every finished stay was filed under a word
 * that means somebody called it off.
 *
 * So these tests are about the clock and about the vocabulary, and about the one
 * safeguard that makes the rest safe: the send recomputes, and cannot be told whom
 * to write to.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../server/store.js';
import { createApp } from '../server/app.js';
import { createMockStripe } from '../server/stripe.js';
import { buildReservation, RESERVATION_STATUS } from '../server/reservations.js';
import {
  scheduleGuideEmail, sendDueGuideEmails, sendTimeFor, DELIVERY_STATUS,
  GUIDE_EMAIL_LEAD_DAYS, GUIDE_EMAIL_HOUR,
} from '../server/delivery.js';
import { previewGuideCatchUp, runGuideCatchUp, CATCHUP_SKIP } from '../server/catchup.js';
import { propertyDate, propertyTimeToInstant, addDays } from '../commerce/time.js';

/**
 * The morning it happened: 2026-10-07, 09:27 in Florence.
 *
 * A real instant rather than midnight, because the rule turns on 10:00 Europe/Rome
 * and a test fixed at midnight would pass whether the hour was respected or not.
 * 09:27 CEST is 07:27 UTC, so "today at 10:00" is still half an hour away — which
 * is what makes a stay arriving in three days *not* due.
 */
const NOW = new Date('2026-10-07T07:27:00Z');
const today = propertyDate(NOW);
const day = (n) => addDays(today, n);

/** The canonical moment, computed the way the product does. */
const t3 = (checkIn) => propertyTimeToInstant(addDays(checkIn, -GUIDE_EMAIL_LEAD_DAYS), GUIDE_EMAIL_HOUR);

const store = () => createStore();

/** A complete, live, emailable reservation. Nothing missing but the clock. */
async function guest(db, key, over = {}) {
  return db.reservations.create(buildReservation({
    source: 'quovai', booking_reference: key.toUpperCase(),
    first_name: 'Ospite', last_name: key,
    guest_email: `${key}@example.invalid`,
    check_in: day(5), check_out: day(7), room: '303', adults: 2,
    ...over,
  }));
}

/** A mailer that works, and counts every message it is handed. */
function countingMailer() {
  const sent = [];
  return {
    id: 'gmail', configured: true, implemented: true, sent,
    async send(message) { sent.push(message); return { simulated: false, id: `m${sent.length}` }; },
    state: () => ({ sent: sent.length, lastError: null, lastSuccessAt: null }),
    check: async () => ({ ok: true }),
  };
}

const reasonOf = (preview, id) => preview.skipped.find((r) => r.reservation_id === id)?.reason ?? null;
const isEligible = (preview, id) => preview.rows.some((r) => r.reservation_id === id);

/* ══ A. A future scheduled delivery is not backlog ════════════════════════ */

test('A a scheduled delivery in the future is excluded as not-due-yet, and no mail is attempted', async () => {
  const db = store();
  const mailer = countingMailer();

  // Diana De La Rosa's shape: arriving 14 October, so due on the 11th at ten.
  const diana = await guest(db, 'diana', { check_in: day(7), check_out: day(9) });
  await scheduleGuideEmail({ store: db, reservation: diana, now: NOW });

  const scheduled = await db.deliveries.findByReservation(diana.id);
  assert.equal(scheduled.status, DELIVERY_STATUS.scheduled);
  assert.equal(scheduled.send_at, t3(day(7)).toISOString(), 'T-3 at 10:00 Florence');
  assert.ok(new Date(scheduled.send_at) > NOW, 'and that is still ahead of us');

  const preview = await previewGuideCatchUp({ store: db, now: NOW });
  assert.equal(preview.eligible, 0);
  assert.equal(reasonOf(preview, diana.id), CATCHUP_SKIP.notDueYet);
  assert.equal(preview.breakdown[CATCHUP_SKIP.notDueYet], 1);

  // The row says when, so a person can check the verdict rather than trust it.
  assert.equal(preview.skipped[0].due_at, scheduled.send_at);

  // And a confirmed send writes to nobody.
  const outcome = await runGuideCatchUp({ store: db, mailer, origin: 'https://g.example', now: NOW, confirm: true });
  assert.equal(outcome.attempted, 0);
  assert.equal(mailer.sent.length, 0, 'not one attempt');
});

/* ══ B. A delivery whose moment has gone is backlog ═══════════════════════ */

test('B a scheduled delivery whose send_at has passed is eligible', async () => {
  const db = store();

  // Shukura Oluwo's shape: arrived two days ago, so T-3 went by five days ago.
  const shukura = await guest(db, 'shukura', { check_in: day(-2), check_out: day(1) });
  await scheduleGuideEmail({ store: db, reservation: shukura, now: new Date('2026-09-20T08:00:00Z') });

  const scheduled = await db.deliveries.findByReservation(shukura.id);
  assert.ok(new Date(scheduled.send_at) <= NOW, `send_at ${scheduled.send_at} should be behind us`);

  const preview = await previewGuideCatchUp({ store: db, now: NOW });
  assert.equal(preview.eligible, 1);
  assert.ok(isEligible(preview, shukura.id));
  assert.equal(preview.breakdown[CATCHUP_SKIP.notDueYet], 0);
});

/* ══ C. An in-house guest whose moment has gone ═══════════════════════════ */

test('C a guest already in the building, never written to, is eligible', async () => {
  const db = store();

  // Kyu Yeon Shim's shape: checked in yesterday, leaving in three days.
  const kyu = await guest(db, 'kyu', { check_in: day(-1), check_out: day(3) });
  // No delivery row at all: the stay was imported while nothing was scheduling.
  assert.equal(await db.deliveries.findByReservation(kyu.id), null);

  const preview = await previewGuideCatchUp({ store: db, now: NOW });
  assert.ok(isEligible(preview, kyu.id), 'derived from the rule, with no row to read');
  assert.equal(preview.rows[0].delivery_status, 'none');
  assert.equal(preview.rows[0].due_at, NOW.toISOString(), 'overdue reads as "now"');
});

test('C a guest arriving today is due: T-3 was three days ago', async () => {
  const db = store();
  const thais = await guest(db, 'thais', { check_in: today, check_out: day(2) });
  const preview = await previewGuideCatchUp({ store: db, now: NOW });
  assert.ok(isEligible(preview, thais.id));
});

test('C the boundary is the hour, not the day', async () => {
  const db = store();
  // Arriving in three days: due today at 10:00 Florence, and it is 09:27.
  const soon = await guest(db, 'soon', { check_in: day(3), check_out: day(5) });

  const before = await previewGuideCatchUp({ store: db, now: NOW });
  assert.equal(reasonOf(before, soon.id), CATCHUP_SKIP.notDueYet, 'at 09:27 it is not yet owed');

  const after = await previewGuideCatchUp({ store: db, now: new Date('2026-10-07T08:00:00Z') });
  assert.ok(isEligible(after, soon.id), 'at 10:00 it is');
});

/* ══ D. Already sent beats the clock ══════════════════════════════════════ */

test('D a guest already written to stays excluded even when they are due', async () => {
  const db = store();
  const done = await guest(db, 'giafatta', { check_in: day(-1), check_out: day(2) });
  await db.deliveries.create({
    reservation_id: done.id, to: done.guest_email, lang: 'it',
    send_at: t3(day(-1)).toISOString(), status: DELIVERY_STATUS.sent,
    attempts: 1, sent_at: '2026-10-04T08:00:01.000Z', provider: 'gmail', error: null,
  });
  await db.reservations.update(done.id, { guide_email_status: DELIVERY_STATUS.sent });

  const preview = await previewGuideCatchUp({ store: db, now: NOW });
  assert.equal(preview.eligible, 0);
  assert.equal(reasonOf(preview, done.id), CATCHUP_SKIP.alreadySent,
    'the stronger reason wins: they have had it, which is why we leave them alone');
});

/* ══ E. Simulated is backlog, but only when its own moment has gone ═══════ */

test('E a simulated delivery whose moment has passed is still owed the guide', async () => {
  const db = store();
  const past = await guest(db, 'simulatascaduta', { check_in: day(-1), check_out: day(2) });
  await db.deliveries.create({
    reservation_id: past.id, to: past.guest_email, lang: 'it',
    send_at: t3(day(-1)).toISOString(), status: DELIVERY_STATUS.simulated,
    attempts: 1, sent_at: '2026-10-04T08:00:01.000Z', provider: 'simulated',
    body: 'il testo, mai partito', error: null,
  });
  await db.reservations.update(past.id, { guide_email_status: DELIVERY_STATUS.simulated });

  const preview = await previewGuideCatchUp({ store: db, now: NOW });
  assert.ok(isEligible(preview, past.id), 'nothing left the building, and the moment has gone');
});

test('E a stale simulated row cannot pull a future stay forward', async () => {
  const db = store();
  const mailer = countingMailer();

  /**
   * The trap this closes.
   *
   * `scheduleGuideEmail` deliberately never moves `send_at` on a simulated row —
   * for the ordinary scheduler a simulated row is finished — so a staging run from
   * last week leaves a `send_at` in the past sitting on a stay in April 2027.
   * Reading the row alone would call that guest backlog and write to them seven
   * months early, which is the worst version of this bug: irreversible, and to
   * somebody who had done nothing but book a long way ahead.
   */
  const eileen = await guest(db, 'eileen', { check_in: '2027-04-23', check_out: '2027-04-25' });
  await db.deliveries.create({
    reservation_id: eileen.id, to: eileen.guest_email, lang: 'it',
    send_at: '2026-09-30T08:00:00.000Z', status: DELIVERY_STATUS.simulated,
    attempts: 1, sent_at: '2026-09-30T08:00:01.000Z', provider: 'simulated',
    body: 'simulato in staging', error: null,
  });

  const preview = await previewGuideCatchUp({ store: db, now: NOW });
  assert.equal(reasonOf(preview, eileen.id), CATCHUP_SKIP.notDueYet,
    'the later of the two moments decides, so neither source can accelerate the other');
  assert.equal(preview.skipped[0].due_at, t3('2027-04-23').toISOString(), 'April 2027, as the rule says');

  const outcome = await runGuideCatchUp({ store: db, mailer, origin: 'https://g.example', now: NOW, confirm: true });
  assert.equal(outcome.attempted, 0);
  assert.equal(mailer.sent.length, 0);
});

/* ══ F/G. Cancelled is cancelled; finished is finished ════════════════════ */

test('F a cancelled reservation is counted as cancelled', async () => {
  const db = store();
  const off = await guest(db, 'annullata', { check_in: day(13), check_out: day(15) });
  await db.reservations.update(off.id, { status: RESERVATION_STATUS.cancelled });

  const preview = await previewGuideCatchUp({ store: db, now: NOW });
  assert.equal(reasonOf(preview, off.id), CATCHUP_SKIP.cancelled);
  assert.equal(preview.breakdown[CATCHUP_SKIP.cancelled], 1);
  assert.equal(preview.breakdown[CATCHUP_SKIP.past], 0);
});

test('G a finished stay is counted as past, not as cancelled', async () => {
  const db = store();

  // Marked completed by the nightly sweep...
  const swept = await guest(db, 'conclusa', { check_in: day(-9), check_out: day(-6) });
  await db.reservations.update(swept.id, { status: RESERVATION_STATUS.completed });
  // ...and one the sweep has not reached yet, still reading as active.
  const unswept = await guest(db, 'partita', { check_in: day(-9), check_out: day(-6) });

  const preview = await previewGuideCatchUp({ store: db, now: NOW });
  assert.equal(reasonOf(preview, swept.id), CATCHUP_SKIP.past);
  assert.equal(reasonOf(preview, unswept.id), CATCHUP_SKIP.past,
    'the checkout date is the fact, whatever the status field has got round to');
  assert.equal(preview.breakdown[CATCHUP_SKIP.past], 2);
  assert.equal(preview.breakdown[CATCHUP_SKIP.cancelled], 0,
    'this is the count that read 65 in production and was almost entirely wrong');
});

test('G the production shape: sixty finished stays are not sixty cancellations', async () => {
  const db = store();

  for (let i = 0; i < 60; i += 1) {
    const r = await guest(db, `vecchia${i}`, { check_in: '2026-08-01', check_out: '2026-08-03' });
    await db.reservations.update(r.id, { status: RESERVATION_STATUS.completed });
  }
  for (let i = 0; i < 5; i += 1) {
    const r = await guest(db, `annullata${i}`, { check_in: day(13), check_out: day(15) });
    await db.reservations.update(r.id, { status: RESERVATION_STATUS.cancelled });
  }
  // Six genuinely due, thirteen genuinely not. The latest of the six arrives in
  // two days, so T-3 is yesterday: every one of them is past the hour, not on it.
  for (let i = 0; i < 6; i += 1) await guest(db, `scaduta${i}`, { check_in: day(-3 + i), check_out: day(5 + i) });
  for (let i = 0; i < 13; i += 1) await guest(db, `futura${i}`, { check_in: day(7 + i), check_out: day(9 + i) });

  const preview = await previewGuideCatchUp({ store: db, now: NOW });
  assert.equal(preview.considered, 84);
  assert.equal(preview.eligible, 6);
  assert.equal(preview.breakdown[CATCHUP_SKIP.past], 60);
  assert.equal(preview.breakdown[CATCHUP_SKIP.cancelled], 5);
  assert.equal(preview.breakdown[CATCHUP_SKIP.notDueYet], 13);
});

/* ══ H. Far future ═══════════════════════════════════════════════════════ */

test('H a stay seven months out is excluded, with its real due date', async () => {
  const db = store();
  const eileen = await guest(db, 'eileen', { check_in: '2027-04-23', check_out: '2027-04-25' });
  await scheduleGuideEmail({ store: db, reservation: eileen, now: NOW });

  const preview = await previewGuideCatchUp({ store: db, now: NOW });
  assert.equal(preview.eligible, 0);
  assert.equal(reasonOf(preview, eileen.id), CATCHUP_SKIP.notDueYet);
  assert.equal(preview.skipped[0].due_at, propertyTimeToInstant('2027-04-20', '10:00').toISOString(),
    '20 April 2027 at ten in the morning, Florence');
});

test('H a reservation with no dates has no moment to be past', async () => {
  const db = store();
  const nowhere = await db.reservations.create(buildReservation({
    source: 'manual', booking_reference: 'NODATES',
    first_name: 'Senza', last_name: 'Date', guest_email: 'senza@example.invalid',
  }));

  const preview = await previewGuideCatchUp({ store: db, now: NOW });
  assert.equal(preview.eligible, 0);
  assert.equal(reasonOf(preview, nowhere.id), CATCHUP_SKIP.noDates,
    'said plainly, rather than guessed at in either direction');
});

/* ══ I. A stale browser cannot send a future guest their guide early ══════ */

test('I the send recomputes, and the request carries no recipients', async () => {
  const db = store();
  const mailer = countingMailer();

  const due = await guest(db, 'scaduta', { check_in: day(-1), check_out: day(2) });
  const future = await guest(db, 'futura', { check_in: day(14), check_out: day(16) });
  await scheduleGuideEmail({ store: db, reservation: future, now: NOW });

  /**
   * The old list, as a Staff phone left open since this morning would hold it:
   * both guests, because the rule had not been corrected yet.
   */
  const stale = [due.id, future.id];
  assert.equal(stale.length, 2);

  const outcome = await runGuideCatchUp({
    store: db, mailer, origin: 'https://g.example', now: NOW, confirm: true,
    // Whatever a client might try to pass alongside the confirmation is not read.
    rows: stale, ids: stale, eligible: 2,
  });

  assert.equal(outcome.attempted, 1, 'one, not the two the screen was showing');
  assert.equal(outcome.eligible, 1, 'and it says what it judged');
  assert.equal(mailer.sent.length, 1);
  assert.equal(outcome.results[0].reservation_id, due.id);

  const futureRow = await db.deliveries.findByReservation(future.id);
  assert.equal(futureRow.status, DELIVERY_STATUS.scheduled, 'the future guest was not written to');
  assert.equal((await db.reservations.get(future.id)).guide_email_status, 'pending');
});

test('I the HTTP send takes a confirmation and nothing else', async (t) => {
  const db = store();
  const token = 'staff-token';
  const future = await guest(db, 'futura', { check_in: day(14), check_out: day(16) });
  await scheduleGuideEmail({ store: db, reservation: future, now: NOW });

  const app = await createApp({
    store: db, stripe: createMockStripe(), staffToken: token, mode: 'production',
    allowPlaceholderPrices: true, cardSigningKey: 'catchup-due-test-key',
    publicUrl: 'http://127.0.0.1',
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const post = async (body) => {
    const response = await fetch(`${base}/api/staff/sync/guide-catchup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };

  // A client insisting on the list it is holding changes nothing about who is due.
  const sent = await post({ confirm: true, reservations: [future.id], eligible: 1 });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.attempted, 0, 'nobody is due, so nobody was written to');
  assert.equal(sent.body.eligible, 0);

  const row = await db.deliveries.findByReservation(future.id);
  assert.equal(row.status, DELIVERY_STATUS.scheduled);
});

/* ══ J. A future delivery row is not touched ══════════════════════════════ */

test('J a future delivery row comes through preview and send unchanged', async () => {
  const db = store();
  const mailer = countingMailer();

  const future = await guest(db, 'futura', { check_in: day(14), check_out: day(16) });
  await scheduleGuideEmail({ store: db, reservation: future, now: NOW });
  const before = structuredClone(await db.deliveries.findByReservation(future.id));

  // Somebody else is genuinely due, so the send does real work alongside it.
  const due = await guest(db, 'scaduta', { check_in: day(-1), check_out: day(2) });
  await scheduleGuideEmail({ store: db, reservation: due, now: NOW });

  await previewGuideCatchUp({ store: db, now: NOW });
  assert.deepEqual(await db.deliveries.findByReservation(future.id), before, 'the preview wrote nothing');

  const outcome = await runGuideCatchUp({ store: db, mailer, origin: 'https://g.example', now: NOW, confirm: true });
  assert.equal(outcome.sent, 1);
  assert.deepEqual(await db.deliveries.findByReservation(future.id), before,
    'and the send left the future row exactly as it found it');

  // Not even a second row beside it.
  assert.equal((await db.deliveries.list({})).filter((d) => d.reservation_id === future.id).length, 1);
  assert.equal((await db.reservations.get(future.id)).guide_email_status, 'pending');
});

/* ══ K. The ordinary scheduler is untouched ═══════════════════════════════ */

test('K the normal rule is still three days before arrival at ten, Florence', () => {
  assert.equal(GUIDE_EMAIL_LEAD_DAYS, 3);
  assert.equal(GUIDE_EMAIL_HOUR, '10:00');

  const diana = buildReservation({ check_in: '2026-10-14', check_out: '2026-10-16' });
  assert.equal(
    sendTimeFor(diana, { now: NOW }).toISOString(),
    propertyTimeToInstant('2026-10-11', '10:00').toISOString(),
    '11 October at ten, exactly as before',
  );

  const eileen = buildReservation({ check_in: '2027-04-23', check_out: '2027-04-25' });
  assert.equal(
    sendTimeFor(eileen, { now: NOW }).toISOString(),
    propertyTimeToInstant('2027-04-20', '10:00').toISOString(),
  );
});

test('K the scheduler still sends a future email when its morning arrives', async () => {
  const db = store();
  const mailer = countingMailer();

  const diana = await guest(db, 'diana', { check_in: day(7), check_out: day(9) });
  await scheduleGuideEmail({ store: db, reservation: diana, now: NOW });

  // Today: the catch-up leaves her alone and the scheduler has nothing due.
  const preview = await previewGuideCatchUp({ store: db, now: NOW });
  assert.equal(reasonOf(preview, diana.id), CATCHUP_SKIP.notDueYet);
  assert.equal((await sendDueGuideEmails({ store: db, mailer, origin: 'https://g.example', now: NOW })).length, 0);
  assert.equal(mailer.sent.length, 0);

  // Her morning: the scheduler sends it, by itself, with nobody pressing anything.
  const herMorning = t3(day(7));
  const due = await sendDueGuideEmails({ store: db, mailer, origin: 'https://g.example', now: herMorning });
  assert.equal(due.length, 1);
  assert.equal(due[0].reservation_id, diana.id);
  assert.equal(due[0].status, DELIVERY_STATUS.sent);
  assert.equal(mailer.sent.length, 1);

  // And the catch-up now reports her as done rather than as owed.
  const after = await previewGuideCatchUp({ store: db, now: herMorning });
  assert.equal(reasonOf(after, diana.id), CATCHUP_SKIP.alreadySent);
});

test('K a booking taken inside the window still goes out as soon as it is due', async () => {
  const db = store();
  const mailer = countingMailer();

  // Booked tonight, arriving tomorrow: T-3 is already behind us.
  const late = await guest(db, 'tardiva', { check_in: day(1), check_out: day(3) });
  await scheduleGuideEmail({ store: db, reservation: late, now: NOW });

  const row = await db.deliveries.findByReservation(late.id);
  assert.equal(row.send_at, NOW.toISOString(), 'now, not a morning that has gone');

  const due = await sendDueGuideEmails({ store: db, mailer, origin: 'https://g.example', now: NOW });
  assert.equal(due.length, 1, 'the ordinary scheduler handles it without any catch-up');
  assert.equal(mailer.sent.length, 1);
});
