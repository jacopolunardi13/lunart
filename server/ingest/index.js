/**
 * Where reservations come in.
 *
 * Four sources, one destination. Whatever arrives — a QuoVai email, a webhook
 * QuoVai does not yet offer, an iCal feed, a member of staff typing — becomes a
 * canonical event and goes through this one function. That is what keeps the rest
 * of the system from growing a second notion of what a reservation is.
 *
 * The pipeline is deliberately boring:
 *
 *   message → adapter → canonical event → dedupe → upsert → schedule the email
 *
 * Dedupe comes before the upsert, not after, because the expensive mistake is not
 * a duplicate row: it is a second guide email to a guest who already has one.
 */

import { upsertReservation, cancelReservation, RESERVATION_STATUS } from '../reservations.js';
import { scheduleGuideEmail, cancelGuideEmail } from '../delivery.js';
import { parseQuovaiEmail, isQuovaiMessage, classifyQuovaiMessage } from './quovai-email.js';

/**
 * Handle one canonical event.
 *
 * `message_id` is what makes this idempotent. Deliver the same QuoVai notification
 * twice and the second one is recognised and dropped, whatever it would have done.
 */
export async function ingestEvent({ store, event, now = new Date() }) {
  if (!event?.booking_reference) return { ok: false, reason: 'missing-booking-reference' };

  if (event.message_id && await store.messages.seen(event.message_id)) {
    return { ok: true, action: 'duplicate', message_id: event.message_id };
  }

  let result;
  if (event.kind === 'cancelled') {
    const existing = await store.reservations.findByBooking(event.source, event.booking_reference);
    if (!existing) {
      // A cancellation for something we never saw. Recorded as a reservation in the
      // cancelled state rather than dropped: it is the only trace that the stay
      // existed, and the Staff app has to be able to show it.
      const created = await upsertReservation({
        store,
        event: { ...event, status: RESERVATION_STATUS.cancelled },
        now,
      });
      if (created.ok) await cancelReservation({ store, reservation: created.reservation, reason: 'cancellata alla ricezione', now });
      // Unless the calendar had already told us the room was taken, in which case
      // this is an ordinary cancellation of a stay we did know about.
      result = {
        ok: true,
        action: created.action === 'completed' ? 'cancelled' : 'cancelled-unknown',
        reservation: created.reservation ?? null,
      };
    } else {
      const cancelled = await cancelReservation({ store, reservation: existing, reason: event.reason ?? '', now });
      await cancelGuideEmail({ store, reservation: cancelled });
      result = { ok: true, action: 'cancelled', reservation: cancelled };
    }
  } else {
    const upserted = await upsertReservation({ store, event, now });
    if (!upserted.ok) return upserted;
    // A created or rescheduled stay needs its email dated; an unchanged one does
    // not, so a mailbox polled every ten minutes does not keep rewriting the row.
    if (upserted.action !== 'unchanged') {
      await scheduleGuideEmail({ store, reservation: upserted.reservation, now, reason: upserted.action });
    }
    result = upserted;
  }

  if (event.message_id) {
    await store.messages.remember(event.message_id, {
      source: event.source,
      kind: event.kind,
      booking_reference: event.booking_reference,
      action: result.action,
    });
  }
  return result;
}

/**
 * Handle one email.
 *
 * Provider-neutral on purpose: this takes a plain object with a subject and a body.
 * Gmail, IMAP, a forwarded webhook or a file on disk all reduce to that, which is
 * why the tests can run the real path against fixtures with no mailbox anywhere.
 */
export async function ingestMessage({ store, message, now = new Date() }) {
  /**
   * Two kinds of "no", and they are not the same kind.
   *
   * The reservation mailbox also carries the police forms waiting to be filed and
   * a note every time somebody finishes the online check-in. Those are not stays,
   * they were never going to parse as one, and turning each into "notifica non
   * interpretabile" is how a warning list becomes something nobody reads. They are
   * dropped without a sound.
   *
   * A message that *is* a reservation notification and will not parse is the
   * opposite: a guest is arriving whether or not the email made sense, so that one
   * goes in front of staff every time.
   */
  const verdict = classifyQuovaiMessage(message);
  if (!verdict.relevant) {
    return { ok: false, ignored: true, reason: verdict.reason, notice: verdict.notice ?? null };
  }

  const parsed = parseQuovaiEmail(message);
  if (!parsed.ok) {
    await raiseAlert({
      store,
      key: `unparsed:${message.messageId ?? parsed.reason}`,
      kind: 'unreadable-notification',
      detail: {
        reason: parsed.reason,
        subject: message.subject ?? '',
        booking_reference: parsed.booking_reference ?? null,
      },
    });
    return parsed;
  }

  return ingestEvent({ store, event: parsed.event, now });
}

/** Several at once, oldest first, each one independent of the others. */
export async function ingestMessages({ store, messages = [], now = new Date() }) {
  const results = [];
  for (const message of messages) {
    try {
      results.push(await ingestMessage({ store, message, now }));
    } catch (error) {
      results.push({ ok: false, reason: 'ingest-failed', error: String(error.message ?? error) });
    }
  }
  return {
    processed: results.length,
    created: results.filter((r) => r.action === 'created').length,
    modified: results.filter((r) => r.action === 'modified' || r.action === 'reinstated').length,
    cancelled: results.filter((r) => String(r.action ?? '').startsWith('cancelled')).length,
    duplicates: results.filter((r) => r.action === 'duplicate').length,
    unchanged: results.filter((r) => r.action === 'unchanged').length,
    /** Not reservations at all. Counted so a quiet morning is visibly quiet. */
    ignored: results.filter((r) => r.ignored === true).length,
    /** Reservation notifications that would not read. Each one raised a warning. */
    failed: results.filter((r) => r.ok === false && !r.ignored).length,
    results,
  };
}

/**
 * Something staff have to look at.
 *
 * Keyed, so the same problem seen on five polls is one alert with a count rather
 * than five identical rows nobody reads.
 */
export async function raiseAlert({ store, key, kind, detail = {}, severity = 'warning' }) {
  const existing = await store.alerts.findByKey(key);
  if (existing) {
    if (existing.status !== 'open') {
      return store.alerts.update(existing.id, { status: 'open', seen: (existing.seen ?? 1) + 1, detail });
    }
    return store.alerts.update(existing.id, { seen: (existing.seen ?? 1) + 1, detail });
  }
  return store.alerts.create({ key, kind, severity, status: 'open', seen: 1, detail });
}

export async function resolveAlert({ store, id, note = '' }) {
  const alert = await store.alerts.get(id);
  if (!alert) return null;
  return store.alerts.update(id, { status: 'resolved', resolved_at: new Date().toISOString(), note });
}

export { parseQuovaiEmail, isQuovaiMessage, classifyQuovaiMessage };
