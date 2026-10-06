/**
 * Orders: creating them, moving them between states, and fulfilling them.
 *
 * Two statuses are tracked rather than one, because they answer different
 * questions and genuinely diverge. `status` is about money — has it been
 * authorised, taken, released, given back. `fulfilment_status` is about the thing
 * — is a driver confirmed, has breakfast gone up. A transfer sits at
 * `authorized` / `awaiting-confirmation` for hours, and collapsing those two into
 * one field is how a guest ends up being told they have paid for a car nobody
 * has agreed to drive.
 */

import { opaqueToken } from './store.js';
import { priceCart, paymentModeFor, CURRENCY } from '../commerce/ordering.js';
import { PAYMENT_STATUS, FULFILMENT_STATUS } from '../commerce/schema.js';
import { buildCard, holderView } from './card.js';
import { orderCancellation } from '../commerce/cancellation.js';

/** Money states a given state is allowed to move to. Anything else is a bug. */
const ALLOWED_TRANSITIONS = {
  pending:    ['authorized', 'paid', 'failed', 'cancelled'],
  authorized: ['confirmed', 'paid', 'cancelled', 'failed'],
  confirmed:  ['paid', 'cancelled', 'failed', 'refunded'],
  paid:       ['refunded'],
  cancelled:  [],
  refunded:   [],
  failed:     ['pending'],
};

export const canTransition = (from, to) => from === to || Boolean(ALLOWED_TRANSITIONS[from]?.includes(to));

/** Flatten a priced cart into the lines an order keeps. */
function orderLines(priced, lang = 'it') {
  return priced.lines.map((entry) => ({
    product_id: entry.product.id,
    variant_id: entry.variant?.id ?? null,
    sku: entry.line.sku,
    title: entry.product.title[lang] ?? entry.product.title.it,
    variant_title: entry.variant ? (entry.variant.title[lang] ?? entry.variant.title.it) : null,
    quantity: entry.line.quantity,
    unit_amount: entry.unit,
    amount: entry.amount,
    /** What was added on top, and why — priced here, never sent by the client. */
    surcharges: entry.surcharges ?? [],
    surcharge_amount: entry.surcharge ?? 0,
    date: entry.line.date,
    slot_id: entry.line.slotId,
    time: entry.line.time,
    room: entry.line.room,
    options: entry.line.options,
    fields: entry.line.fields,
    fulfillment_type: entry.product.fulfillmentType,
    purchase_mode: entry.product.purchaseMode,
    partner: entry.product.partner ?? null,
  }));
}

/** Only ever written from values the server derived. */
export function buildOrder({ priced, customer, lang = 'it', paymentMode, reservationId = null }) {
  const needsProvider = priced.lines.some((l) => l.product.purchaseMode === 'authorize-then-capture');
  return {
    object: 'order',
    access_token: opaqueToken(24),
    /**
     * Which stay this belongs to, when the guest bought it from their own link.
     *
     * Resolved on the server from the guide token and never from anything the
     * browser sent, because it is what decides whose purchases these are. Null for
     * a sale made from the public guide, which belongs to a person rather than to
     * a booking and is only findable through its own access token.
     */
    reservation_id: reservationId,
    status: PAYMENT_STATUS.pending,
    fulfilment_status: needsProvider ? FULFILMENT_STATUS['awaiting-confirmation'] : FULFILMENT_STATUS['not-required'],
    payment_mode: paymentMode,
    currency: priced.currency ?? CURRENCY,
    amount: priced.total,
    lines: orderLines(priced, lang),
    customer: {
      name: customer.name ?? '',
      email: customer.email ?? '',
      phone: customer.phone ?? '',
      room: customer.room ?? '',
      booking_reference: customer.bookingRef ?? '',
    },
    lang,
    stripe_session_id: null,
    stripe_payment_intent_id: null,
    provider: {
      status: needsProvider ? 'awaiting' : 'not-required',
      note: '',
      /** Filled in when a driver or a professional is actually assigned. */
      assignee: null,
      updated_at: null,
    },
    entitlements: [],
    events: [{ at: new Date().toISOString(), type: 'created' }],
  };
}

/** Re-price from the catalogue and build the order. The client's numbers are never read. */
export function priceAndBuild({ lines, customer, lang, now, allowPlaceholders, stay = null }) {
  const priced = priceCart(lines, { now, allowPlaceholders, stay });
  if (!priced.ok) return { ok: false, priced };
  const paymentMode = paymentModeFor(priced.lines);
  return { ok: true, priced, order: buildOrder({ priced, customer, lang, paymentMode }) };
}

/** Stripe line items, built from what the server computed, not from the request. */
export function stripeLineItems(order, lang = 'it') {
  const items = order.lines.map((line) => ({
    quantity: line.quantity,
    price_data: {
      currency: order.currency.toLowerCase(),
      unit_amount: line.unit_amount,
      product_data: {
        name: line.variant_title ? `${line.title} — ${line.variant_title}` : line.title,
        description: [line.date, line.time, line.room ? `Camera ${line.room}` : '']
          .filter(Boolean).join(' · ').slice(0, 200) || undefined,
      },
    },
  }));

  /**
   * Surcharges are their own line, so the guest sees what they are paying for and
   * the Stripe total matches the order total. Folding them into the unit price
   * would make a €90 transfer with one extra case look like a €105 transfer.
   */
  for (const line of order.lines) {
    for (const surcharge of line.surcharges ?? []) {
      if (!surcharge.amount) continue;
      items.push({
        quantity: surcharge.units ?? 1,
        price_data: {
          currency: order.currency.toLowerCase(),
          unit_amount: surcharge.unit,
          product_data: { name: `${line.title} — ${surchargeName(surcharge, lang)}` },
        },
      });
    }
  }
  return items;
}

const SURCHARGE_NAMES = {
  oversizedItems: { it: 'bagaglio extra', en: 'extra luggage' },
  upgrade: { it: 'upgrade bottiglia', en: 'bottle upgrade' },
};

const surchargeName = (surcharge, lang) =>
  SURCHARGE_NAMES[surcharge.id]?.[lang] ?? SURCHARGE_NAMES[surcharge.id]?.it ?? surcharge.id;

export function appendEvent(order, type, note = '') {
  return { ...order, events: [...(order.events ?? []), { at: new Date().toISOString(), type, note }] };
}

/**
 * Hand out whatever an order entitles the guest to.
 *
 * Idempotent on purpose: webhooks are retried, and a second delivery of the same
 * `checkout.session.completed` must not produce a second Privilege Card.
 */
export async function fulfilOrder(order, { store, signingKey, providerCalendar = null }) {
  const appointments = await recordAppointments(order, { store, providerCalendar });
  if (appointments) order = appointments;
  if (order.entitlements?.length) return { order, cards: [] };

  const cards = [];
  for (const line of order.lines) {
    if (line.fulfillment_type !== 'digital-entitlement') continue;
    if (line.product_id !== 'privilege-card') continue;

    const days = Number(line.variant_id?.replace(/\D/g, '')) || 0;
    for (let copy = 0; copy < line.quantity; copy++) {
      const card = buildCard({
        orderId: order.id,
        // The upgrade attaches to the stay, not to the browser that bought it:
        // this is what lets the same Pass read as Privilege on another phone.
        reservationId: order.reservation_id ?? null,
        holderName: line.fields?.holderName || order.customer.name,
        startDate: line.date,
        days,
        variantId: line.variant_id,
        signingKey,
      });
      await store.cards.create(card);
      cards.push(card);
    }
  }

  if (cards.length === 0) return { order, cards: [] };

  const updated = await store.orders.update(order.id, {
    entitlements: cards.map((c) => ({ type: 'privilege_card', id: c.id, access_token: c.access_token, reference: c.public_ref })),
    events: [...(order.events ?? []), { at: new Date().toISOString(), type: 'entitlements-issued', note: `${cards.length} card` }],
  });
  return { order: updated, cards };
}

/**
 * Put a paid appointment into the professional's calendar.
 *
 * With no calendar connected this records that it could not be written rather than
 * failing the order: the appointment exists, staff can see it, and it will be in a
 * calendar the moment one is configured. Writing is attempted once — the marker on
 * the order is what makes a retried webhook harmless.
 */
async function recordAppointments(order, { store, providerCalendar }) {
  const lines = order.lines.filter((line) => line.fulfillment_type === 'provider' && line.date && line.time);
  if (lines.length === 0 || order.calendar) return null;

  const written = [];
  for (const line of lines) {
    if (line.product_id !== 'hair-service') continue;
    const booking = {
      variantId: line.variant_id,
      serviceTitle: line.variant_title ?? line.title,
      date: line.date,
      time: line.time,
      room: line.room,
      guestName: line.fields?.guestName ?? order.customer?.name ?? '',
      phone: line.fields?.phone ?? order.customer?.phone ?? '',
      notes: line.fields?.notes ?? '',
      orderId: order.id,
    };
    if (!providerCalendar) {
      written.push({ product_id: line.product_id, ok: false, reason: 'no-calendar-adapter' });
      continue;
    }
    try {
      const outcome = await providerCalendar.createEvent(booking);
      written.push({ product_id: line.product_id, ok: Boolean(outcome?.ok), reason: outcome?.reason ?? null, minutes: outcome?.event?.minutes ?? null });
    } catch (error) {
      written.push({ product_id: line.product_id, ok: false, reason: error.code ?? 'calendar-failed', message: error.message });
    }
  }
  if (written.length === 0) return null;

  return store.orders.update(order.id, {
    calendar: { attempted_at: new Date().toISOString(), adapter: providerCalendar?.id ?? null, results: written },
    events: [...(order.events ?? []), {
      at: new Date().toISOString(),
      type: 'calendar-write',
      note: written.every((w) => w.ok) ? 'scritto sul calendario' : 'calendario non collegato: appuntamento solo su LunArt',
    }],
  });
}

/** What the guest is shown about their own order. No Stripe ids, no tokens but their own. */
/**
 * What an order is called out loud.
 *
 * The first eight characters of its id, upper-cased. Defined once because it is
 * printed on the guest's order sheet, in the Staff app and on a lock screen, and
 * three copies of the same slice is three chances for one of them to quote a
 * reference nobody can search for.
 */
export const orderReference = (order) => String(order?.id ?? '').slice(0, 8).toUpperCase();

export function orderView(order, { cards = [], now = new Date() } = {}) {
  /**
   * What can still be called off, worked out here rather than in the browser.
   *
   * The screen draws a cancel button from this and nothing else, so the button and
   * the server's willingness to honour it come from one calculation. See
   * `commerce/cancellation.js`.
   */
  const cancellation = orderCancellation(order, { now });

  return {
    id: order.id,
    reference: orderReference(order),
    status: order.status,
    fulfilment_status: order.fulfilment_status,
    payment_mode: order.payment_mode,
    currency: order.currency,
    amount: order.amount,
    /** How much of it has come back, so "paid" and "partly refunded" can differ. */
    refunded_amount: Number(order.refunded_amount ?? 0),
    cancelled_amount: Number(order.cancelled_amount ?? 0),
    created_at: order.created_at,
    customer: { name: order.customer.name, email: order.customer.email, room: order.customer.room },
    lines: order.lines.map((line, index) => ({
      title: line.title,
      variant_title: line.variant_title,
      quantity: line.quantity,
      amount: line.amount,
      date: line.date,
      slot_id: line.slot_id,
      time: line.time,
      room: line.room,
      options: line.options,
      purchase_mode: line.purchase_mode,
      /** The line's own cancellation state: policy, deadline, what comes back. */
      cancellation: cancellation.lines[index],
    })),
    can_cancel: cancellation.anyCancellable,
    provider: order.provider,
    entitlements: cards.map((card) => ({
      type: 'privilege_card',
      access_token: card.access_token,
      ...holderView(card),
    })),
  };
}

export { PAYMENT_STATUS, FULFILMENT_STATUS };
