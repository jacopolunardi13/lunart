/**
 * A refund that happened at Stripe, and the records that have to catch up.
 *
 * A Privilege Card was bought for €15 while production was briefly pointed at a
 * different live Stripe account. The charge was refunded in full from that
 * account's dashboard; that account had no webhook pointing here, so nothing
 * arrived. The order still read `paid`, the card still issued a rotating QR, a
 * venue would still have honoured it, and the guest's home still showed Privilege.
 *
 * The missing webhook was the smaller half. `charge.refunded` *was* handled — it
 * moved the money status and did nothing else: no amount recorded, no difference
 * between a full refund and a partial one, and no revocation. The same button
 * inside the Staff app had the same hole. So what these tests pin down is that
 * there is exactly one definition of what a full refund does, that a partial
 * refund never guesses which line an operator meant, and that a card which stops
 * working stops working everywhere a door would ask.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createStore } from '../server/store.js';
import { createMockStripe } from '../server/stripe.js';
import { createApp, handleStripeEvent } from '../server/app.js';
import { reconcileExternalRefund, refundFromCharge, REFUND_SOURCES } from '../server/refunds.js';
import { refundOrder, reconcileRefundByHand, staffOrderView } from '../server/staff.js';
import { cancelOrderLine, ACTORS } from '../server/cancellation.js';
import { validateCode, cardState, currentCode } from '../server/card.js';
import { passForReservation, entitlementsOf, liveEntitlementsOf } from '../server/pass.js';
import { buildReservation } from '../server/reservations.js';
import { applyPriceOverrides } from '../commerce/prices.js';
import { DEV_PRICES } from '../commerce/prices.dev.js';
import { propertyDate, addDays } from '../commerce/time.js';

const SIGNING_KEY = 'refund-test-signing-key';
const PERIOD = 60;

const soon = (days) => addDays(propertyDate(), days);
const CUSTOMER = { name: 'Jacopo Lunardi', email: 'jacopo@example.invalid', room: '303' };

/**
 * A server, a stay, and whatever was bought against it.
 *
 * Built through real checkout rather than by hand, because what is under test is
 * what happens to an order *after* a purchase — and an order assembled by hand
 * would not have the entitlement wiring that makes the card findable at all.
 */
async function shop(t, { lines, withStay = true } = {}) {
  applyPriceOverrides(DEV_PRICES);
  t.after(() => applyPriceOverrides({}));

  const store = createStore();
  const stripe = createMockStripe();

  const reservation = withStay
    ? await store.reservations.create(buildReservation({
      source: 'quovai', booking_reference: `REF-${randomUUID().slice(0, 6)}`,
      first_name: 'Jacopo', last_name: 'Lunardi', guest_email: 'jacopo@example.invalid',
      check_in: propertyDate(), check_out: soon(4), room: '303', adults: 2,
    }))
    : null;

  const app = await createApp({
    store,
    stripe,
    allowPlaceholderPrices: true,
    cardSigningKey: SIGNING_KEY,
    cardCodePeriodSeconds: PERIOD,
    staffToken: 'refund-staff-token',
    mode: 'production',
    publicUrl: 'http://127.0.0.1',
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const api = async (path, { method, body, token } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: method ?? (body ? 'POST' : 'GET'),
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };

  const { body: checkout } = await api('/api/checkout', {
    body: {
      lines, customer: CUSTOMER, lang: 'it',
      ...(reservation ? { guideToken: reservation.guide_token } : {}),
    },
  });
  assert.ok(checkout.checkoutUrl, `checkout refused: ${JSON.stringify(checkout)}`);
  const session = new URL(checkout.checkoutUrl, base).searchParams.get('session');
  await api('/mock-checkout/complete', { body: { session } });

  const order = await store.orders.findByAccessToken(checkout.accessToken);
  return { store, stripe, app, api, base, reservation, order, accessToken: checkout.accessToken };
}

/**
 * A Privilege Card running from today.
 *
 * The start date matters: a card bought for tomorrow is `not-started`, which fails
 * validation for a reason that has nothing to do with refunds. These tests are
 * about a card that really would open a door this evening.
 */
const CARD_LINE = {
  productId: 'privilege-card', variantId: '2d', quantity: 1,
  date: propertyDate(), fields: { holderName: 'Jacopo Lunardi' },
};
const BREAKFAST = {
  productId: 'light-breakfast', quantity: 2, date: soon(2), slotId: 'b-0900', room: '303',
};

/** The charge Stripe sends with `charge.refunded`. */
const charge = (order, refunded, over = {}) => ({
  id: `ch_${order.id.slice(0, 8)}`,
  payment_intent: order.stripe_payment_intent_id,
  metadata: { order_id: order.id },
  amount: order.amount,
  amount_refunded: refunded,
  refunded: refunded >= order.amount,
  ...over,
});

const refundEvent = async (order, ctx, refunded, over = {}) => handleStripeEvent({
  id: `evt_${randomUUID()}`, type: 'charge.refunded',
  data: { object: charge(order, refunded, over) },
}, ctx);

const contextOf = (app) => ({
  store: app.store, stripe: app.stripe, settings: app.settings,
  push: app.push, providerCalendar: app.providerCalendar,
});

/* ══ Reading the charge ═══════════════════════════════════════════════════ */

test('a charge says how much came back, and whether that is all of it', () => {
  assert.deepEqual(refundFromCharge({ id: 'ch_1', amount: 1500, amount_refunded: 1500, refunded: true }),
    { charged: 1500, refunded: 1500, full: true, reference: 'ch_1' });
  assert.deepEqual(refundFromCharge({ id: 'ch_2', amount: 9000, amount_refunded: 2500, refunded: false }),
    { charged: 9000, refunded: 2500, full: false, reference: 'ch_2' });

  // Stripe's own flag is believed where it has one, and the arithmetic where it does not.
  assert.equal(refundFromCharge({ amount: 1500, amount_refunded: 1500 }).full, true);
  assert.equal(refundFromCharge({ amount: 1500, amount_refunded: 1499 }).full, false);
  assert.equal(refundFromCharge({}).full, false, 'and nothing readable is not "all of it"');
});

/* ══ A. A fully refunded charge ═══════════════════════════════════════════ */

test('A a full external refund marks the order refunded, for the full amount', async (t) => {
  const { app, order, accessToken, api } = await shop(t, { lines: [BREAKFAST] });
  assert.equal(order.status, 'paid');

  const outcome = await refundEvent(order, contextOf(app), order.amount);
  assert.equal(outcome.action, 'refunded');
  assert.equal(outcome.full, true);

  const settled = await app.store.orders.findByAccessToken(accessToken);
  assert.equal(settled.status, 'refunded');
  assert.equal(settled.refunded_amount, order.amount);
  assert.equal(settled.provider_refunded_amount, order.amount, 'and what the provider says, kept apart');

  // The guest's own sheet says refunded rather than paid.
  const { body } = await api(`/api/orders/${accessToken}`);
  assert.equal(body.status, 'refunded');
  assert.equal(body.refunded_amount, order.amount);

  // And it is written down, once, with the figure in it.
  const events = settled.events.filter((e) => e.type === 'refund-reconciled');
  assert.equal(events.length, 1);
  assert.match(events[0].note, /completo/);
  assert.match(events[0].note, /provider-webhook/);
});

/* ══ B. A full refund of a Privilege-only order ═══════════════════════════ */

test('B a full refund revokes the card, and the card stops working everywhere', async (t) => {
  const { app, store, order, reservation } = await shop(t, { lines: [CARD_LINE] });

  const cardId = order.entitlements[0].id;
  const before = await store.cards.get(cardId);
  assert.equal(cardState(before), 'active');
  assert.deepEqual(entitlementsOf(before), ['privilege']);

  // It really does open a door before the refund.
  const code = currentCode(before, { signingKey: SIGNING_KEY, periodSeconds: PERIOD });
  const good = await validateCode({
    reference: before.public_ref, code: code.code, store, signingKey: SIGNING_KEY, periodSeconds: PERIOD,
  });
  assert.equal(good.valid, true);

  const outcome = await refundEvent(order, contextOf(app), order.amount);
  assert.deepEqual(outcome.revoked, [before.public_ref]);

  /* ── The card itself ─────────────────────────────────────────────────── */
  const after = await store.cards.get(cardId);
  assert.equal(after.status, 'revoked');
  assert.ok(after.revoked_at, 'and when');
  assert.match(after.revoked_reason, /rimborso completo/);
  assert.equal(cardState(after), 'revoked');

  /* ── Partner validation ──────────────────────────────────────────────── */
  const scan = await validateCode({
    reference: after.public_ref,
    code: currentCode(after, { signingKey: SIGNING_KEY, periodSeconds: PERIOD }).code,
    store, signingKey: SIGNING_KEY, periodSeconds: PERIOD,
  });
  assert.equal(scan.valid, false);
  assert.equal(scan.reason, 'revoked');


  /* ── Entitlements and the Pass ───────────────────────────────────────── */
  assert.deepEqual(entitlementsOf(after), [], 'owns nothing any more');
  assert.deepEqual(liveEntitlementsOf(after), []);

  const pass = await passForReservation({ store, reservation });
  assert.equal(pass.tier, 'pass', 'back to the standard Pass');
  assert.deepEqual(pass.entitlements, []);
  assert.deepEqual(pass.live_entitlements, []);

  // The card is kept, not deleted: the history and the reference stay readable.
  assert.ok(await store.cards.get(cardId));
  assert.equal(after.public_ref, before.public_ref);
  assert.equal(after.holder_name, before.holder_name);
});

test('B the holder is offered no QR once the card is revoked', async (t) => {
  const { app, store, order, api } = await shop(t, { lines: [CARD_LINE] });
  const token = order.entitlements[0].access_token;

  const live = await api(`/api/card/${token}`);
  assert.equal(live.body.state, 'active');
  assert.ok(live.body.qr, 'a rotating QR while the card is good');

  await refundEvent(order, contextOf(app), order.amount);

  const dead = await api(`/api/card/${token}`);
  assert.equal(dead.status, 200, 'the card still resolves — it is not deleted');
  assert.equal(dead.body.state, 'revoked');
  assert.equal(dead.body.qr, null, 'and there is nothing to show a door');
  assert.equal(dead.body.refreshIn, null);
  assert.equal(dead.body.reference, (await store.cards.get(order.entitlements[0].id)).public_ref);
});

/* ══ C. The same webhook twice ════════════════════════════════════════════ */

test('C a repeated full-refund webhook changes nothing the second time', async (t) => {
  const { app, store, order } = await shop(t, { lines: [CARD_LINE] });
  const cardId = order.entitlements[0].id;
  const ctx = contextOf(app);

  const first = await refundEvent(order, ctx, order.amount);
  assert.equal(first.action, 'refunded');
  const afterFirst = await store.orders.get(order.id);
  const revokedAt = (await store.cards.get(cardId)).revoked_at;

  // A different event id, the same charge: Stripe's own total is absolute, so
  // applying it again must compute the same end state and write nothing.
  const second = await refundEvent(order, ctx, order.amount);
  assert.equal(second.action, 'unchanged');

  const afterSecond = await store.orders.get(order.id);
  assert.equal(afterSecond.refunded_amount, order.amount, 'not doubled');
  assert.equal(afterSecond.provider_refunded_amount, order.amount);
  assert.equal(
    afterSecond.events.filter((e) => e.type === 'refund-reconciled').length, 1,
    'and one line in the history, not two',
  );
  assert.deepEqual(afterSecond.events, afterFirst.events);
  assert.equal((await store.cards.get(cardId)).revoked_at, revokedAt,
    'the moment the entitlement ended is not rewritten');
  assert.deepEqual(second.revoked, []);

  // And a literal retry of the very same event id is dropped before it gets here.
  const replay = { id: 'evt_identical', type: 'charge.refunded', data: { object: charge(order, order.amount) } };
  await handleStripeEvent(replay, ctx);
  const third = await handleStripeEvent(replay, ctx);
  assert.equal(third.deduplicated, true);
  assert.equal((await store.orders.get(order.id)).refunded_amount, order.amount);
});

/* ══ D. A partial external refund ═════════════════════════════════════════ */

test('D a partial external refund records the money and revokes nothing', async (t) => {
  const { app, store, order } = await shop(t, { lines: [CARD_LINE, BREAKFAST] });
  const cardId = order.entitlements[0].id;
  const part = Math.round(order.amount / 3);

  const outcome = await refundEvent(order, contextOf(app), part);
  assert.equal(outcome.action, 'recorded');
  assert.equal(outcome.full, false);
  assert.equal(outcome.needsReview, true);
  assert.deepEqual(outcome.revoked, [], 'Stripe cannot say which line this was');

  const after = await store.orders.get(order.id);
  assert.equal(after.status, 'paid', 'still paid: something is still owed');
  assert.equal(after.refunded_amount, part);
  assert.equal(after.provider_refunded_amount, part);
  assert.equal((await store.cards.get(cardId)).status, 'active',
    'a refunded breakfast is not a reason to revoke a card');

  // And a person is told, once, with the figures they need.
  const alerts = await store.alerts.open();
  const alert = alerts.find((a) => a.kind === 'partial-refund-unallocated');
  assert.ok(alert, `no alert raised: ${JSON.stringify(alerts.map((a) => a.kind))}`);
  assert.equal(alert.severity, 'action');
  assert.equal(alert.detail.order_id, order.id);
  assert.equal(alert.detail.refunded_amount, part);
  assert.equal(alert.detail.order_amount, order.amount);
});

test('D a second, larger partial refund accumulates without doubling', async (t) => {
  const { app, store, order } = await shop(t, { lines: [CARD_LINE, BREAKFAST] });
  const ctx = contextOf(app);

  await refundEvent(order, ctx, 500);
  await refundEvent(order, ctx, 1200);          // Stripe's running total, not the delta
  const after = await store.orders.get(order.id);
  assert.equal(after.provider_refunded_amount, 1200);
  assert.equal(after.refunded_amount, 1200);
  assert.equal(after.status, 'paid');

  // An event arriving out of order cannot make the total go backwards.
  await refundEvent(order, ctx, 500);
  assert.equal((await store.orders.get(order.id)).provider_refunded_amount, 1200);

  // One thing to look at, however many events arrived.
  const alerts = (await store.alerts.open()).filter((a) => a.kind === 'partial-refund-unallocated');
  assert.equal(alerts.length, 1);
  assert.ok(alerts[0].seen >= 2, 'with a count rather than a pile');
});

test('D a partial refund that reaches the whole amount is a full refund', async (t) => {
  const { app, store, order } = await shop(t, { lines: [CARD_LINE] });
  const ctx = contextOf(app);

  await refundEvent(order, ctx, 500, { refunded: false });
  assert.equal((await store.orders.get(order.id)).status, 'paid');

  // Stripe does not always set the flag; the arithmetic is the backstop.
  await refundEvent(order, ctx, order.amount, { refunded: false });
  assert.equal((await store.orders.get(order.id)).status, 'refunded');
  assert.equal((await store.cards.get(order.entitlements[0].id)).status, 'revoked');
});

test('D a refund with no readable amount changes nothing and asks a person', async (t) => {
  const { app, store, order } = await shop(t, { lines: [CARD_LINE] });

  const outcome = await handleStripeEvent({
    id: `evt_${randomUUID()}`, type: 'charge.refunded',
    data: { object: { id: 'ch_x', metadata: { order_id: order.id } } },
  }, contextOf(app));

  assert.equal(outcome.action, 'unreadable');
  assert.equal(outcome.needsReview, true);
  const after = await store.orders.get(order.id);
  assert.equal(after.status, 'paid', 'neither assumed nor ignored');
  assert.equal(Number(after.refunded_amount ?? 0), 0);
  assert.equal((await store.cards.get(order.entitlements[0].id)).status, 'active');
  assert.ok((await store.alerts.open()).some((a) => a.kind === 'refund-amount-unreadable'));
});

/* ══ E. LunArt's own line cancellation ════════════════════════════════════ */

test('E a guest cancelling one line still behaves exactly as before', async (t) => {
  const { store, stripe, order } = await shop(t, { lines: [CARD_LINE, BREAKFAST] });
  const breakfastIndex = order.lines.findIndex((line) => line.product_id === 'light-breakfast');
  const cardId = order.entitlements[0].id;

  const result = await cancelOrderLine({
    store, stripe, order, index: breakfastIndex, quantity: 2, actor: ACTORS.guest,
  });
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'refunded');

  const after = await store.orders.get(order.id);
  assert.equal(after.status, 'paid', 'the Card is still owed, so the order is not refunded');
  assert.equal(after.refunded_amount, order.lines[breakfastIndex].amount, 'line-derived, as before');
  assert.equal(after.lines[breakfastIndex].cancelled_quantity, 2);
  assert.equal((await store.cards.get(cardId)).status, 'active', 'and the card is untouched');
  assert.equal(Number(after.provider_refunded_amount ?? 0), 0,
    'nothing claims the provider reported this: LunArt made it happen');
});

test('E an external refund never makes the order-level figure smaller', async (t) => {
  const { app, store, stripe, order } = await shop(t, { lines: [CARD_LINE, BREAKFAST] });
  const breakfastIndex = order.lines.findIndex((line) => line.product_id === 'light-breakfast');

  // LunArt refunds the breakfast itself...
  await cancelOrderLine({ store, stripe, order, index: breakfastIndex, quantity: 2, actor: ACTORS.guest });
  const internal = await store.orders.get(order.id);

  // ...and the provider then reports a smaller figure of its own.
  await refundEvent(internal, contextOf(app), 100);
  const after = await store.orders.get(order.id);
  assert.equal(after.refunded_amount, internal.refunded_amount,
    'the larger of the two is the honest answer');
  assert.equal(after.provider_refunded_amount, 100, 'and what the provider said is still readable');
});

/* ══ F. The Staff-only reconciliation ════════════════════════════════════ */

test('F the staff reconciliation needs auth, a confirmation, and calls no provider', async (t) => {
  const { store, order } = await shop(t, { lines: [CARD_LINE] });

  /**
   * There is no provider to inject, which is the point.
   *
   * `reconcileRefundByHand` takes a store, an order, a confirmation and three
   * strings. Nothing it accepts could reach Stripe, so it cannot move money even by
   * mistake — worth asserting rather than assuming, because the whole operation
   * rests on the refund having already happened somewhere else.
   */
  assert.ok(!/stripe/i.test(reconcileRefundByHand.toString()),
    'the operation does not mention a provider anywhere in it');

  // No confirmation: refused, and told which order it matched so a person can check.
  const dry = await reconcileRefundByHand({ store, order, confirm: false });
  assert.equal(dry.ok, false);
  assert.equal(dry.reason, 'not-confirmed');
  assert.equal((await store.orders.get(order.id)).status, 'paid');
  assert.equal((await store.cards.get(order.entitlements[0].id)).status, 'active');

  // Confirmed: exactly what the webhook would have done.
  const done = await reconcileRefundByHand({
    store, order, confirm: true, actor: 'jacopo',
    reason: 'rimborsato sull’account Stripe sbagliato',
    providerReference: 're_externalaccount',
  });
  assert.equal(done.ok, true);
  assert.equal(done.action, 'refunded');
  assert.equal(done.refunded_amount, order.amount);
  assert.deepEqual(done.revoked, [(await store.cards.get(order.entitlements[0].id)).public_ref]);

  const after = await store.orders.get(order.id);
  assert.equal(after.status, 'refunded');
  assert.equal(after.refunded_amount, order.amount);
  assert.equal((await store.cards.get(order.entitlements[0].id)).status, 'revoked');

  // Who, when, why and the provider's own reference, in the order's own history.
  const entry = after.events.filter((e) => e.type === 'refund-reconciled').at(-1);
  assert.match(entry.note, /staff-reconciliation/);
  assert.match(entry.note, /da jacopo/);
  assert.match(entry.note, /re_externalaccount/);
  assert.match(entry.note, /account Stripe sbagliato/);

  // A second invocation changes nothing.
  const again = await reconcileRefundByHand({ store, order: after, confirm: true, actor: 'jacopo' });
  assert.equal(again.action, 'unchanged');
  assert.deepEqual((await store.orders.get(order.id)).events, after.events);
});

test('F over HTTP: staff token, explicit confirmation, and either name for the order', async (t) => {
  const { app, store, order } = await shop(t, { lines: [CARD_LINE] });
  const token = 'refund-staff-token';
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const reference = staffOrderView(order).reference;

  const post = async (body, { auth = true } = {}) => {
    const response = await fetch(`${base}/api/staff/orders/refund-reconcile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };

  assert.equal((await post({ order: reference, confirm: true }, { auth: false })).status, 401);
  assert.equal((await post({ order: reference, confirm: true }, { auth: false })).status, 401);

  const noOrder = await post({ confirm: true });
  assert.equal(noOrder.status, 422);
  assert.equal(noOrder.body.error, 'no-order-given');

  assert.equal((await post({ order: 'NOSUCH99', confirm: true })).status, 404);

  // Without a confirmation it refuses and names the order it matched, so the
  // screen can quote a guest and an amount before anything is written.
  const unconfirmed = await post({ order: reference });
  assert.equal(unconfirmed.status, 422);
  assert.equal(unconfirmed.body.error, 'not-confirmed');
  assert.equal(unconfirmed.body.order.reference, reference);
  assert.equal(unconfirmed.body.order.amount, order.amount);
  assert.equal((await store.orders.get(order.id)).status, 'paid');

  // The reference a guest would read out is accepted, not only the uuid.
  const done = await post({ order: reference, confirm: true, by: 'jacopo', reason: 'account sbagliato' });
  assert.equal(done.status, 200);
  assert.equal(done.body.action, 'refunded');
  assert.equal(done.body.order.status, 'refunded');
  assert.equal(done.body.refunded_amount, order.amount);
  assert.equal(done.body.revoked.length, 1);

  const second = await post({ order: order.id, confirm: true, by: 'jacopo' });
  assert.equal(second.status, 200);
  assert.equal(second.body.action, 'unchanged');
});

test('F an order that was never paid cannot be reconciled as refunded', async (t) => {
  const { store } = await shop(t, { lines: [CARD_LINE] });

  const pending = await store.orders.create({
    id: randomUUID(), object: 'order', status: 'pending', fulfilment_status: 'not-required',
    amount: 1500, currency: 'EUR', lines: [], entitlements: [], events: [], customer: {},
  });
  const refused = await reconcileRefundByHand({ store, order: pending, confirm: true });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'not-reconcilable');
  assert.equal(refused.status, 'pending');
  assert.equal((await store.orders.get(pending.id)).status, 'pending');
});

test('F the staff refund button now revokes the card it refunded', async (t) => {
  const { store, stripe, order } = await shop(t, { lines: [CARD_LINE] });
  const cardId = order.entitlements[0].id;

  const result = await refundOrder({ store, stripe, order, note: 'per telefono', by: 'diego' });
  assert.equal(result.ok, true);
  assert.equal(result.revoked.length, 1);

  const after = await store.orders.get(order.id);
  assert.equal(after.status, 'refunded');
  assert.equal(after.refunded_amount, order.amount, 'and for how much, which it never used to say');
  assert.equal((await store.cards.get(cardId)).status, 'revoked');
  assert.equal(after.fulfilment_status, 'cancelled', 'the thing is off too, as this button always did');
});

/* ══ G. Not a guest route ════════════════════════════════════════════════ */

test('G no guest route reaches the reconciliation', async (t) => {
  const { app } = await shop(t, { lines: [CARD_LINE] });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const path of [
    '/api/orders/refund-reconcile',
    '/api/refund-reconcile',
    '/api/cards/refund-reconcile',
    '/api/staff/sync/refund-reconcile',
  ]) {
    const response = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"confirm":true}',
    });
    assert.ok(
      response.status === 404 || response.status === 401,
      `${path} must not be a guest endpoint (got ${response.status})`,
    );
  }
});

/* ══ H. Everything else is left alone ════════════════════════════════════ */

test('H refunding one order touches no other order or card', async (t) => {
  const { app, store, reservation, order: mine } = await shop(t, { lines: [CARD_LINE] });

  // A second stay, with its own card, bought the same way.
  const other = await store.reservations.create(buildReservation({
    source: 'quovai', booking_reference: 'OTHER-1',
    first_name: 'Irene', last_name: 'Cappellini', guest_email: 'irene@example.invalid',
    check_in: propertyDate(), check_out: soon(4), room: '302', adults: 2,
  }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const buy = async (guideToken) => {
    const checkout = await (await fetch(`${base}/api/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ guideToken, lang: 'it', customer: CUSTOMER, lines: [CARD_LINE] }),
    })).json();
    const session = new URL(checkout.checkoutUrl, base).searchParams.get('session');
    await fetch(`${base}/mock-checkout/complete`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session }),
    });
    return store.orders.findByAccessToken(checkout.accessToken);
  };

  const theirs = await buy(other.guide_token);
  assert.notEqual(mine.id, theirs.id);

  await refundEvent(mine, contextOf(app), mine.amount);

  const theirsAfter = await store.orders.get(theirs.id);
  assert.equal(theirsAfter.status, 'paid');
  assert.equal(Number(theirsAfter.refunded_amount ?? 0), 0);
  assert.deepEqual(theirsAfter.events, theirs.events);
  assert.equal((await store.cards.get(theirs.entitlements[0].id)).status, 'active');

  const theirPass = await passForReservation({ store, reservation: other });
  assert.equal(theirPass.tier, 'privilege', 'their upgrade is still theirs');

  const minePass = await passForReservation({ store, reservation });
  assert.equal(minePass.tier, 'pass', 'and mine is back to standard');
});

test('H a refund for an order we do not hold is ignored rather than guessed at', async (t) => {
  const { app, store } = await shop(t, { lines: [CARD_LINE] });
  const before = (await store.orders.list({})).length;

  const outcome = await handleStripeEvent({
    id: `evt_${randomUUID()}`, type: 'charge.refunded',
    data: { object: { id: 'ch_unknown', amount: 1500, amount_refunded: 1500, refunded: true } },
  }, contextOf(app));

  assert.equal(outcome.ignored, true);
  assert.equal(outcome.reason, 'no-order');
  assert.equal((await store.orders.list({})).length, before);
});

/* ══ The module's own contract ═══════════════════════════════════════════ */

test('the reconciler refuses an order it has no business touching', async () => {
  const store = createStore();
  assert.deepEqual(await reconcileExternalRefund({ store, order: null }), { ok: false, reason: 'no-order' });

  const cancelled = await store.orders.create({
    id: randomUUID(), object: 'order', status: 'cancelled', fulfilment_status: 'cancelled',
    amount: 1500, currency: 'EUR', lines: [], entitlements: [], events: [], customer: {},
  });
  const refused = await reconcileExternalRefund({
    store, order: cancelled, amount: 1500, full: true, source: REFUND_SOURCES.provider,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'not-reconcilable');
});
