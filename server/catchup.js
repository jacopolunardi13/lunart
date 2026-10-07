/**
 * Launch day: the guests who are already here.
 *
 * The normal rule does not change and is not touched by this file — a guide goes
 * out three days before arrival at ten in the morning, Florence time, and a
 * booking taken inside that window goes out as soon as it is due. That rule looks
 * forward. On the day production starts there is a backlog it cannot see: people
 * with a reservation whose T-3 moment has already passed, or who were booked while
 * the mailer was a stand-in, and who will otherwise simply never be written to.
 *
 * So this is a separate, one-off operation with a person's finger on it. It is not
 * scheduled, it does not run at boot, it does not run when Gmail is configured, and
 * it does not run on deploy. A human opens the Staff app, reads exactly who would
 * be written to, and presses a second button.
 *
 * ── The distinction that matters ─────────────────────────────────────────────
 *
 * `sent` means a mail provider accepted the message. `simulated` means there was
 * no provider and the text was written to the record so somebody could read it.
 * The ordinary scheduler treats both as finished, which is right for it: it must
 * not send twice and in staging there is nothing to send with.
 *
 * Here they are opposite. A `simulated` row is precisely a guest who has *not*
 * been written to, and if staging data is ever carried into production those rows
 * are the backlog rather than the done pile. A `sent` row is the one thing that
 * stops this operation touching somebody — which is also what makes running it
 * twice safe.
 */

import { isLive, RESERVATION_STATUS } from './reservations.js';
import { propertyDate } from '../commerce/time.js';
import { roomsIn, roomList } from '../commerce/rooms.js';
import { DELIVERY_STATUS, deliverGuideEmail, renderGuideEmail, sendTimeFor } from './delivery.js';

/**
 * Why a reservation is not in the catch-up. The breakdown staff read.
 *
 * Each one is a different thing to do about it, which is the only reason to have
 * more than one. `cancelled` is somebody calling off a stay; `past` is a stay that
 * finished; `not-due-yet` is a guest the ordinary scheduler is going to write to
 * on its own, at the hour the product promises, and whom this operation must leave
 * entirely alone.
 */
export const CATCHUP_SKIP = {
  alreadySent: 'already-sent',
  cancelled: 'cancelled',
  past: 'past',
  /** Live, complete, and simply not owed the guide yet. Not backlog. */
  notDueYet: 'not-due-yet',
  provisional: 'provisional',
  noEmail: 'no-email',
  noToken: 'no-token',
  /** No check-in date, so there is no T-3 moment to be past. */
  noDates: 'no-dates',
  other: 'other',
};

/**
 * Enough of an address to say which guest it is, without printing the lot.
 *
 * Staff need to recognise the row and check it is the right person; they do not
 * need the whole mailbox on a phone screen in a breakfast room. The domain stays
 * because a typo in it is the mistake worth catching.
 */
export function maskEmail(address) {
  const [name = '', domain = ''] = String(address ?? '').split('@');
  if (!name || !domain) return '';
  const head = name.slice(0, 2);
  return `${head}${'•'.repeat(Math.max(1, name.length - 2))}@${domain}`;
}

/**
 * Whether a real message has already reached this person.
 *
 * Two records can say so and they are checked as one, because they are written
 * together but could arrive apart — an import, a repair, a delivery row pruned
 * from an old store. Either one reading `sent` is enough to leave the guest
 * alone; that is the asymmetry the operation needs. `simulated` is not `sent` in
 * either place, and `scheduled` or `failed` mean the opposite of done.
 */
const alreadyWritten = (reservation, delivery) =>
  delivery?.status === DELIVERY_STATUS.sent
  || reservation?.guide_email_status === DELIVERY_STATUS.sent;

/**
 * When this guest's guide is actually owed, in full.
 *
 * The rule is not restated here. It is `sendTimeFor` in `server/delivery.js` —
 * three days before check-in at ten in the morning, Florence time, clamped to now
 * once that moment has gone — and this operation has no business owning a second
 * copy of it. Where a delivery row exists, its `send_at` is the schedule as the
 * system actually holds it, and it is read rather than recomputed.
 *
 * Both, and the *later* of the two, for a reason worth spelling out. A `simulated`
 * row keeps the `send_at` it was first given: `scheduleGuideEmail` deliberately
 * does not move it, because for the ordinary scheduler a simulated row is
 * finished. So a staging simulation from last week sitting on a stay in April 2027
 * carries a `send_at` in the past, and trusting the row alone would make that
 * guest look like backlog and write to them seven months early. Taking the later
 * moment means neither source can accelerate the other, which is the one property
 * this whole operation needs.
 *
 * Null only when there is no check-in date and no scheduled moment either — a
 * record with no dates has no T-3 to be past.
 */
function dueAt(reservation, delivery, now) {
  const moments = [
    sendTimeFor(reservation, { now }),
    delivery?.send_at ? new Date(delivery.send_at) : null,
  ].filter((at) => at instanceof Date && !Number.isNaN(at.getTime()));

  if (moments.length === 0) return null;
  return new Date(Math.max(...moments.map((at) => at.getTime())));
}

/**
 * Why this reservation is not eligible, or null when it is.
 *
 * The order is the answer. It used to open with `if (!isLive) return cancelled`,
 * which folded every finished stay into the cancellation count — a production dry
 * run reported "cancelled: 65" for a store whose cancellations were a handful and
 * whose other sixty-odd were simply guests who had already gone home. So the
 * non-live statuses are now told apart: an explicit cancellation is a cancellation,
 * a checkout in the past is `past` whatever the status field has got round to
 * saying, and anything else non-live says so rather than borrowing a word.
 *
 * Due-time comes last, so a guest who is also missing an address is reported for
 * the address rather than for the clock, and a guest already written to stays
 * `already-sent` even when their moment has passed. `due` is `dueAt`'s answer,
 * passed in because the caller prints it on the row either way.
 */
function skipReason(reservation, delivery, { today, now, due }) {
  if (reservation.status === RESERVATION_STATUS.cancelled) return CATCHUP_SKIP.cancelled;
  // Gone home. A guide arriving after checkout is worse than none — and the
  // checkout date is the fact, whether or not the nightly sweep has marked it.
  if (reservation.check_out && reservation.check_out < today) return CATCHUP_SKIP.past;
  if (reservation.status === RESERVATION_STATUS.completed) return CATCHUP_SKIP.past;
  if (!isLive(reservation)) return CATCHUP_SKIP.other;

  if (reservation.provisional === true) return CATCHUP_SKIP.provisional;
  if (!reservation.guest_email) return CATCHUP_SKIP.noEmail;
  if (!reservation.guide_token) return CATCHUP_SKIP.noToken;
  if (alreadyWritten(reservation, delivery)) return CATCHUP_SKIP.alreadySent;

  /**
   * And the one this operation exists to get right.
   *
   * The catch-up is for guests whose moment went by while production mail was not
   * running. A guest arriving in a fortnight has not been missed: the scheduler
   * will write to them three days before they arrive, at ten, which is the
   * promise. Pressing a launch button must not turn that into today.
   */
  if (!due) return CATCHUP_SKIP.noDates;
  if (due.getTime() > now.getTime()) return CATCHUP_SKIP.notDueYet;

  return null;
}

/** One row as the Staff screen draws it. Never the whole address. */
const row = (reservation, delivery, due) => ({
  reservation_id: reservation.id,
  guest: [reservation.first_name, reservation.last_name].filter(Boolean).join(' ').trim(),
  /** One room, or all of them: `302, 303, 304 e 305`. The label is the screen's. */
  room: roomList(roomsIn(reservation)) || (reservation.room ?? ''),
  rooms: roomsIn(reservation),
  check_in: reservation.check_in ?? '',
  check_out: reservation.check_out ?? '',
  reference: reservation.staff_ref ?? reservation.booking_reference ?? '',
  email: maskEmail(reservation.guest_email),
  /** What the record says today: scheduled, simulated, failed, or nothing at all. */
  delivery_status: delivery?.status ?? 'none',
  delivery_sent_at: delivery?.sent_at ?? null,
  /**
   * The same question asked of the reservation.
   *
   * Shown beside the delivery state rather than instead of it, because when the
   * two disagree that is itself the thing staff need to see.
   */
  guide_email_status: reservation.guide_email_status ?? 'pending',
  /**
   * When the ordinary rule says this guide is owed.
   *
   * On an eligible row it is the moment that has already gone; on a skipped one it
   * is the morning the scheduler will write to them by itself. Printed so a person
   * can check the rule rather than take the verdict on trust — "non ancora in
   * scadenza" is much easier to believe next to "11 ott 10:00".
   */
  due_at: due ? due.toISOString() : null,
});

/**
 * Who the catch-up would write to, and who it would not.
 *
 * Read-only in every sense: it opens no mailer, and the caller cannot make it
 * send by passing something. Sending is `runGuideCatchUp`, which is a different
 * function reached by a different HTTP verb.
 */
export async function previewGuideCatchUp({ store, now = new Date() }) {
  const today = propertyDate(now);
  const reservations = await store.reservations.list({ limit: 1000 });

  const eligible = [];
  const skipped = [];
  const counts = Object.fromEntries(Object.values(CATCHUP_SKIP).map((reason) => [reason, 0]));

  for (const reservation of reservations) {
    const delivery = await store.deliveries.findByReservation(reservation.id);
    const due = dueAt(reservation, delivery, now);
    const reason = skipReason(reservation, delivery, { today, now, due });
    if (reason) {
      counts[reason] += 1;
      skipped.push({ ...row(reservation, delivery, due), reason });
      continue;
    }
    eligible.push(row(reservation, delivery, due));
  }

  // The earliest arrival first: the people it matters most to reach.
  eligible.sort((a, b) => String(a.check_in).localeCompare(String(b.check_in)));

  return {
    ok: true,
    dryRun: true,
    today,
    /** The instant every due-time decision in this answer was made against. */
    at: now.toISOString(),
    considered: reservations.length,
    eligible: eligible.length,
    excluded: skipped.length,
    breakdown: counts,
    rows: eligible,
    skipped,
  };
}

/**
 * Send it, to exactly the guests who are owed it at the moment the button is pressed.
 *
 * `confirm` is required and is not a default. The whole reason this operation
 * exists is that it is irreversible — a guest cannot be un-emailed — so it must be
 * impossible to trigger by requesting a URL, by a retry, or by a client that forgot
 * to send a body.
 *
 * **The list is recomputed here, and the caller cannot supply one.** That is
 * deliberate and it is the safeguard that matters most: a Staff phone left open
 * since this morning is holding a list that was true this morning. If the rule has
 * been corrected since, or a guest has been written to, or a stay has been called
 * off, the browser does not know. So the request carries one word — `confirm` —
 * and nothing that could be mistaken for a recipient. Whatever the screen is
 * showing, what leaves is what `previewGuideCatchUp` says now; the answer reports
 * `attempted`, so a person can see when it differed from what they were looking at.
 *
 * Idempotent by the same rule the preview uses: a row that is `sent` is not
 * eligible, and sending writes `sent`. Run it twice and the second run has nothing
 * to do, which is what a nervous person will want to check.
 */
export async function runGuideCatchUp({ store, mailer, origin, now = new Date(), confirm = false }) {
  if (confirm !== true) {
    return { ok: false, reason: 'not-confirmed', dryRun: true };
  }

  const preview = await previewGuideCatchUp({ store, now });
  const results = [];

  for (const candidate of preview.rows) {
    const reservation = await store.reservations.get(candidate.reservation_id);
    if (!reservation) continue;

    /**
     * The delivery row this send is recorded against.
     *
     * Most eligible reservations already have one — scheduled for a T-3 moment
     * that has passed, or `simulated` from before there was a mailer. It is reused
     * so one reservation keeps one delivery record, and a second row claiming a
     * second email is never created.
     */
    const existing = await store.deliveries.findByReservation(reservation.id);
    const delivery = existing ?? await store.deliveries.create({
      reservation_id: reservation.id,
      to: reservation.guest_email,
      lang: reservation.lang ?? 'it',
      /**
       * Now, because this guest's own moment has already gone — that is what made
       * them eligible — and the row is being written at the moment they are
       * actually being sent to.
       */
      send_at: now.toISOString(),
      status: DELIVERY_STATUS.scheduled,
      attempts: 0,
      sent_at: null,
      provider: null,
      error: null,
      reason: 'launch catch-up',
    });

    const written = await deliverGuideEmail({
      store,
      mailer,
      origin,
      reservation,
      // The address on the reservation is the current one; a delivery row written
      // weeks ago may predate a correction.
      delivery: { ...delivery, to: reservation.guest_email, lang: reservation.lang ?? delivery.lang ?? 'it' },
      now,
    });

    results.push({
      reservation_id: reservation.id,
      guest: candidate.guest,
      status: written?.status ?? DELIVERY_STATUS.failed,
      error: written?.error ?? null,
    });
  }

  const by = (status) => results.filter((r) => r.status === status).length;
  return {
    ok: true,
    dryRun: false,
    /** The instant eligibility was judged against — here, not in the browser. */
    at: now.toISOString(),
    /** How many were owed the guide when the button was actually pressed. */
    eligible: preview.eligible,
    provider: mailer?.id ?? null,
    /** False where no provider is configured: nothing actually left the building. */
    delivered: mailer?.configured !== false,
    attempted: results.length,
    sent: by(DELIVERY_STATUS.sent),
    simulated: by(DELIVERY_STATUS.simulated),
    failed: by(DELIVERY_STATUS.failed),
    results,
  };
}

/** What one of these emails looks like, for a staff member who wants to read it first. */
export const catchUpSample = ({ reservation, origin, lang = 'it' }) =>
  renderGuideEmail({ reservation, origin, lang });
