/**
 * The commerce API, over real HTTP.
 *
 * A listening server, the mock payment provider, and an in-memory store — so these
 * exercise the routes, the webhook handling and the state machine exactly as a
 * browser and Stripe would, without an account and without money.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';

import { createApp, handleStripeEvent } from '../server/app.js';
import { resetRateLimits } from '../server/rate-limit.js';
import { createStore } from '../server/store.js';
import { createMockStripe, verifyWebhookSignature, formEncode } from '../server/stripe.js';
import { DEV_PRICES } from '../commerce/prices.dev.js';
import { applyPriceOverrides } from '../commerce/prices.js';
import { propertyDate, addDays } from '../commerce/time.js';

let server;
let base;
let app;

const soon = (days) => addDays(propertyDate(), days);

before(async () => {
  applyPriceOverrides(DEV_PRICES);
  app = await createApp({
    store: createStore(),
    stripe: createMockStripe(),
    allowPlaceholderPrices: true,
    useDevPrices: false,            // already applied above
    cardSigningKey: 'server-test-key',
    cardCodePeriodSeconds: 60,
    staffToken: '',
    mode: 'development',
    publicUrl: 'http://127.0.0.1',
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server?.close(); applyPriceOverrides({}); });

const api = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: options.body ? 'POST' : 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: 'manual',
    ...options.raw,
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

const wineLine = (over = {}) => ({
  productId: 'wine-in-room', variantId: 'brunello', quantity: 1,
  date: soon(3), slotId: 'w-1900', room: '303', ...over,
});

const BRUNELLO = 8900;
const VERMENTINO = 4300;

const transferLine = () => ({
  productId: 'transfer-airport', variantId: 'to-airport', quantity: 1,
  date: soon(6), time: '09:30',
  fields: {
    passengerName: 'Jacopo Lunardi', passengers: '2',
    largeSuitcases: '2', trolleys: '1', personalBags: '1', phone: '+39392',
  },
});

const CUSTOMER = { name: 'Jacopo Lunardi', email: 'jacopo@example.com', room: '303' };

async function buy(lines, { pay = true } = {}) {
  const { body: checkout } = await api('/api/checkout', { body: { lines, customer: CUSTOMER, lang: 'it' } });
  const sessionId = new URL(checkout.checkoutUrl, base).searchParams.get('session');
  if (pay) await api('/mock-checkout/complete', { body: { session: sessionId } });
  return { ...checkout, sessionId };
}

/* ── Catalogue ───────────────────────────────────────────────────────────── */

test('the catalogue carries the amounts in force, and says how it is configured', async () => {
  const { status, body } = await api('/api/catalog');
  assert.equal(status, 200);
  assert.ok(body.products.length >= 7);
  assert.equal(body.prices['transfer-airport'].amount, 9000);
  assert.equal(body.prices['transfer-airport'].status, 'confirmed');
  assert.equal(body.allowPlaceholderPrices, true);
  assert.equal(body.paymentsMode, 'mock');
  assert.ok(body.partners.every((partner) => partner.active));
});

/* ── Server-side pricing ─────────────────────────────────────────────────── */

test('the server prices the basket itself and ignores what the client claims', async () => {
  const { body } = await api('/api/cart/price', {
    body: { lines: [{ ...wineLine(), amount: 1, price: 1, total: 1 }] },
  });
  assert.equal(body.ok, true);
  assert.equal(body.total, BRUNELLO);
  assert.equal(body.lines[0].unit, BRUNELLO);
});

test('a doctored payload buys nothing cheaper', async () => {
  const order = await buy([{ ...wineLine(), amount: 1, price: 1, unit_amount: 1 }]);
  assert.equal(order.amount, BRUNELLO);
  const { body } = await api(`/api/orders/${order.accessToken}`);
  assert.equal(body.amount, BRUNELLO);
  assert.equal(body.status, 'paid');
});

test('an invalid basket is refused with reasons rather than a charge', async () => {
  const { status, body } = await api('/api/checkout', {
    body: { lines: [{ ...wineLine(), date: '2020-01-01' }], customer: CUSTOMER },
  });
  assert.equal(status, 422);
  assert.equal(body.error, 'cart-invalid');
  assert.ok(body.errors.some((e) => e.code === 'date-in-past'));
});

test('checkout needs a name and an email', async () => {
  const { status, body } = await api('/api/checkout', { body: { lines: [wineLine()], customer: { name: 'A' } } });
  assert.equal(status, 400);
  assert.equal(body.error, 'customer-incomplete');
});

test('an empty basket cannot be checked out', async () => {
  const { status } = await api('/api/checkout', { body: { lines: [], customer: CUSTOMER } });
  assert.equal(status, 422);
});

/* ── Instant purchase ────────────────────────────────────────────────────── */

test('paying for an instant basket leaves a paid order', async () => {
  const order = await buy([wineLine(), wineLine({ variantId: 'vermentino', slotId: 'w-2000' })]);
  const { body } = await api(`/api/orders/${order.accessToken}`);
  assert.equal(body.status, 'paid');
  assert.equal(body.fulfilment_status, 'not-required');
  assert.equal(body.amount, BRUNELLO + VERMENTINO);
  assert.equal(body.lines.length, 2);
  assert.ok(body.reference.length >= 6);
});

test('abandoning the payment page cancels the order and charges nothing', async () => {
  const order = await buy([wineLine()], { pay: false });
  await api('/mock-checkout/cancel', { body: { session: order.sessionId } });
  const { body } = await api(`/api/orders/${order.accessToken}`);
  assert.equal(body.status, 'cancelled');
});

test('an unknown order token returns nothing at all', async () => {
  const { status, body } = await api('/api/orders/not-a-real-token');
  assert.equal(status, 404);
  assert.equal(body.error, 'not-found');
});

/* ── Entitlements ────────────────────────────────────────────────────────── */

test('paying for a card issues exactly one card, once', async () => {
  const order = await buy([{
    productId: 'privilege-card', variantId: '5d', quantity: 1,
    date: propertyDate(), fields: { holderName: 'Jacopo Lunardi' },
  }]);

  const { body } = await api(`/api/orders/${order.accessToken}`);
  assert.equal(body.status, 'paid');
  assert.equal(body.entitlements.length, 1);
  assert.equal(body.entitlements[0].holder, 'Jacopo Lunardi');
  assert.equal(body.entitlements[0].max_people, 2);

  // A second delivery of the same event must not produce a second card.
  const stored = await app.store.orders.findByAccessToken(order.accessToken);
  await handleStripeEvent({
    id: `evt_${randomUUID()}`, type: 'checkout.session.completed',
    data: { object: { id: stored.stripe_session_id, metadata: { order_id: stored.id }, payment_intent: stored.stripe_payment_intent_id } },
  }, { store: app.store, stripe: app.stripe, settings: app.settings });

  const { body: again } = await api(`/api/orders/${order.accessToken}`);
  assert.equal(again.entitlements.length, 1, 'still exactly one card');
});

test('a card can be opened with its own token and gives a live code', async () => {
  const order = await buy([{
    productId: 'privilege-card', variantId: '2d', quantity: 1,
    date: propertyDate(), fields: { holderName: 'Ada Lovelace' },
  }]);
  const { body: orderBody } = await api(`/api/orders/${order.accessToken}`);
  const token = orderBody.entitlements[0].access_token;

  const { body: card } = await api(`/api/card/${token}`);
  assert.equal(card.holder, 'Ada Lovelace');
  assert.equal(card.state, 'active');
  assert.match(card.qr, /\/validate-card\?c=.+&k=/);
  assert.equal(card.access_token, undefined, 'the card does not echo its own token');

  // A venue reads the code out of the QR, exactly as a scanner would.
  const scanned = new URL(card.qr);
  const reference = scanned.searchParams.get('c');
  const code = scanned.searchParams.get('k');

  const { body: valid } = await api('/api/card/validate', { body: { reference, code, partner: 'opera-caffe' } });
  assert.equal(valid.valid, true);
  assert.equal(valid.card.holder, 'Ada Lovelace');
  assert.equal(valid.partner.partner, 'Opera Caffè');

  // Scanned again, and again: nothing is consumed.
  for (let i = 0; i < 3; i++) {
    const { status, body: again } = await api('/api/card/validate', { body: { reference, code, partner: 'opera-caffe' } });
    assert.equal(status, 200);
    assert.equal(again.valid, true);
  }
});

test('the card payload tells the browser nothing about how it is protected', async () => {
  const order = await buy([{
    productId: 'privilege-card', variantId: '2d', quantity: 1,
    date: propertyDate(), fields: { holderName: 'Grace Hopper' },
  }]);
  const { body: orderBody } = await api(`/api/orders/${order.accessToken}`);
  const { body: card } = await api(`/api/card/${orderBody.entitlements[0].access_token}`);

  // The guest sees a membership card. Nothing on the wire describes a rotation,
  // a window, a period or a code expiry.
  for (const forbidden of ['code', 'manualCode', 'window', 'periodSeconds', 'secondsRemaining', 'codeExpiresAt']) {
    assert.equal(forbidden in card, false, `the card payload exposes "${forbidden}"`);
  }
  assert.ok(card.qr, 'it does carry the QR');
  assert.equal(typeof card.refreshIn, 'number', 'and when to quietly ask again');
});

/* ── Authorise, then capture or release ──────────────────────────────────── */

test('the transfer is authorised at checkout, not charged', async () => {
  const order = await buy([transferLine()]);
  assert.equal(order.paymentMode, 'authorize-then-capture');

  const { body } = await api(`/api/orders/${order.accessToken}`);
  assert.equal(body.status, 'authorized');
  assert.equal(body.fulfilment_status, 'awaiting-confirmation');
  assert.equal(body.amount, 9000);

  const stored = await app.store.orders.findByAccessToken(order.accessToken);
  const intent = await app.stripe.retrievePaymentIntent(stored.stripe_payment_intent_id);
  assert.equal(intent.status, 'requires_capture');
  assert.equal(intent.amount_received, 0, 'nothing has been taken');
});

test('the driver confirming captures the money', async () => {
  const order = await buy([transferLine()]);
  const stored = await app.store.orders.findByAccessToken(order.accessToken);

  const { status, body } = await api(`/api/provider/orders/${stored.id}/confirm`, { body: { note: 'Marco, Classe E' } });
  assert.equal(status, 200);
  assert.equal(body.status, 'paid');
  assert.equal(body.fulfilment_status, 'confirmed');
  assert.equal(body.provider.note, 'Marco, Classe E');

  const intent = await app.stripe.retrievePaymentIntent(stored.stripe_payment_intent_id);
  assert.equal(intent.status, 'succeeded');
  assert.equal(intent.amount_received, 9000);
});

test('nobody available releases the hold, and the guest pays nothing', async () => {
  const order = await buy([transferLine()]);
  const stored = await app.store.orders.findByAccessToken(order.accessToken);

  const { body } = await api(`/api/provider/orders/${stored.id}/decline`, { body: { note: 'nessuna auto' } });
  assert.equal(body.status, 'cancelled');
  assert.equal(body.fulfilment_status, 'declined');
  assert.equal(body.provider.authorisation_released, true);

  const intent = await app.stripe.retrievePaymentIntent(stored.stripe_payment_intent_id);
  assert.equal(intent.status, 'canceled');
  assert.equal(intent.amount_received, 0);

  const { body: guest } = await api(`/api/orders/${order.accessToken}`);
  assert.equal(guest.status, 'cancelled');
});

test('an order that has already been decided cannot be decided again', async () => {
  const order = await buy([transferLine()]);
  const stored = await app.store.orders.findByAccessToken(order.accessToken);
  await api(`/api/provider/orders/${stored.id}/confirm`, { body: {} });
  const { status } = await api(`/api/provider/orders/${stored.id}/decline`, { body: {} });
  assert.equal(status, 409);
});

test('the staff queue lists what is waiting, without guest tokens', async () => {
  await buy([transferLine()]);
  const { body } = await api('/api/provider/queue');
  assert.ok(body.orders.length > 0);
  for (const order of body.orders) {
    assert.equal(order.access_token, undefined);
    assert.ok(order.lines[0].fields.passengerName);
  }
});

test('with a staff token configured, the provider endpoints need it', async () => {
  const guarded = await createApp({
    store: createStore(), stripe: createMockStripe(),
    allowPlaceholderPrices: true, cardSigningKey: 'k', staffToken: 'secret-token', mode: 'development',
  });
  const listener = guarded.listen(0);
  await new Promise((resolve) => listener.once('listening', resolve));
  const url = `http://127.0.0.1:${listener.address().port}`;

  const refused = await fetch(`${url}/api/provider/queue`);
  assert.equal(refused.status, 401);

  const allowed = await fetch(`${url}/api/provider/queue`, { headers: { authorization: 'Bearer secret-token' } });
  assert.equal(allowed.status, 200);
  listener.close();
});

/* ── Webhooks ────────────────────────────────────────────────────────────── */

test('a webhook is processed once, however many times it arrives', async () => {
  const order = await buy([wineLine()], { pay: false });
  const stored = await app.store.orders.findByAccessToken(order.accessToken);
  const event = {
    id: `evt_${randomUUID()}`, type: 'checkout.session.completed',
    data: { object: { id: stored.stripe_session_id, metadata: { order_id: stored.id }, payment_intent: stored.stripe_payment_intent_id } },
  };
  const ctx = { store: app.store, stripe: app.stripe, settings: app.settings };

  const first = await handleStripeEvent(event, ctx);
  const second = await handleStripeEvent(event, ctx);
  assert.equal(first.deduplicated, undefined);
  assert.equal(second.deduplicated, true);
});

test('an event for an order we do not have is ignored, not an error', async () => {
  const result = await handleStripeEvent({
    id: `evt_${randomUUID()}`, type: 'checkout.session.completed',
    data: { object: { id: 'cs_unknown', metadata: { order_id: 'nope' } } },
  }, { store: app.store, stripe: app.stripe, settings: app.settings });
  assert.equal(result.ignored, true);
  assert.equal(result.reason, 'no-order');
});

test('a paid order cannot be walked backwards', async () => {
  const order = await buy([wineLine()]);
  const stored = await app.store.orders.findByAccessToken(order.accessToken);
  await handleStripeEvent({
    id: `evt_${randomUUID()}`, type: 'payment_intent.payment_failed',
    data: { object: { id: stored.stripe_payment_intent_id, metadata: { order_id: stored.id } } },
  }, { store: app.store, stripe: app.stripe, settings: app.settings });

  const { body } = await api(`/api/orders/${order.accessToken}`);
  assert.equal(body.status, 'paid', 'a late failure event does not unpay an order');
});

test('a refund is recorded', async () => {
  const order = await buy([wineLine()]);
  const stored = await app.store.orders.findByAccessToken(order.accessToken);
  await handleStripeEvent({
    id: `evt_${randomUUID()}`, type: 'charge.refunded',
    data: { object: { id: 'ch_1', payment_intent: stored.stripe_payment_intent_id, metadata: { order_id: stored.id } } },
  }, { store: app.store, stripe: app.stripe, settings: app.settings });
  const { body } = await api(`/api/orders/${order.accessToken}`);
  assert.equal(body.status, 'refunded');
});

/* ── Signature verification ──────────────────────────────────────────────── */

test('a signed webhook is accepted and a forged one is not', () => {
  const secret = 'whsec_test_secret';
  const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');

  assert.equal(verifyWebhookSignature(payload, `t=${timestamp},v1=${signature}`, secret).id, 'evt_1');

  assert.throws(() => verifyWebhookSignature(payload, `t=${timestamp},v1=${'0'.repeat(64)}`, secret), /does not match/);
  assert.throws(() => verifyWebhookSignature(`${payload} `, `t=${timestamp},v1=${signature}`, secret), /does not match/);
  assert.throws(() => verifyWebhookSignature(payload, `t=${timestamp - 4000},v1=${signature}`, secret), /outside tolerance/);
  assert.throws(() => verifyWebhookSignature(payload, 'nonsense', secret), /malformed/);
  assert.throws(() => verifyWebhookSignature(payload, `t=${timestamp},v1=${signature}`, ''), /not configured/);
});

test('an unverifiable webhook is refused without explaining why', async () => {
  const guarded = await createApp({
    store: createStore(), stripe: createMockStripe(),
    stripe: createMockStripe(), cardSigningKey: 'k', mode: 'development',
    stripeConfig: null,
  });
  // A configured webhook secret means signatures are required even in mock mode.
  guarded.settings.stripe = { ...guarded.settings.stripe, webhookSecret: 'whsec_x' };
  const listener = guarded.listen(0);
  await new Promise((resolve) => listener.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${listener.address().port}/api/stripe/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'evt_x' }),
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error, 'signature-verification-failed');
  assert.equal(Object.keys(body).length, 1, 'no detail that would help forge one');
  listener.close();
});

/* ── Stripe request shape ────────────────────────────────────────────────── */

test('checkout sessions are built from server amounts, never a Payment Link', async () => {
  const recorded = [];
  const recordingStripe = {
    ...createMockStripe(),
    async createCheckoutSession(params, options) {
      recorded.push({ params, options });
      return createMockStripe().createCheckoutSession(params);
    },
  };
  const probe = await createApp({
    store: createStore(), stripe: recordingStripe,
    allowPlaceholderPrices: true, cardSigningKey: 'k', mode: 'development', publicUrl: 'https://guide.example',
  });
  const listener = probe.listen(0);
  await new Promise((resolve) => listener.once('listening', resolve));

  await fetch(`http://127.0.0.1:${listener.address().port}/api/checkout`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lines: [transferLine()], customer: CUSTOMER, lang: 'it' }),
  });

  const [{ params, options }] = recorded;
  assert.equal(params.mode, 'payment');
  assert.equal(params.line_items[0].price_data.unit_amount, 9000, 'the amount comes from the catalogue');
  assert.equal(params.line_items[0].price_data.currency, 'eur');
  assert.equal(params.payment_intent_data.capture_method, 'manual');
  assert.ok(params.metadata.order_id, 'the order travels with the session');
  assert.match(params.success_url, /^https:\/\/guide\.example\/#\/order\//);
  assert.ok(options.idempotencyKey, 'writes carry an idempotency key');
  assert.equal(params.payment_link, undefined);
  listener.close();
});

test('nested parameters are encoded the way Stripe reads them', () => {
  const encoded = formEncode({ line_items: [{ price_data: { currency: 'eur', unit_amount: 9000 }, quantity: 2 }] });
  assert.ok(encoded.includes('line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=9000'));
  assert.ok(encoded.includes('line_items%5B0%5D%5Bquantity%5D=2'));
});

/* ── Health ──────────────────────────────────────────────────────────────── */

test('health reports how the server is configured, warnings and all', async () => {
  const { body } = await api('/api/health');
  assert.equal(body.ok, true);
  assert.equal(body.payments, 'mock');
  assert.ok(Array.isArray(body.warnings));
  assert.ok(body.availability.some((source) => source.configured === false),
    'unconfigured availability sources are reported as such');
});

/* ── Cancelling, over the wire ────────────────────────────────────────────── */

/**
 * The routes, not the arithmetic.
 *
 * `test/cancellation.test.mjs` proves the sums; this proves the wiring — that the
 * guest's own order token is what authorises a cancellation, that the policy is
 * enforced on the server side of the request, and that nothing the browser sends
 * about money is read.
 */
const payFor = async (lines) => {
  /**
   * The rate limits are per process and per minute, and this file makes a lot of
   * requests. Cleared here rather than raised in the server: the ceilings are real
   * and worth keeping real, and a test that trips one is testing the limiter by
   * accident instead of the thing it came for.
   */
  resetRateLimits();
  const checkout = await api('/api/checkout', {
    body: { lines, customer: { name: 'Jacopo', email: 'jacopo@example.com', room: '303' }, lang: 'it' },
  });
  assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
  const session = decodeURIComponent(checkout.body.checkoutUrl.split('session=')[1]);
  await api('/mock-checkout/pay', { body: { session } });
  return checkout.body.accessToken;
};

const brunchLine = (over = {}) => ({
  productId: 'brunch', variantId: 'opera', quantity: 1,
  date: soon(2), slotId: 'b-0900', room: '303', options: { hotDrink: 'cappuccino' }, ...over,
});

const cardLine = (over = {}) => ({
  productId: 'privilege-card', variantId: '2d', quantity: 1,
  date: soon(1), fields: { holderName: 'Jacopo Lunardi' }, ...over,
});

test('the order carries its own cancellation terms, and no Stripe id', async () => {
  const token = await payFor([brunchLine(), cardLine()]);
  const { body } = await api(`/api/orders/${token}`);

  assert.equal(body.status, 'paid');
  assert.equal(body.can_cancel, true);
  assert.equal(body.lines[0].cancellation.cancellable, true);
  assert.equal(body.lines[0].cancellation.policy.kind, 'dayBefore');
  assert.ok(body.lines[0].cancellation.deadline);
  assert.equal(body.lines[1].cancellation.cancellable, false);
  assert.equal(body.lines[1].cancellation.blocked, 'policy-none');

  const json = JSON.stringify(body);
  assert.ok(!json.includes('pi_mock'), 'no payment intent');
  assert.ok(!json.includes('cs_mock'), 'no checkout session');
});

test('the guest cancels the brunch and keeps the Privilege Card', async () => {
  const token = await payFor([brunchLine(), cardLine()]);
  const before = await api(`/api/orders/${token}`);
  const cardToken = before.body.entitlements[0].access_token;

  const cancelled = await api(`/api/orders/${token}/cancel`, { body: { line: 0 } });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.outcome, 'refunded');
  assert.equal(cancelled.body.amount, 6900, 'the brunch, and nothing else');
  assert.equal(cancelled.body.order.status, 'paid', 'the Card is still owed, so the order is not refunded');
  assert.equal(cancelled.body.order.refunded_amount, 6900);

  // And the card the guest paid for still works.
  const card = await api(`/api/card/${cardToken}`);
  assert.equal(card.status, 200);
  assert.ok(card.body.reference, 'the card is not revoked');
});

test('the same cancellation twice is refused the second time', async () => {
  const token = await payFor([brunchLine()]);
  assert.equal((await api(`/api/orders/${token}/cancel`, { body: { line: 0 } })).status, 200);

  const again = await api(`/api/orders/${token}/cancel`, { body: { line: 0 } });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already-cancelled');

  const after = await api(`/api/orders/${token}`);
  assert.equal(after.body.refunded_amount, 6900, 'and nothing further came back');
});

test('a line sold outright cannot be cancelled through the API either', async () => {
  const token = await payFor([cardLine()]);
  const refused = await api(`/api/orders/${token}/cancel`, { body: { line: 0 } });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'policy-none');
});

test('nothing the request says about money is read', async () => {
  const token = await payFor([brunchLine()]);
  // An amount, a product, a policy — all of it ignored in favour of the stored order.
  const cancelled = await api(`/api/orders/${token}/cancel`, {
    body: {
      line: 0,
      amount: 9999999,
      refund: 9999999,
      product_id: 'transfer-airport',
      cancellation: { kind: 'hoursBefore', hours: 0 },
    },
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.amount, 6900, 'the catalogue priced it, not the browser');
});

test('a line that does not exist, and an order that is not yours', async () => {
  const token = await payFor([brunchLine()]);
  resetRateLimits();
  assert.equal((await api(`/api/orders/${token}/cancel`, { body: { line: 9 } })).status, 422);
  assert.equal((await api(`/api/orders/${token}/cancel`, { body: { line: -1 } })).status, 422);
  assert.equal((await api(`/api/orders/${token}/cancel`, { body: {} })).status, 422);
  assert.equal((await api('/api/orders/not-a-token/cancel', { body: { line: 0 } })).status, 404);
});

test('cancelling part of an authorised transfer reduces what will be captured', async () => {
  resetRateLimits();
  const checkout = await api('/api/checkout', {
    body: {
      // Both legs of the same journey: one authorisation, two promises.
      lines: [
        { ...transferLine(), variantId: 'from-airport', date: soon(3), time: '14:00' },
        { ...transferLine(), variantId: 'to-airport', date: soon(6), time: '09:30' },
      ],
      customer: { name: 'Jacopo', email: 'jacopo@example.com', room: '303' },
      lang: 'it',
    },
  });
  assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
  assert.equal(checkout.body.paymentMode, 'authorize-then-capture');

  const session = decodeURIComponent(checkout.body.checkoutUrl.split('session=')[1]);
  await api('/mock-checkout/pay', { body: { session } });

  const token = checkout.body.accessToken;
  const authorised = await api(`/api/orders/${token}`);
  assert.equal(authorised.body.status, 'authorized');
  assert.equal(authorised.body.amount, 18000);

  const cancelled = await api(`/api/orders/${token}/cancel`, { body: { line: 1 } });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.outcome, 'reduced', 'a hold cannot be made smaller, only captured for less');
  assert.equal(cancelled.body.order.amount, 9000);
  assert.equal(cancelled.body.order.status, 'authorized', 'the other leg still stands');
  assert.equal(cancelled.body.order.refunded_amount, 0, 'nothing was taken, so nothing came back');
});
