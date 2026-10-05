/**
 * Calling things off, and the money that follows.
 *
 * The tests that matter here are the ones about *not* doing something: not
 * refunding twice when a request arrives twice, not refunding more than was paid,
 * not revoking a Privilege Card because the brunch next to it on the same receipt
 * was cancelled, not honouring a cancellation the browser asked for after the
 * deadline. A cancellation that works is easy; a cancellation that works exactly
 * once, for exactly the right amount, is the whole job.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../server/store.js';
import { createMockStripe } from '../server/stripe.js';
import { cancelOrderLine, ACTORS } from '../server/cancellation.js';
import {
  lineCancellation, orderCancellation, refundableFor, policyOf, settlementFor,
} from '../commerce/cancellation.js';
import { getProduct } from '../commerce/ordering.js';
import { orderView } from '../server/orders.js';
import { staffOrderView } from '../server/staff.js';
import { propertyTimeToInstant, propertyDate, addDays } from '../commerce/time.js';

const store = () => createStore({});

/** 10:00 in Florence, three days before the stay's first breakfast. */
const NOW = new Date('2026-10-03T08:00:00Z');
const inDays = (days) => addDays(propertyDate(NOW), days);

/**
 * An order as the server would have written it.
 *
 * Built by hand rather than through checkout because what is under test is what
 * happens *after* a purchase, and a fixture that goes through Stripe to get here
 * would be testing the purchase again.
 */
const breakfastLine = (over = {}) => ({
  product_id: 'light-breakfast',
  variant_id: null,
  sku: 'light-breakfast',
  title: 'Colazione in camera',
  variant_title: null,
  quantity: 1,
  unit_amount: 4900,
  amount: 4900,
  surcharges: [],
  surcharge_amount: 0,
  date: inDays(3),
  slot_id: 'b-0900',
  time: '09:00',
  room: '303',
  options: {},
  fields: {},
  fulfillment_type: 'staff',
  purchase_mode: 'pay-now',
  partner: null,
  ...over,
});

const cardLine = (over = {}) => ({
  product_id: 'privilege-card',
  variant_id: '2d',
  sku: 'privilege-card:2d',
  title: 'LunArt Privilege',
  variant_title: '2 giorni',
  quantity: 1,
  unit_amount: 1500,
  amount: 1500,
  surcharges: [],
  surcharge_amount: 0,
  date: inDays(3),
  slot_id: null,
  time: null,
  room: '303',
  options: {},
  fields: {},
  fulfillment_type: 'digital-entitlement',
  purchase_mode: 'pay-now',
  partner: null,
  ...over,
});

const transferLine = (over = {}) => ({
  product_id: 'transfer-airport',
  variant_id: 'arrival',
  sku: 'transfer-airport',
  title: 'Transfer aeroporto',
  variant_title: 'Arrivo',
  quantity: 1,
  unit_amount: 9000,
  amount: 9000,
  surcharges: [],
  surcharge_amount: 0,
  date: inDays(3),
  slot_id: null,
  time: '14:00',
  room: '303',
  options: {},
  fields: {},
  fulfillment_type: 'provider',
  purchase_mode: 'authorize-then-capture',
  partner: null,
  ...over,
});

async function paidOrder(db, stripe, lines, over = {}) {
  const session = await stripe.createCheckoutSession({
    line_items: lines.map((l) => ({ quantity: l.quantity, price_data: { unit_amount: l.unit_amount, currency: 'eur' } })),
  });
  await stripe.completeSession(session.id);
  return db.orders.create({
    object: 'order',
    access_token: 'tok-paid',
    reservation_id: null,
    status: 'paid',
    fulfilment_status: 'not-required',
    payment_mode: 'pay-now',
    currency: 'EUR',
    amount: lines.reduce((sum, l) => sum + l.amount, 0),
    lines,
    customer: { name: 'Marta', email: 'm@example.com', phone: '', room: '303', booking_reference: '' },
    lang: 'it',
    stripe_session_id: session.id,
    stripe_payment_intent_id: session.payment_intent,
    provider: { status: 'not-required', note: '', assignee: null, updated_at: null },
    entitlements: [],
    events: [],
    ...over,
  });
}

async function authorisedOrder(db, stripe, lines) {
  const session = await stripe.createCheckoutSession({
    line_items: lines.map((l) => ({ quantity: l.quantity, price_data: { unit_amount: l.unit_amount, currency: 'eur' } })),
    payment_intent_data: { capture_method: 'manual' },
  });
  await stripe.completeSession(session.id);
  return db.orders.create({
    object: 'order',
    access_token: 'tok-auth',
    reservation_id: null,
    status: 'authorized',
    fulfilment_status: 'awaiting-confirmation',
    payment_mode: 'authorize-then-capture',
    currency: 'EUR',
    amount: lines.reduce((sum, l) => sum + l.amount, 0),
    lines,
    customer: { name: 'Marta', email: 'm@example.com', phone: '', room: '303', booking_reference: '' },
    lang: 'it',
    stripe_session_id: session.id,
    stripe_payment_intent_id: session.payment_intent,
    provider: { status: 'awaiting', note: '', assignee: null, updated_at: null },
    entitlements: [],
    events: [],
  });
}

/* ── The policy, read from the catalogue and nowhere else ─────────────────── */

test('the policy comes from the catalogue, in the shape both sides read', () => {
  assert.deepEqual(policyOf(getProduct('light-breakfast')), { kind: 'dayBefore', hour: 20 });
  assert.deepEqual(policyOf(getProduct('wine-in-room')), { kind: 'hoursBefore', hours: 3 });
  assert.deepEqual(policyOf(getProduct('privilege-card')), { kind: 'none' });
  assert.deepEqual(policyOf(getProduct('transfer-airport')), { kind: 'hoursBefore', hours: 3 });
});

test('the deadline is the policy applied to the line, in Florence time', () => {
  const order = { status: 'paid', fulfilment_status: 'not-required', lines: [breakfastLine()] };
  const state = lineCancellation(order, 0, { now: NOW });

  assert.equal(state.cancellable, true);
  assert.equal(state.policy.kind, 'dayBefore');
  // Eight in the evening, the day before the breakfast.
  assert.equal(state.deadline, propertyTimeToInstant(inDays(2), '20:00').toISOString());
  assert.equal(state.settlement, 'refund');
  assert.equal(state.refundable_amount, 4900);
});

test('a line past its deadline says so, and says which deadline', () => {
  const order = { status: 'paid', fulfilment_status: 'not-required', lines: [breakfastLine()] };
  // Nine in the evening the day before: one hour too late.
  const late = propertyTimeToInstant(inDays(2), '21:00');
  const state = lineCancellation(order, 0, { now: late });

  assert.equal(state.cancellable, false);
  assert.equal(state.blocked, 'past-deadline');
  assert.equal(state.refundable_amount, 0);
  assert.ok(state.deadline, 'the deadline is still reported, so the screen can say what was missed');
});

test('a product sold outright is never cancellable, whatever the clock says', () => {
  const order = { status: 'paid', fulfilment_status: 'not-required', lines: [cardLine()] };
  const state = lineCancellation(order, 0, { now: NOW });
  assert.equal(state.cancellable, false);
  assert.equal(state.blocked, 'policy-none');
});

test('something already in preparation cannot be called off', () => {
  const order = { status: 'paid', fulfilment_status: 'in-preparation', lines: [breakfastLine()] };
  assert.equal(lineCancellation(order, 0, { now: NOW }).blocked, 'already-fulfilled');
});

test('an order whose checkout never finished has nothing to call off', () => {
  const order = { status: 'pending', fulfilment_status: 'not-required', lines: [breakfastLine()] };
  assert.equal(lineCancellation(order, 0, { now: NOW }).blocked, 'nothing-committed');
  assert.equal(settlementFor(order), 'none');
});

/* ── The arithmetic ──────────────────────────────────────────────────────── */

test('cancelling units one at a time returns exactly the line total, never a cent more', () => {
  // €49 over three units does not divide: 4900/3 is 1633.33.
  let line = { ...breakfastLine({ quantity: 3, amount: 14700 }) };
  let returned = 0;
  for (let i = 0; i < 3; i++) {
    const value = refundableFor(line, 1);
    returned += value.amount;
    line = {
      ...line,
      cancelled_quantity: (line.cancelled_quantity ?? 0) + 1,
      refunded_amount: (line.refunded_amount ?? 0) + value.amount,
    };
  }
  assert.equal(returned, 14700, 'the last unit takes whatever is left, so the sum closes');
  assert.equal(line.refunded_amount, 14700);
  assert.equal(refundableFor(line, 1).amount, 0, 'and there is nothing left to ask for');
});

test('a refund never exceeds what is left of the line', () => {
  const line = breakfastLine({ quantity: 2, amount: 9800, cancelled_quantity: 1, refunded_amount: 4900 });
  const value = refundableFor(line, 5);
  assert.equal(value.quantity, 1, 'asking for five of a two-unit line gets the one that is left');
  assert.equal(value.amount, 4900);
});

test('surcharges are part of what comes back', () => {
  const line = transferLine({ surcharge_amount: 1500, amount: 10500 });
  assert.equal(refundableFor(line, 1).amount, 10500, 'the extra suitcase is refunded with the transfer');
});

/* ── Refunding, for real ─────────────────────────────────────────────────── */

test('cancelling a paid line refunds it and writes the ledger', async () => {
  const db = store();
  const stripe = createMockStripe();
  const order = await paidOrder(db, stripe, [breakfastLine()]);

  const result = await cancelOrderLine({
    store: db, stripe, order, index: 0, actor: ACTORS.guest, reason: 'cambio programma', now: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'refunded');
  assert.equal(result.amount, 4900);

  const line = result.order.lines[0];
  assert.equal(line.original_amount, 4900, 'what it was, before anything came back');
  assert.equal(line.cancelled_quantity, 1);
  assert.equal(line.refunded_amount, 4900);
  assert.equal(line.cancelled_by, 'guest');
  assert.ok(line.cancelled_at);
  assert.equal(line.cancellations.length, 1);
  assert.equal(line.cancellations[0].actor, 'guest');
  assert.equal(line.cancellations[0].reason, 'cambio programma');
  assert.ok(line.cancellations[0].provider_reference, 'Stripe’s own reference, kept for reconciliation');

  assert.equal(result.order.refunded_amount, 4900, 'and the aggregate, so no screen adds up a ledger');
  assert.equal(result.order.cancelled_amount, 4900);
  assert.equal(result.order.status, 'refunded', 'nothing is left of this order');

  const intent = await stripe.retrievePaymentIntent(order.stripe_payment_intent_id);
  assert.equal(intent.amount_refunded, 4900);
});

test('the same cancellation twice refunds once', async () => {
  const db = store();
  const stripe = createMockStripe();
  const order = await paidOrder(db, stripe, [breakfastLine()]);

  const first = await cancelOrderLine({ store: db, stripe, order, index: 0, now: NOW });
  assert.equal(first.ok, true);

  const second = await cancelOrderLine({ store: db, stripe, order: first.order, index: 0, now: NOW });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'already-cancelled');

  const intent = await stripe.retrievePaymentIntent(order.stripe_payment_intent_id);
  assert.equal(intent.amount_refunded, 4900, 'and only once at Stripe');
  const stored = await db.orders.get(order.id);
  assert.equal(stored.lines[0].cancellations.length, 1);
});

test('a refund that Stripe refuses writes nothing at all', async () => {
  const db = store();
  const stripe = createMockStripe();
  const order = await paidOrder(db, stripe, [breakfastLine()]);
  stripe.createRefund = async () => { throw new Error('card network unavailable'); };

  const result = await cancelOrderLine({ store: db, stripe, order, index: 0, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'refund-failed');

  const stored = await db.orders.get(order.id);
  assert.equal(stored.lines[0].cancelled_quantity ?? 0, 0, 'the line is still the guest’s to cancel');
  assert.equal(stored.refunded_amount ?? 0, 0);
  assert.equal(stored.status, 'paid');
});

test('a cancellation past the deadline is refused by the server, whatever the browser asked', async () => {
  const db = store();
  const stripe = createMockStripe();
  const order = await paidOrder(db, stripe, [breakfastLine()]);

  const late = propertyTimeToInstant(inDays(2), '21:00');
  const result = await cancelOrderLine({ store: db, stripe, order, index: 0, now: late });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'past-deadline');
  const intent = await stripe.retrievePaymentIntent(order.stripe_payment_intent_id);
  assert.equal(intent.amount_refunded ?? 0, 0);
});

/* ── The mixed order: the one that must not go wrong ─────────────────────── */

test('refunding the brunch leaves the Privilege Card valid and its card untouched', async () => {
  const db = store();
  const stripe = createMockStripe();
  const order = await paidOrder(db, stripe, [breakfastLine(), cardLine()], {
    entitlements: [{ type: 'privilege_card', id: 'card-1', access_token: 'card-tok', reference: 'ABC123' }],
  });
  const card = await db.cards.create({ id: 'card-1', access_token: 'card-tok', public_ref: 'ABC123', revoked_at: null });

  const result = await cancelOrderLine({ store: db, stripe, order, index: 0, actor: ACTORS.guest, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.amount, 4900, 'the brunch, and only the brunch');

  assert.equal(result.order.status, 'paid', 'the order is not refunded: the Card is still owed and still valid');
  assert.equal(result.order.refunded_amount, 4900);
  assert.notEqual(result.order.fulfilment_status, 'cancelled');
  assert.deepEqual(result.order.entitlements, order.entitlements, 'the entitlement is exactly as it was');
  assert.equal((await db.cards.get('card-1')).revoked_at, null, 'and the card itself is not revoked');
  assert.equal(card.id, 'card-1');

  // The Card line cannot be cancelled at all, so the guest is never offered it.
  assert.equal(lineCancellation(result.order, 1, { now: NOW }).blocked, 'policy-none');

  const intent = await stripe.retrievePaymentIntent(order.stripe_payment_intent_id);
  assert.equal(intent.amount_refunded, 4900);
  assert.equal(intent.status, 'partially_refunded', 'part of the payment stands');
});

/* ── Authorisations: released, or captured for less ──────────────────────── */

test('cancelling the whole of an authorised order releases the hold', async () => {
  const db = store();
  const stripe = createMockStripe();
  const order = await authorisedOrder(db, stripe, [transferLine()]);

  const result = await cancelOrderLine({ store: db, stripe, order, index: 0, actor: ACTORS.guest, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'released');
  assert.equal(result.order.status, 'cancelled');
  assert.equal(result.order.refunded_amount, 0, 'nothing was ever taken, so nothing came back');

  const intent = await stripe.retrievePaymentIntent(order.stripe_payment_intent_id);
  assert.equal(intent.status, 'canceled');
});

test('cancelling one leg of an authorised order reduces what will be captured', async () => {
  const db = store();
  const stripe = createMockStripe();
  const order = await authorisedOrder(db, stripe, [
    transferLine({ variant_id: 'arrival' }),
    transferLine({ variant_id: 'departure', time: '09:00', date: inDays(5) }),
  ]);
  assert.equal(order.amount, 18000);

  const result = await cancelOrderLine({ store: db, stripe, order, index: 1, actor: ACTORS.guest, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'reduced');
  assert.equal(result.order.amount, 9000, 'the order is now worth one leg');
  assert.equal(result.order.status, 'authorized', 'and the other leg is still live');

  const intent = await stripe.retrievePaymentIntent(order.stripe_payment_intent_id);
  assert.equal(intent.status, 'requires_capture', 'the hold is untouched: a hold cannot be made smaller');

  // The capture then asks for the reduced figure, and that is what is taken.
  await stripe.capturePaymentIntent(order.stripe_payment_intent_id, { amount_to_capture: result.order.amount });
  const captured = await stripe.retrievePaymentIntent(order.stripe_payment_intent_id);
  assert.equal(captured.amount_received, 9000, 'the guest is not charged for the leg they called off');
});

/* ── What each side is shown ─────────────────────────────────────────────── */

test('the guest sees the policy and the deadline, and never a Stripe id', async () => {
  const db = store();
  const stripe = createMockStripe();
  const order = await paidOrder(db, stripe, [breakfastLine(), cardLine()]);
  const view = orderView(order, { now: NOW });

  assert.equal(view.can_cancel, true);
  assert.equal(view.lines[0].cancellation.cancellable, true);
  assert.equal(view.lines[0].cancellation.policy.kind, 'dayBefore');
  assert.ok(view.lines[0].cancellation.deadline);
  assert.equal(view.lines[1].cancellation.cancellable, false);

  const json = JSON.stringify(view);
  assert.ok(!json.includes('pi_mock'), 'no payment intent');
  assert.ok(!json.includes('cs_mock'), 'no checkout session');
  assert.ok(!json.includes(order.stripe_payment_intent_id));
});

test('staff see that the guest cancelled, and what it was worth', async () => {
  const db = store();
  const stripe = createMockStripe();
  const order = await paidOrder(db, stripe, [breakfastLine(), cardLine()]);
  const { order: cancelled } = await cancelOrderLine({
    store: db, stripe, order, index: 0, actor: ACTORS.guest, reason: 'cambio programma', now: NOW,
  });

  const view = staffOrderView(cancelled, { now: NOW });
  assert.equal(view.guest_cancelled, true);
  assert.equal(view.refunded_amount, 4900);
  assert.equal(view.lines[0].cancelled_quantity, 1);
  assert.equal(view.lines[0].cancelled_by, 'guest');
  assert.equal(view.lines[0].cancellations[0].reason, 'cambio programma');
  assert.equal(view.lines[1].cancelled_quantity, 0, 'the Card is untouched');
});

test('the whole-order view says plainly whether anything can still be called off', () => {
  const cancellable = { status: 'paid', fulfilment_status: 'not-required', lines: [breakfastLine()] };
  assert.equal(orderCancellation(cancellable, { now: NOW }).anyCancellable, true);

  const not = { status: 'paid', fulfilment_status: 'not-required', lines: [cardLine()] };
  assert.equal(orderCancellation(not, { now: NOW }).anyCancellable, false);
});
