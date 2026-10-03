/**
 * The operational half: what Diego and Jacopo actually do.
 *
 * Deliberately built on the same backend as the guest side rather than beside it.
 * There is one order, one reservation and one source of truth; the Staff app is a
 * different view of them, not a different system that has to be reconciled with the
 * first one at the end of the day.
 *
 * Two shapes run through here:
 *
 *   queues    orders grouped by what has to happen next, derived from the order's
 *             own fulfilment state rather than stored twice. "New" is not a flag
 *             somebody has to remember to clear.
 *   actions   one function per thing a person can decide, each of which moves money
 *             or fulfilment but never both by accident.
 *
 * Money moves only through the explicit actions. Marking a breakfast delivered does
 * not touch a payment; cancelling an authorised transfer releases the hold; getting
 * money back after it has been taken is a refund and is called one.
 */

import { PAYMENT_STATUS, FULFILMENT_STATUS, canFulfilmentMove } from '../commerce/schema.js';
import { canTransition, appendEvent } from './orders.js';
import { getProduct, cancellableUntil } from '../commerce/ordering.js';
import { propertyDate } from '../commerce/time.js';
import {
  buildReservation, upsertReservation, cancelReservation, staffView,
  rotateGuideToken, RESERVATION_STATUS, isLive,
} from './reservations.js';
import { scheduleGuideEmail, cancelGuideEmail, guideUrl, DELIVERY_STATUS } from './delivery.js';

/** The queues the Staff app shows, in the order they are worked. */
export const STAFF_QUEUES = ['new', 'awaiting', 'preparing', 'completed', 'cancelled'];

/**
 * Which queue an order belongs in.
 *
 * Derived, because a stored queue is a queue that goes stale. An order that has
 * been paid for and not yet picked up is new; one waiting on a driver is awaiting;
 * one somebody has started is preparing. Money that never arrived is not work.
 */
export function queueOf(order) {
  const money = order.status;
  const thing = order.fulfilment_status;

  if (money === PAYMENT_STATUS.cancelled || money === PAYMENT_STATUS.refunded || money === PAYMENT_STATUS.failed) {
    return 'cancelled';
  }
  if (thing === FULFILMENT_STATUS.cancelled || thing === FULFILMENT_STATUS.declined) return 'cancelled';
  if (thing === FULFILMENT_STATUS.completed || thing === FULFILMENT_STATUS.delivered) return 'completed';
  if (thing === FULFILMENT_STATUS['in-preparation'] || thing === FULFILMENT_STATUS['substitution-requested']) return 'preparing';
  if (thing === FULFILMENT_STATUS['awaiting-confirmation']) return 'awaiting';
  if (money === PAYMENT_STATUS.pending) return 'cancelled';   // checkout never finished
  return 'new';
}

/** True when this order is one of the express wine runs, for the notification wording. */
export const isExpress = (order) => order.lines.some(
  (line) => line.product_id === 'wine-in-room' && order.amount >= 9000,
);

/**
 * What staff see. Everything they need to act, nothing a guest's own tokens include:
 * the access token stays out, because a staff screen is a screenshot waiting to
 * happen and that token is the guest's key to their own order.
 */
export function staffOrderView(order, { now = new Date() } = {}) {
  return {
    id: order.id,
    reference: String(order.id).slice(0, 8).toUpperCase(),
    queue: queueOf(order),
    status: order.status,
    fulfilment_status: order.fulfilment_status,
    payment_mode: order.payment_mode,
    amount: order.amount,
    currency: order.currency,
    created_at: order.created_at,
    updated_at: order.updated_at,
    express: isExpress(order),
    customer: {
      name: order.customer?.name ?? '',
      email: order.customer?.email ?? '',
      phone: order.customer?.phone ?? '',
      room: order.customer?.room ?? '',
      booking_reference: order.customer?.booking_reference ?? '',
    },
    reservation_id: order.reservation_id ?? null,
    lines: order.lines.map((line) => {
      const product = getProduct(line.product_id);
      const cancellation = cancellableUntil(product, {
        date: line.date, time: line.time, slotId: line.slot_id,
      });
      return {
        product_id: line.product_id,
        variant_id: line.variant_id,
        title: line.title,
        variant_title: line.variant_title,
        quantity: line.quantity,
        amount: line.amount,
        date: line.date,
        time: line.time,
        slot_id: line.slot_id,
        room: line.room,
        options: line.options,
        fields: line.fields,
        partner: line.partner,
        fulfillment_type: line.fulfillment_type,
        /** So a screen can say "can still be called off until 17:30". */
        cancellable_until: cancellation.deadline ? cancellation.deadline.toISOString() : null,
        cancellable_now: cancellation.kind !== 'none'
          && (!cancellation.deadline || now <= cancellation.deadline),
      };
    }),
    provider: order.provider,
    entitlements: (order.entitlements ?? []).map((e) => ({ type: e.type, reference: e.reference })),
    events: order.events ?? [],
    stripe: {
      session: order.stripe_session_id ?? null,
      payment_intent: order.stripe_payment_intent_id ?? null,
    },
  };
}

/** Every queue at once, which is what the dashboard needs. */
export async function orderQueues({ store, limit = 200 }) {
  const orders = await store.orders.list({ limit });
  const queues = Object.fromEntries(STAFF_QUEUES.map((q) => [q, []]));
  for (const order of orders) queues[queueOf(order)].push(order);
  return queues;
}

/* ── Actions ───────────────────────────────────────────────────────────── */

const stamp = (order, type, note, by) => appendEvent(order, type, [by, note].filter(Boolean).join(': ')).events;

/** Move the thing, not the money. */
export async function setFulfilment({ store, order, to, note = '', by = 'staff' }) {
  if (!canFulfilmentMove(order.fulfilment_status, to)) {
    return { ok: false, reason: 'transition-not-allowed', from: order.fulfilment_status, to };
  }
  const updated = await store.orders.update(order.id, {
    fulfilment_status: to,
    events: stamp(order, `fulfilment:${to}`, note, by),
  });
  return { ok: true, order: updated };
}

/** The bottle is not there. Nothing is charged back; a person contacts the guest. */
export async function requestSubstitution({ store, order, note = '', by = 'staff' }) {
  return setFulfilment({
    store, order, to: FULFILMENT_STATUS['substitution-requested'], by,
    note: note || 'bottiglia non disponibile, contattare l’ospite per una proposta',
  });
}

/** Who is actually doing it: a driver's name, the professional's name. */
export async function assignOrder({ store, order, assignee, by = 'staff' }) {
  const name = String(assignee ?? '').trim().slice(0, 80);
  const updated = await store.orders.update(order.id, {
    provider: { ...order.provider, assignee: name || null, updated_at: new Date().toISOString() },
    events: stamp(order, 'assigned', name, by),
  });
  return { ok: true, order: updated };
}

/**
 * Call it off.
 *
 * An authorisation is released, because nothing was ever taken. Money already taken
 * is a different decision with a different name, so this refuses to quietly refund:
 * it cancels the fulfilment and says the refund is still outstanding.
 */
export async function cancelOrder({ store, stripe, order, note = '', by = 'staff' }) {
  if (order.status === PAYMENT_STATUS.authorized && order.stripe_payment_intent_id) {
    let released = true;
    const events = [...(order.events ?? [])];
    try {
      await stripe.cancelPaymentIntent(order.stripe_payment_intent_id, {}, { idempotencyKey: `cancel:${order.id}` });
    } catch (error) {
      released = false;
      events.push({ at: new Date().toISOString(), type: 'cancel-failed', note: error.message });
    }
    const updated = await store.orders.update(order.id, {
      status: PAYMENT_STATUS.cancelled,
      fulfilment_status: FULFILMENT_STATUS.cancelled,
      provider: { ...order.provider, status: 'cancelled', note, updated_at: new Date().toISOString(), authorisation_released: released },
      events: [...events, { at: new Date().toISOString(), type: 'cancelled', note: [by, note].filter(Boolean).join(': ') }],
    });
    return { ok: true, order: updated, released };
  }

  const moved = await setFulfilment({ store, order, to: FULFILMENT_STATUS.cancelled, note, by });
  if (!moved.ok) return moved;
  return {
    ok: true,
    order: moved.order,
    /** Said out loud rather than done silently. */
    refund_outstanding: order.status === PAYMENT_STATUS.paid,
  };
}

/** Give the money back. Separate from cancelling, because it is a separate decision. */
export async function refundOrder({ store, stripe, order, note = '', by = 'staff' }) {
  if (order.status !== PAYMENT_STATUS.paid) {
    return { ok: false, reason: 'not-refundable', status: order.status };
  }
  if (!canTransition(order.status, PAYMENT_STATUS.refunded)) {
    return { ok: false, reason: 'transition-not-allowed' };
  }
  try {
    await stripe.createRefund(
      { payment_intent: order.stripe_payment_intent_id },
      { idempotencyKey: `refund:${order.id}` },
    );
  } catch (error) {
    return { ok: false, reason: 'refund-failed', message: error.message };
  }
  const updated = await store.orders.update(order.id, {
    status: PAYMENT_STATUS.refunded,
    fulfilment_status: FULFILMENT_STATUS.cancelled,
    events: stamp(order, 'refunded', note, by),
  });
  return { ok: true, order: updated };
}

/* ── Reservations, by hand ─────────────────────────────────────────────── */

/**
 * Typed in by a person, because something did not arrive.
 *
 * The fallback, not the normal path — and it goes through exactly the same upsert
 * as an ingested notification, so a manual reservation gets a guide link and a
 * scheduled email like any other.
 */
export async function createManualReservation({ store, input, now = new Date() }) {
  const event = {
    ...input,
    kind: 'new',
    source: input.source || 'manual',
    booking_reference: String(input.booking_reference ?? '').trim() || `MAN-${Date.now().toString(36).toUpperCase()}`,
  };
  const result = await upsertReservation({ store, event, now });
  if (!result.ok) return result;
  await scheduleGuideEmail({ store, reservation: result.reservation, now, reason: 'manual' });
  return result;
}

/** Correct what we hold. Dates moving reschedules the email; the link never changes. */
export async function editReservation({ store, reservation, patch, now = new Date() }) {
  const allowed = [
    'first_name', 'last_name', 'guest_email', 'guest_phone', 'lang',
    'check_in', 'check_out', 'adults', 'children', 'guest_count', 'room', 'rate', 'notes',
  ];
  const clean = buildReservation({ ...reservation, ...patch });
  const update = {};
  for (const field of allowed) {
    if (patch[field] === undefined) continue;
    update[field] = clean[field];
  }
  if (Object.keys(update).length === 0) return { ok: true, action: 'unchanged', reservation };

  const updated = await store.reservations.update(reservation.id, {
    ...update,
    status: isLive(reservation) ? RESERVATION_STATUS.modified : reservation.status,
    history: [...(reservation.history ?? []), {
      at: now.toISOString(), type: 'edited-by-staff',
      detail: Object.entries(update).map(([k, v]) => `${k}: ${v}`).join(', ').slice(0, 300),
    }],
  });
  await scheduleGuideEmail({ store, reservation: updated, now, reason: 'edited' });
  return { ok: true, action: 'edited', reservation: updated };
}

export async function cancelReservationByStaff({ store, reservation, reason = '', now = new Date() }) {
  const cancelled = await cancelReservation({ store, reservation, reason, now });
  await cancelGuideEmail({ store, reservation: cancelled, reason: reason || 'cancellata dallo staff' });
  return { ok: true, reservation: cancelled };
}

/** The link to send, and a way to invalidate the old one when it has gone astray. */
export async function guideLinkFor({ store, reservation, origin, rotate = false }) {
  const current = rotate ? await rotateGuideToken({ store, reservation }) : reservation;
  return { link: guideUrl(origin, current), rotated: rotate };
}

/* ── Sync ──────────────────────────────────────────────────────────────── */

/**
 * The synchronisation screen: one row per reservation, and what has happened to it.
 *
 * Imported, guide created, email scheduled, email sent, needs review, calendar
 * mismatch. The last two are the ones that matter — everything else is confirmation
 * that the machinery is working.
 */
export async function syncOverview({ store, now = new Date() }) {
  const today = propertyDate(now);
  const reservations = await store.reservations.list({ limit: 300 });
  const deliveries = await store.deliveries.list({ limit: 300 });
  const alerts = await store.alerts.open();
  const byReservation = new Map(deliveries.map((d) => [d.reservation_id, d]));

  const rows = reservations
    .filter((r) => r.status !== RESERVATION_STATUS.completed || r.check_out >= today)
    .map((reservation) => {
      const delivery = byReservation.get(reservation.id) ?? null;
      const problems = [];
      if (!reservation.guest_email) problems.push('no-guest-email');
      if (!reservation.room) problems.push('no-room');
      if (!reservation.check_in || !reservation.check_out) problems.push('no-dates');
      if (delivery?.status === DELIVERY_STATUS.failed) problems.push('email-failed');
      if (isLive(reservation) && !delivery) problems.push('email-not-scheduled');

      return {
        reservation_id: reservation.id,
        guest: [reservation.first_name, reservation.last_name].filter(Boolean).join(' '),
        booking_reference: reservation.booking_reference,
        source: reservation.source,
        channel: reservation.channel,
        status: reservation.status,
        room: reservation.room,
        check_in: reservation.check_in,
        check_out: reservation.check_out,
        imported_at: reservation.created_at,
        guide_created: Boolean(reservation.guide_token),
        guide_created_at: reservation.guide_created_at,
        email_status: delivery?.status ?? 'none',
        email_due: delivery?.send_at ?? null,
        email_sent_at: delivery?.sent_at ?? null,
        needs_review: problems.length > 0,
        problems,
      };
    });

  return {
    today,
    rows,
    counts: {
      reservations: rows.length,
      needs_review: rows.filter((r) => r.needs_review).length,
      scheduled: rows.filter((r) => r.email_status === DELIVERY_STATUS.scheduled).length,
      sent: rows.filter((r) => r.email_status === DELIVERY_STATUS.sent || r.email_status === DELIVERY_STATUS.simulated).length,
    },
    alerts: alerts.map((alert) => ({
      id: alert.id, kind: alert.kind, severity: alert.severity, seen: alert.seen,
      detail: alert.detail, created_at: alert.created_at,
    })),
    mismatches: alerts.filter((a) => a.kind === 'occupancy-not-synchronised').length,
  };
}

/** The first screen: what needs doing, and who is arriving. */
export async function dashboard({ store, now = new Date() }) {
  const today = propertyDate(now);
  const queues = await orderQueues({ store });
  const reservations = await store.reservations.list({ limit: 300 });
  const live = reservations.filter((r) => isLive(r));
  const alerts = await store.alerts.open();

  return {
    today,
    orders: Object.fromEntries(STAFF_QUEUES.map((queue) => [queue, queues[queue].length])),
    arrivals: live.filter((r) => r.check_in === today).map(staffView),
    departures: live.filter((r) => r.check_out === today).map(staffView),
    inHouse: live.filter((r) => r.check_in <= today && r.check_out >= today).length,
    /** The soonest thing with a clock on it, so nothing is missed by looking late. */
    next: queues.new.concat(queues.awaiting, queues.preparing)
      .flatMap((order) => order.lines.map((line) => ({
        order_id: order.id, title: line.title, date: line.date, time: line.time, room: line.room,
      })))
      .filter((item) => item.date && item.date >= today)
      .sort((a, b) => `${a.date}${a.time ?? ''}`.localeCompare(`${b.date}${b.time ?? ''}`))
      .slice(0, 8),
    alerts: alerts.length,
  };
}
