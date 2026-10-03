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
export function buildOrder({ priced, customer, lang = 'it', paymentMode }) {
  const needsProvider = priced.lines.some((l) => l.product.purchaseMode === 'authorize-then-capture');
  return {
    object: 'order',
    access_token: opaqueToken(24),
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
    provider: { status: needsProvider ? 'awaiting' : 'not-required', note: '', updated_at: null },
    entitlements: [],
    events: [{ at: new Date().toISOString(), type: 'created' }],
  };
}

/** Re-price from the catalogue and build the order. The client's numbers are never read. */
export function priceAndBuild({ lines, customer, lang, now, allowPlaceholders }) {
  const priced = priceCart(lines, { now, allowPlaceholders });
  if (!priced.ok) return { ok: false, priced };
  const paymentMode = paymentModeFor(priced.lines);
  return { ok: true, priced, order: buildOrder({ priced, customer, lang, paymentMode }) };
}

/** Stripe line items, built from what the server computed, not from the request. */
export function stripeLineItems(order, lang = 'it') {
  return order.lines.map((line) => ({
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
}

export function appendEvent(order, type, note = '') {
  return { ...order, events: [...(order.events ?? []), { at: new Date().toISOString(), type, note }] };
}

/**
 * Hand out whatever an order entitles the guest to.
 *
 * Idempotent on purpose: webhooks are retried, and a second delivery of the same
 * `checkout.session.completed` must not produce a second Privilege Card.
 */
export async function fulfilOrder(order, { store, signingKey }) {
  if (order.entitlements?.length) return { order, cards: [] };

  const cards = [];
  for (const line of order.lines) {
    if (line.fulfillment_type !== 'digital-entitlement') continue;
    if (line.product_id !== 'privilege-card') continue;

    const days = Number(line.variant_id?.replace(/\D/g, '')) || 0;
    for (let copy = 0; copy < line.quantity; copy++) {
      const card = buildCard({
        orderId: order.id,
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

/** What the guest is shown about their own order. No Stripe ids, no tokens but their own. */
export function orderView(order, { cards = [] } = {}) {
  return {
    id: order.id,
    reference: String(order.id).slice(0, 8).toUpperCase(),
    status: order.status,
    fulfilment_status: order.fulfilment_status,
    payment_mode: order.payment_mode,
    currency: order.currency,
    amount: order.amount,
    created_at: order.created_at,
    customer: { name: order.customer.name, email: order.customer.email, room: order.customer.room },
    lines: order.lines.map((line) => ({
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
    })),
    provider: order.provider,
    entitlements: cards.map((card) => ({
      type: 'privilege_card',
      access_token: card.access_token,
      ...holderView(card),
    })),
  };
}

export { PAYMENT_STATUS, FULFILMENT_STATUS };
