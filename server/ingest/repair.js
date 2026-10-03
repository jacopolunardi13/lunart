/**
 * Repairing what a worse parser already filed.
 *
 * Normal ingestion is idempotent, and that is the problem. Every QuoVai
 * notification that was read successfully is in the dedupe store, so polling the
 * mailbox again — with a parser that now reads the guest's name and the room
 * number correctly — recognises each message as one it has already handled and
 * does nothing. The reservations stay wrong. Deleting the database to fix a
 * parsing bug is not an option when guests hold links to those rows.
 *
 * So this is the one operation that deliberately does not consult the dedupe
 * store. It is staff-triggered, never scheduled, and it is the only place in the
 * system where that is true: ordinary polling is untouched and stays exactly as
 * idempotent as it was.
 *
 * What it will not do is as important as what it does. It matches reservations
 * that already exist and enriches them in place; it never creates one, never
 * cancels or reinstates one, never moves the dates, never touches the guide token
 * or the guest-email state, and never schedules or sends anything. A guest who
 * already has their link keeps it, and a guest who has already had the email does
 * not get a second one.
 *
 * It is safe to run twice. The second run finds nothing left to change and says so.
 */

import { classifyQuovaiMessage, parseQuovaiEmail, isStatusWord } from './quovai-email.js';
import { repairReservation } from '../reservations.js';

/**
 * Find the reservation an email belongs to, including under its old bad key.
 *
 * The parser used to glue the status word onto the booking number, so the stay
 * QuoVai calls 6703524869 may be filed as "6703524869NEW". Looking it up by the
 * clean number alone would find nothing and the row would never be repaired — so
 * the search also accepts a stored reference that begins with the clean one and
 * continues with a status word, and nothing looser than that.
 */
export async function findForRepair({ store, source, booking_reference }) {
  const exact = await store.reservations.findByBooking(source, booking_reference);
  if (exact) return exact;

  const key = String(booking_reference).toUpperCase();
  const candidates = await store.reservations.filter((r) => {
    if (r.source !== source || typeof r.booking_reference !== 'string') return false;
    const stored = r.booking_reference.toUpperCase();
    if (!stored.startsWith(key) || stored === key) return false;
    // Whatever follows the real number has to be the status word that was glued
    // on. Anything else is a different booking that merely starts the same way.
    return isStatusWord(stored.slice(key.length).replace(/^[\s_-]*/, ''));
  });
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Re-read the mailbox and correct what is already filed.
 *
 * @returns a summary a person can read in one glance: how many messages were
 *   looked at, how many were reservations, how many matched a row we hold, how
 *   many rows actually changed, and what refused to read.
 */
export async function repairFromMailbox({ store, mailbox, limit = 200 }) {
  if (!mailbox) return { ok: false, reason: 'no-mailbox-configured' };
  if (!mailbox.configured) return { ok: false, reason: 'source-not-configured', source: mailbox.id };

  let messages;
  try {
    messages = await mailbox.fetchMessages();
  } catch (error) {
    return { ok: false, reason: error.code ?? 'fetch-failed', message: error.message, source: mailbox.id };
  }

  const summary = {
    ok: true,
    source: mailbox.id,
    scanned: 0,
    /** Not reservation notifications. Skipped in silence, as everywhere else. */
    ignored: 0,
    /** Reservation notifications we could read. */
    reservations: 0,
    /** Of those, the ones whose reservation we already hold. */
    matched: 0,
    /** Of those, the ones that actually had something to correct. */
    repaired: 0,
    /** Already right. A second run turns every repair into one of these. */
    unchanged: 0,
    /**
     * Read fine, but no reservation of ours answers to that booking number.
     * Left alone on purpose: creating one here would be ingestion wearing a
     * repair's clothes, and ingestion is what the next poll is for.
     */
    unmatched: 0,
    /** Reservation notifications that would not read, even now. */
    failed: 0,
    changes: [],
    problems: [],
  };

  for (const message of messages.slice(0, limit)) {
    summary.scanned++;

    const verdict = classifyQuovaiMessage(message);
    if (!verdict.relevant) { summary.ignored++; continue; }

    const parsed = parseQuovaiEmail(message);
    if (!parsed.ok) {
      summary.failed++;
      summary.problems.push({ subject: message.subject ?? '', reason: parsed.reason });
      continue;
    }
    summary.reservations++;

    const event = parsed.event;
    const existing = await findForRepair({
      store, source: event.source, booking_reference: event.booking_reference,
    });
    if (!existing) { summary.unmatched++; continue; }
    summary.matched++;

    const outcome = await repairReservation({ store, reservation: existing, event });
    if (!outcome.ok) {
      summary.failed++;
      summary.problems.push({ booking_reference: event.booking_reference, reason: outcome.reason });
      continue;
    }
    if (outcome.action === 'repaired') {
      summary.repaired++;
      summary.changes.push({
        booking_reference: outcome.reservation.booking_reference,
        guest: [outcome.reservation.first_name, outcome.reservation.last_name].filter(Boolean).join(' '),
        fields: Object.keys(outcome.changed),
      });
    } else {
      summary.unchanged++;
    }
  }

  return summary;
}
