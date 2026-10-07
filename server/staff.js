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
import { canTransition, appendEvent, orderReference } from './orders.js';
import { roomsIn, roomList } from '../commerce/rooms.js';
import { reconcileExternalRefund, REFUND_SOURCES } from './refunds.js';
import { getProduct, cancellableUntil } from '../commerce/ordering.js';
import { propertyDate, addDays } from '../commerce/time.js';
import {
  buildReservation, upsertReservation, cancelReservation, staffView,
  rotateGuideToken, RESERVATION_STATUS, isLive, incompleteFields,
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
    reference: orderReference(order),
    queue: queueOf(order),
    status: order.status,
    fulfilment_status: order.fulfilment_status,
    payment_mode: order.payment_mode,
    amount: order.amount,
    currency: order.currency,
    /** What has come back, and who sent it back. */
    refunded_amount: Number(order.refunded_amount ?? 0),
    cancelled_amount: Number(order.cancelled_amount ?? 0),
    /**
     * True when the guest called part of this off themselves.
     *
     * Staff have to know, and they have to know without reading a ledger: a brunch
     * that was paid for and then cancelled at nine the evening before is a brunch
     * the kitchen must not make, and the only trace of that decision is here.
     */
    guest_cancelled: (order.lines ?? []).some((line) => (
      (line.cancellations ?? []).some((entry) => entry.actor === 'guest')
    )),
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
        /** And what has actually been called off, by whom, and for how much. */
        cancelled_quantity: Number(line.cancelled_quantity ?? 0),
        cancelled_by: line.cancelled_by ?? null,
        cancelled_at: line.cancelled_at ?? null,
        refunded_amount: Number(line.refunded_amount ?? 0),
        cancellations: (line.cancellations ?? []).map((entry) => ({
          at: entry.at, quantity: entry.quantity, amount: entry.amount,
          actor: entry.actor, outcome: entry.outcome, reason: entry.reason ?? '',
        })),
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

  /**
   * The money is back. Now the records, through the one path that writes a refund.
   *
   * This used to move the status and stamp the log, which left the same hole the
   * webhook had: a fully refunded Privilege Card went on issuing a valid QR, and a
   * venue would have honoured it. The amount and the revocation belong to
   * `reconcileExternalRefund`, so there is exactly one definition of what a full
   * refund does to an order — whoever pressed the button.
   */
  const reconciled = await reconcileExternalRefund({
    store,
    order,
    amount: Number(order.amount ?? 0),
    full: true,
    source: REFUND_SOURCES.staff,
    actor: by,
    reason: note,
  });
  if (!reconciled.ok) return reconciled;

  /**
   * The thing itself, which this action has always moved and still should.
   *
   * `reconcileExternalRefund` leaves `fulfilment_status` alone on purpose — it
   * reconciles refunds it hears about after the fact, and overwriting a breakfast
   * that really was delivered would erase something that happened. Here a person is
   * standing at the screen refunding the whole order on purpose, so saying the
   * thing is off is the honest reading, and it is what this button already did.
   */
  const updated = canFulfilmentMove(reconciled.order.fulfilment_status, FULFILMENT_STATUS.cancelled)
    ? await store.orders.update(order.id, { fulfilment_status: FULFILMENT_STATUS.cancelled })
    : reconciled.order;

  return {
    ok: true,
    order: updated,
    /** Which cards stopped working because of this, for the answer staff read. */
    revoked: reconciled.revoked,
  };
}

/**
 * A refund that already happened somewhere this server cannot see.
 *
 * The rare case, and a real one. A card was bought for €15 while production was
 * briefly pointed at a different live Stripe account; the charge was refunded from
 * that account's dashboard, and that account had no webhook pointing here. The
 * money is genuinely gone and the current Stripe credentials cannot even retrieve
 * the payment intent to prove it — it belongs to another account.
 *
 * So this is the one operation that writes a refund on a person's word. It makes no
 * provider call of any kind and moves no money: the refund has happened, somebody
 * has verified it at the provider, and all that is left is for the records to say
 * so. Which is also why it insists on being meant — an explicit confirmation, an
 * exact order, and the actor and reason written into the order's own history
 * alongside the provider's refund reference where there is one.
 *
 * Everything it then does is `reconcileExternalRefund`, unchanged: the same status,
 * the same amount, the same revocation the webhook would have performed had it
 * arrived. Run it twice and the second run reports `unchanged`.
 */
export async function reconcileRefundByHand({
  store, order, confirm = false, actor = 'staff', reason = '', providerReference = '', now = new Date(),
}) {
  if (!order) return { ok: false, reason: 'not-found' };
  if (confirm !== true) return { ok: false, reason: 'not-confirmed' };

  return reconcileExternalRefund({
    store,
    order,
    /** The whole order, because this operation exists only for a full refund. */
    amount: Number(order.amount ?? 0),
    full: true,
    reference: String(providerReference ?? '').trim().slice(0, 120) || null,
    source: REFUND_SOURCES.staff,
    actor: String(actor ?? 'staff').slice(0, 60),
    reason: String(reason ?? '').slice(0, 300),
    now,
  });
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
    'check_in', 'check_out', 'adults', 'children', 'guest_count', 'room', 'rooms', 'rate', 'notes',
  ];
  /**
   * A typed room replaces the set, rather than losing to it.
   *
   * `buildReservation` prefers `rooms` over `room`, which is right everywhere else
   * — but here the reservation already has a set and the patch has the field a
   * person just typed. Dropping the held set lets the typed value decide, and it
   * also means the one Camera field already handles "302, 303": the normaliser
   * reads both numbers and clears the single room by itself.
   */
  const base = patch.room !== undefined && patch.rooms === undefined
    ? { ...reservation, rooms: undefined }
    : reservation;
  const clean = buildReservation({ ...base, ...patch });
  const update = {};
  for (const field of allowed) {
    if (patch[field] === undefined) continue;
    update[field] = clean[field];
  }
  // The pair is one fact, so a change to either writes both.
  if (update.room !== undefined || update.rooms !== undefined) {
    update.room = clean.room;
    update.rooms = clean.rooms;
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

/* ── Reservations, in the order they matter ────────────────────────────── */

/**
 * The order a person actually works in.
 *
 * Sorting reservations by check-in date puts last March at the top and the guest
 * standing at the desk four screens down. What a person needs first is who is here,
 * then who arrives today, then who arrives soon — and finished stays not at all
 * until they go looking for one.
 *
 * `incomplete` sits where it does on purpose. A provisional stay arriving today is
 * urgent *because it is arriving today*, so it stays in `arriving-today` and carries
 * its missing-fields list with it rather than being filed away under a data problem.
 * This group is for the stays that cannot be placed on the timeline at all — no
 * dates, or dates that make no sense — which would otherwise fall off the bottom.
 */
export const RESERVATION_GROUPS = [
  'in-house', 'arriving-today', 'arriving-soon', 'upcoming', 'incomplete', 'history',
];

/** Within how many days an arrival counts as soon rather than merely upcoming. */
export const ARRIVING_SOON_DAYS = 7;

export function reservationGroup(reservation, today = propertyDate(), { soonDays = ARRIVING_SOON_DAYS } = {}) {
  if (!isLive(reservation)) return 'history';
  const { check_in: from, check_out: to } = reservation;
  if (!from || !to || to < from) return 'incomplete';
  if (to < today) return 'history';

  /**
   * Arriving today is checked before in the house, and the order is the point.
   *
   * A stay that begins today satisfies both readings — it is today, and it covers
   * today — and the two mean different things at the desk: somebody arriving has
   * not been given their keys, their room may not be ready, and nobody has met
   * them yet. Testing for in-house first would fold every arrival into the people
   * already upstairs and leave the arrivals group permanently empty.
   */
  if (from === today) return 'arriving-today';
  if (from < today && to >= today) return 'in-house';
  if (from > today) {
    const soon = addDays(today, soonDays);
    return from <= soon ? 'arriving-soon' : 'upcoming';
  }
  return 'history';
}

/**
 * Every reservation, grouped and sorted the way the Staff app reads them.
 *
 * History is returned too rather than withheld, because the app's filter is a filter
 * and not a second request: a person looking for last week's guest should not wait
 * for a round trip. It is last, and it is collapsed.
 */
export function groupReservations(reservations = [], { now = new Date(), soonDays = ARRIVING_SOON_DAYS } = {}) {
  const today = propertyDate(now);
  const groups = Object.fromEntries(RESERVATION_GROUPS.map((id) => [id, []]));

  for (const reservation of reservations) {
    groups[reservationGroup(reservation, today, { soonDays })].push(reservation);
  }

  // Inside a group, soonest first — except history, which reads newest first.
  for (const id of RESERVATION_GROUPS) {
    groups[id].sort((a, b) => (id === 'history'
      ? String(b.check_in ?? '').localeCompare(String(a.check_in ?? ''))
      : String(a.check_in ?? '').localeCompare(String(b.check_in ?? ''))));
  }

  return {
    today,
    order: RESERVATION_GROUPS,
    groups: Object.fromEntries(RESERVATION_GROUPS.map((id) => [id, groups[id].map(staffView)])),
    counts: Object.fromEntries(RESERVATION_GROUPS.map((id) => [id, groups[id].length])),
    /** How many live stays still need a person to go and find something. */
    needsData: reservations.filter((r) => isLive(r) && incompleteFields(r).length > 0).length,
  };
}

/* ── Sync ──────────────────────────────────────────────────────────────── */

/**
 * The three mailbox-and-calendar jobs, each reported on its own.
 *
 * They are genuinely different operations with different failure modes, and rolling
 * them into one "sync: ok" is how an operator comes to believe the backfill has run
 * when it never has. So each one says, separately: whether it is configured, when it
 * last succeeded, what went wrong last time, and what its last run actually found.
 *
 *   gmail-incremental  the primary source, every few minutes, recent mail only
 *   gmail-backfill     staff-triggered, a year of mail, recovers what was missed
 *   ical               the safety net: occupancy, provisional stays, mismatches
 *
 * Read from the store rather than from the scheduler's memory, because the question
 * this answers is usually asked just after a deploy.
 */
export const SYNC_JOBS = ['gmail-incremental', 'gmail-backfill', 'ical'];

export async function syncJobStates({ store }) {
  const runs = await store.syncRuns.all();
  return Object.fromEntries(SYNC_JOBS.map((job) => {
    const row = runs[job] ?? null;
    const summary = row?.summary ?? {};
    return [job, {
      job,
      /** Never run is a different answer from ran and found nothing. */
      everRan: Boolean(row),
      runs: row?.runs ?? 0,
      lastRunAt: row?.at ?? null,
      lastSuccessAt: row?.lastSuccessAt ?? null,
      lastError: row?.lastError ?? null,
      counts: {
        scanned: summary.scanned ?? summary.checked ?? 0,
        created: summary.created ?? 0,
        modified: summary.modified ?? 0,
        cancelled: summary.cancelled ?? 0,
        unchanged: summary.unchanged ?? 0,
        ignored: summary.ignored ?? 0,
        failed: summary.failed ?? 0,
        matched: summary.matched ?? 0,
        unmatched: summary.unmatched ?? 0,
        vanished: summary.vanished ?? 0,
        ambiguous: summary.ambiguous ?? 0,
      },
    }];
  }));
}

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
      if (reservation.provisional === true) problems.push('provisional');
      if (!reservation.guest_email) problems.push('no-guest-email');
      /**
       * No room at all — which is not the same as more than one.
       *
       * Read off the set rather than the legacy field, because a booking across
       * 302 to 305 deliberately has no single `room` and would otherwise sit on
       * the sync screen under "da verificare" for ever, telling staff to go and
       * find something that is already there.
       */
      if (roomsIn(reservation).length === 0) problems.push('no-room');
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
        /** `302, 303, 304 e 305` where there are several. The label is the screen's. */
        room: roomList(roomsIn(reservation)) || (reservation.room ?? ''),
        rooms: roomsIn(reservation),
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
        provisional: reservation.provisional === true,
        /** The fields a person has to go and find, named. */
        incomplete: incompleteFields(reservation),
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
    /** Stays held from a calendar with nobody's name on them yet. */
    provisional: rows.filter((r) => r.provisional).length,
    jobs: await syncJobStates({ store }),
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
    /**
     * Lines the guests themselves called off, newest first.
     *
     * On the first screen because it is the one kind of change nobody at LunArt
     * made: a kitchen that does not see it makes a breakfast that is not owed.
     */
    guestCancellations: Object.values(queues).flat()
      .flatMap((order) => (order.lines ?? []).flatMap((line) => (line.cancellations ?? [])
        .filter((entry) => entry.actor === 'guest')
        .map((entry) => ({
          order_id: order.id,
          reference: orderReference(order),
          title: line.variant_title ? `${line.title} — ${line.variant_title}` : line.title,
          room: line.room || order.customer?.room || '',
          date: line.date ?? null,
          time: line.time ?? null,
          at: entry.at,
          quantity: entry.quantity,
          amount: entry.amount,
          outcome: entry.outcome,
        }))))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 12),
  };
}
