/**
 * Recovering the reservations that were already there before LunArt was watching.
 *
 * The incremental poll asks Gmail for `from:quovai newer_than:7d`, which is right
 * for keeping up and useless for starting. A booking made in September for a stay
 * in October had its NEW notification arrive weeks ago; the window has long since
 * slid past it, and nothing will ever bring it back. So on the day the mailbox was
 * connected, LunArt knew about the stays booked that week and about none of the
 * rest — including guests already on their way.
 *
 * This is the other half: reach back as far as asked, in pages, and ingest what
 * was missed. It is not the poll running with a wider query, and it is not
 * `repair.js`.
 *
 *   poll      keeps up with what arrives
 *   backfill  recovers what was never seen        ← this file
 *   repair    corrects what was seen badly
 *
 * The three are kept apart because they differ in the one thing that matters: what
 * they are allowed to do to a reservation that already exists. The poll and the
 * backfill go through the same idempotent pipeline and create; repair never
 * creates and only enriches. Running the backfill twice is therefore safe for the
 * same reason running the poll twice is — the message id was remembered the first
 * time — and no guide link is reissued, no guest email is scheduled a second time,
 * and nothing already sent is unsent.
 *
 * Order matters more here than anywhere else. A booking that was made, changed and
 * then cancelled over three weeks has three notifications, and applying them in
 * the wrong order leaves a cancelled stay looking live. Gmail hands back newest
 * first, so everything is reversed before a single message is ingested.
 */

import { classifyQuovaiMessage } from './quovai-email.js';

/** How far back to look, when nobody says. Long enough to cover a season. */
export const DEFAULT_BACKFILL_DAYS = 365;

/** How many messages to take in one run, so a first attempt cannot run all night. */
export const DEFAULT_BACKFILL_CAP = 500;

/**
 * Read the mailbox as far back as asked and ingest whatever was missed.
 *
 * `ingest` is the ordinary pipeline, injected rather than imported so the caller
 * decides what "ingest" means and the tests can watch it. The mailbox has to be
 * able to answer a different query from its usual one; a mailbox that cannot
 * (the in-memory one) simply hands over everything it holds, which is the same
 * thing for its purposes.
 */
export async function backfillFromMailbox({
  store,
  mailbox,
  ingest,
  days = DEFAULT_BACKFILL_DAYS,
  cap = DEFAULT_BACKFILL_CAP,
  now = new Date(),
}) {
  if (!mailbox) return { ok: false, reason: 'no-mailbox-configured' };
  if (!mailbox.configured) return { ok: false, reason: 'source-not-configured', source: mailbox.id };

  let messages;
  try {
    /**
     * A wider window, and more of it.
     *
     * `fetchMessages` takes the overrides where the adapter supports them; the
     * in-memory mailbox ignores both and returns its queue, which is exactly what
     * a test wants.
     *
     * Nothing here writes to the mailbox. Labelling lives in `pollMailbox`, which
     * applies it only after a message has actually been ingested, and this function
     * never calls it — so a backfill can be run again tomorrow without the first one
     * having hidden anything from it, and a backfill that dies halfway through has
     * changed nothing about what the next one will see.
     */
    messages = await mailbox.fetchMessages({
      query: backfillQuery(mailbox.query, days),
      max: cap,
    });
  } catch (error) {
    return { ok: false, reason: error.code ?? 'fetch-failed', message: error.message, source: mailbox.id };
  }

  /**
   * Oldest first, always.
   *
   * A NEW must be applied before the MODIFIED that followed it and before the
   * CANCELLED that followed that, or the stay ends up in whichever state happened
   * to arrive last in the listing. Gmail sorts newest first; the adapter may
   * already have reversed it, so this sorts on the date rather than trusting
   * either of them.
   */
  const ordered = [...messages].sort((a, b) => (
    String(a.receivedAt ?? a.internalDate ?? '').localeCompare(String(b.receivedAt ?? b.internalDate ?? ''))
  ));

  const summary = {
    ok: true,
    source: mailbox.id,
    days,
    scanned: ordered.length,
    /** How many of those were actually reservation notifications. */
    reservationEvents: 0,
    /** The rest: schedine, online check-ins, anything else QuoVai sends. */
    ignored: 0,
    created: 0,
    modified: 0,
    cancelled: 0,
    /** Already known, and already right. The whole second run looks like this. */
    unchanged: 0,
    duplicates: 0,
    failed: 0,
    recovered: [],
    problems: [],
  };

  const relevant = ordered.filter((message) => {
    const verdict = classifyQuovaiMessage(message);
    if (verdict.relevant) return true;
    summary.ignored++;
    return false;
  });
  summary.reservationEvents = relevant.length;

  if (relevant.length === 0) return summary;

  const outcome = await ingest({ store, messages: relevant, now });

  for (let i = 0; i < relevant.length; i++) {
    const result = outcome.results?.[i];
    if (!result) continue;
    if (result.ok === false) {
      summary.failed++;
      summary.problems.push({ subject: relevant[i].subject ?? '', reason: result.reason });
      continue;
    }
    switch (result.action) {
      case 'created':
        summary.created++;
        if (result.reservation) {
          summary.recovered.push({
            guest: [result.reservation.first_name, result.reservation.last_name].filter(Boolean).join(' '),
            booking_reference: result.reservation.booking_reference,
            room: result.reservation.room || null,
            check_in: result.reservation.check_in,
            check_out: result.reservation.check_out,
          });
        }
        break;
      case 'modified':
      case 'reinstated':
        summary.modified++;
        break;
      case 'cancelled':
      case 'cancelled-unknown':
        summary.cancelled++;
        break;
      case 'duplicate':
        summary.duplicates++;
        break;
      case 'unchanged':
        summary.unchanged++;
        break;
      default:
        break;
    }
  }

  return summary;
}

/**
 * The same mailbox, asked to look further back.
 *
 * Whatever the configured query is, its `newer_than:` is replaced rather than
 * appended to — two of them in one Gmail query is not an error, it is just the
 * narrower one winning, which would silently do nothing.
 *
 * Everything else in the configured query is left alone, including a
 * `-label:lunart-processed` exclusion if there is one. That is deliberate: the poll
 * labels a message only once it has been ingested, so a labelled message is one that
 * was seen, and the messages this job exists to find are precisely the unlabelled
 * ones. Dropping the exclusion would re-read a year of mail to reach the same answer
 * — harmless, because the message ids are remembered, and several times the work.
 */
export function backfillQuery(configured = '', days = DEFAULT_BACKFILL_DAYS) {
  const base = String(configured || 'from:quovai').replace(/\bnewer_than:\S+/gi, '').replace(/\s+/g, ' ').trim();
  return `${base} newer_than:${Math.max(1, Math.trunc(days))}d`.trim();
}
