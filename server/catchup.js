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

import { isLive } from './reservations.js';
import { propertyDate } from '../commerce/time.js';
import { roomsIn, roomList } from '../commerce/rooms.js';
import { DELIVERY_STATUS, deliverGuideEmail, renderGuideEmail } from './delivery.js';

/** Why a reservation is not in the catch-up. The breakdown staff read. */
export const CATCHUP_SKIP = {
  alreadySent: 'already-sent',
  cancelled: 'cancelled',
  past: 'past',
  provisional: 'provisional',
  noEmail: 'no-email',
  noToken: 'no-token',
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

/** Why this reservation is not eligible, or null when it is. */
function skipReason(reservation, delivery, today) {
  if (!isLive(reservation)) return CATCHUP_SKIP.cancelled;
  if (reservation.provisional === true) return CATCHUP_SKIP.provisional;
  // Gone home. A guide arriving after checkout is worse than none.
  if (reservation.check_out && reservation.check_out < today) return CATCHUP_SKIP.past;
  if (!reservation.guest_email) return CATCHUP_SKIP.noEmail;
  if (!reservation.guide_token) return CATCHUP_SKIP.noToken;
  if (alreadyWritten(reservation, delivery)) return CATCHUP_SKIP.alreadySent;
  return null;
}

/** One row as the Staff screen draws it. Never the whole address. */
const row = (reservation, delivery) => ({
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
    const reason = skipReason(reservation, delivery, today);
    if (reason) {
      counts[reason] += 1;
      skipped.push({ ...row(reservation, delivery), reason });
      continue;
    }
    eligible.push(row(reservation, delivery));
  }

  // The earliest arrival first: the people it matters most to reach.
  eligible.sort((a, b) => String(a.check_in).localeCompare(String(b.check_in)));

  return {
    ok: true,
    dryRun: true,
    today,
    considered: reservations.length,
    eligible: eligible.length,
    excluded: skipped.length,
    breakdown: counts,
    rows: eligible,
    skipped,
  };
}

/**
 * Send it, to exactly the guests the preview named.
 *
 * `confirm` is required and is not a default. The whole reason this operation
 * exists is that it is irreversible — a guest cannot be un-emailed — so it must be
 * impossible to trigger by requesting a URL, by a retry, or by a client that forgot
 * to send a body.
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
