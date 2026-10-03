/**
 * The commerce API, and the static guide alongside it.
 *
 * Serving both from one origin is deliberate: the guide and its API share a
 * domain, so there is no CORS surface and no third place for a secret to leak
 * through. The static half is the same site GitHub Pages serves; the API half is
 * everything that has to be trusted.
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

import { config, configWarnings } from './config.js';
import { createStore } from './store.js';
import { createStripe, createMockStripe, verifyWebhookSignature } from './stripe.js';
import {
  readJson, readRawBody, sendJson, sendHtml, sendText, redirect, serveStatic, matchRoute, escapeHtml,
} from './http.js';
import { priceAndBuild, stripeLineItems, fulfilOrder, orderView, canTransition, appendEvent } from './orders.js';
import { holderView, currentCode, validateCode, qrPayload, cardState, revoke } from './card.js';
import {
  PRODUCTS, PLANNED_PRODUCTS, COMMERCE_CATEGORIES, WINES, WINE_KINDS, DELIVERY_SLOTS,
  priceCart, priceTable, allSkus, isSellable, applyPriceOverrides, pricingGaps,
  isPurchasable, availabilitySources, PAYMENT_STATUS, FULFILMENT_STATUS,
} from '../commerce/index.js';
import { PARTNERS, activePartners } from '../commerce/partners.js';
import { renderMockCheckout } from './mock-checkout.js';
import { rateLimit, clientKey } from './rate-limit.js';

const ROOT = new URL('..', import.meta.url).pathname;

export async function createApp(overrides = {}) {
  const settings = { ...config, ...overrides };
  const store = overrides.store ?? createStore({ dataDir: settings.dataDir });

  // Preview-only prices are applied here, once, so every later read — the server's
  // and, through /api/catalog, the browser's — sees exactly the same table.
  if (settings.useDevPrices) {
    const { DEV_PRICES } = await import('../commerce/prices.dev.js');
    applyPriceOverrides(DEV_PRICES);
  }

  const stripe = overrides.stripe
    ?? (settings.stripe.secretKey
      ? createStripe({ secretKey: settings.stripe.secretKey, apiVersion: settings.stripe.apiVersion })
      : createMockStripe());

  const ctx = { settings, store, stripe };

  /* ── Catalogue ───────────────────────────────────────────────────────── */

  async function getCatalog(req, res) {
    const allowPlaceholders = settings.allowPlaceholderPrices;
    sendJson(res, 200, {
      currency: 'EUR',
      categories: COMMERCE_CATEGORIES,
      products: PRODUCTS.map((product) => ({
        ...product,
        purchasable: isPurchasable(product, { allowPlaceholders }),
      })),
      planned: PLANNED_PRODUCTS,
      wines: WINES,
      wineKinds: WINE_KINDS,
      deliverySlots: DELIVERY_SLOTS,
      partners: activePartners(),
      /** The amounts in force. The browser renders these and sends none of them back. */
      prices: priceTable(allSkus()),
      allowPlaceholderPrices: allowPlaceholders,
      paymentsConfigured: stripe.mode !== 'mock',
      paymentsMode: stripe.mode,
    });
  }

  /** Price a basket without buying it, so the cart can explain itself. */
  async function postCartPrice(req, res) {
    const body = await readJson(req);
    const priced = priceCart(body.lines ?? [], { allowPlaceholders: settings.allowPlaceholderPrices });
    sendJson(res, 200, {
      ok: priced.ok,
      empty: priced.empty,
      currency: priced.currency,
      subtotal: priced.subtotal,
      total: priced.total,
      errors: priced.errors,
      lines: priced.lines.map((l) => ({
        productId: l.line.productId,
        variantId: l.line.variantId,
        sku: l.line.sku,
        quantity: l.line.quantity,
        unit: l.unit,
        amount: l.amount,
        ok: l.ok,
        errors: l.errors,
        cutoff: l.cutoff,
      })),
    });
  }

  /* ── Checkout ────────────────────────────────────────────────────────── */

  async function postCheckout(req, res) {
    const limited = rateLimit(`checkout:${clientKey(req)}`, { limit: 20, windowMs: 60_000 });
    if (!limited.allowed) {
      sendJson(res, 429, { error: 'too-many-requests' }, { 'retry-after': String(limited.retryAfterSeconds) });
      return;
    }

    const body = await readJson(req);
    const customer = body.customer ?? {};
    const lang = body.lang === 'en' ? 'en' : 'it';

    if (!customer.name || !customer.email) {
      sendJson(res, 400, { error: 'customer-incomplete', fields: ['name', 'email'] });
      return;
    }

    const built = priceAndBuild({
      lines: body.lines ?? [],
      customer,
      lang,
      allowPlaceholders: settings.allowPlaceholderPrices,
    });

    if (!built.ok) {
      // The cart is re-checked here even though the client already checked it.
      // The client's opinion is a convenience; this is the decision.
      sendJson(res, 422, { error: 'cart-invalid', errors: built.priced.errors, total: built.priced.total });
      return;
    }

    const order = await store.orders.create(built.order);
    const manualCapture = order.payment_mode === 'authorize-then-capture';

    let session;
    try {
      session = await stripe.createCheckoutSession({
        mode: 'payment',
        currency: order.currency.toLowerCase(),
        line_items: stripeLineItems(order, lang),
        customer_email: customer.email,
        client_reference_id: order.id,
        metadata: { order_id: order.id },
        payment_intent_data: {
          capture_method: manualCapture ? 'manual' : 'automatic',
          metadata: { order_id: order.id },
          description: `LunArt · ${order.lines.map((l) => l.title).join(', ')}`.slice(0, 200),
        },
        success_url: `${settings.publicUrl}/#/order/${order.access_token}`,
        cancel_url: `${settings.publicUrl}/#/cart?cancelled=1`,
        locale: lang === 'it' ? 'it' : 'en',
      }, { idempotencyKey: `checkout:${order.id}` });
    } catch (error) {
      await store.orders.update(order.id, {
        status: PAYMENT_STATUS.failed,
        events: [...order.events, { at: new Date().toISOString(), type: 'checkout-failed', note: error.message }],
      });
      sendJson(res, 502, { error: 'payment-provider-unavailable', message: error.message });
      return;
    }

    await store.orders.update(order.id, {
      stripe_session_id: session.id,
      stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    });

    sendJson(res, 200, {
      orderId: order.id,
      accessToken: order.access_token,
      amount: order.amount,
      currency: order.currency,
      paymentMode: order.payment_mode,
      checkoutUrl: session.url,
      mock: stripe.mode === 'mock',
    });
  }

  /* ── Webhook ─────────────────────────────────────────────────────────── */

  async function postStripeWebhook(req, res) {
    const raw = await readRawBody(req);

    let event;
    if (stripe.mode === 'mock' && !settings.stripe.webhookSecret) {
      // No secret exists to sign with in mock mode. The endpoint is still exercised
      // end to end; only the signature step is absent, and it says so.
      try { event = JSON.parse(raw.toString('utf8')); } catch { sendJson(res, 400, { error: 'bad-json' }); return; }
      event.livemode = false;
      event.__unverified = true;
    } else {
      try {
        event = verifyWebhookSignature(raw.toString('utf8'), req.headers['stripe-signature'], settings.stripe.webhookSecret);
      } catch (error) {
        // Never say more than this: a precise reason helps someone forging one.
        sendJson(res, 400, { error: 'signature-verification-failed' });
        console.warn('[webhook] rejected:', error.message);
        return;
      }
    }

    const result = await handleStripeEvent(event, ctx);
    sendJson(res, 200, { received: true, ...result });
  }

  /* ── Orders and cards, for the guest ─────────────────────────────────── */

  async function getOrder(req, res, { token }) {
    const order = await store.orders.findByAccessToken(token);
    if (!order) { sendJson(res, 404, { error: 'not-found' }); return; }
    const cards = [];
    for (const entitlement of order.entitlements ?? []) {
      const card = await store.cards.get(entitlement.id);
      if (card) cards.push(card);
    }
    sendJson(res, 200, orderView(order, { cards }));
  }

  async function getCard(req, res, { token }) {
    const card = await store.cards.findByAccessToken(token);
    if (!card) { sendJson(res, 404, { error: 'not-found' }); return; }

    const view = holderView(card);
    const state = cardState(card);
    if (state !== 'active') {
      // No code is issued for a card that could not be honoured anyway.
      sendJson(res, 200, { ...view, code: null, qr: null });
      return;
    }
    const code = currentCode(card, {
      signingKey: settings.cardSigningKey,
      periodSeconds: settings.cardCodePeriodSeconds,
    });
    sendJson(res, 200, { ...view, code, qr: qrPayload(settings.publicUrl, card, code.code) });
  }

  /* ── Validation, for a venue ─────────────────────────────────────────── */

  async function postValidateCard(req, res) {
    // A venue scans a handful of cards a minute; anything beyond that is somebody
    // working through the keyspace, and they can wait.
    const byAddress = rateLimit(`validate:${clientKey(req)}`, { limit: 30, windowMs: 60_000 });
    if (!byAddress.allowed) {
      sendJson(res, 429, { valid: false, reason: 'too-many-attempts' },
        { 'retry-after': String(byAddress.retryAfterSeconds) });
      return;
    }

    const body = await readJson(req);

    // And a ceiling per card reference, so one card cannot be hammered from many
    // addresses at once.
    const reference = String(body.reference ?? body.c ?? '').trim().toUpperCase();
    const byReference = rateLimit(`validate-ref:${reference}`, { limit: 20, windowMs: 60_000 });
    if (reference && !byReference.allowed) {
      sendJson(res, 429, { valid: false, reason: 'too-many-attempts' },
        { 'retry-after': String(byReference.retryAfterSeconds) });
      return;
    }

    const result = await validateCode({
      reference,
      code: body.code ?? body.k,
      store,
      signingKey: settings.cardSigningKey,
      periodSeconds: settings.cardCodePeriodSeconds,
      grace: settings.cardCodeGrace,
    });
    sendJson(res, result.valid ? 200 : 422, result);
  }

  /* ── Provider decisions, for staff ───────────────────────────────────── */

  function staffAuthorised(req) {
    if (settings.staffToken) {
      const header = String(req.headers.authorization ?? '');
      return header === `Bearer ${settings.staffToken}`;
    }
    // Without a token configured this is a preview, not an operation. Refusing in
    // production is the safe side of the trade: better unusable than open.
    return settings.mode !== 'production';
  }

  async function postProviderDecision(req, res, { id, decision }) {
    if (!staffAuthorised(req)) { sendJson(res, 401, { error: 'unauthorised' }); return; }

    const order = await store.orders.get(id);
    if (!order) { sendJson(res, 404, { error: 'not-found' }); return; }
    if (order.status !== PAYMENT_STATUS.authorized) {
      sendJson(res, 409, { error: 'not-awaiting-confirmation', status: order.status });
      return;
    }

    const body = await readJson(req).catch(() => ({}));
    const updated = decision === 'confirm'
      ? await confirmProviderOrder(order, ctx, body.note)
      : await declineProviderOrder(order, ctx, body.note);

    sendJson(res, 200, {
      id: updated.id,
      status: updated.status,
      fulfilment_status: updated.fulfilment_status,
      provider: updated.provider,
    });
  }

  /** Everything staff need to work the queue, without exposing guest tokens. */
  async function getProviderQueue(req, res) {
    if (!staffAuthorised(req)) { sendJson(res, 401, { error: 'unauthorised' }); return; }
    const orders = await store.orders.list({ limit: 100 });
    sendJson(res, 200, {
      orders: orders
        .filter((o) => o.fulfilment_status === FULFILMENT_STATUS['awaiting-confirmation'])
        .map((o) => ({
          id: o.id,
          status: o.status,
          amount: o.amount,
          currency: o.currency,
          created_at: o.created_at,
          customer: { name: o.customer.name, phone: o.customer.phone },
          lines: o.lines.map((l) => ({ title: l.title, variant_title: l.variant_title, date: l.date, time: l.time, fields: l.fields })),
        })),
    });
  }

  /* ── Mock checkout ───────────────────────────────────────────────────── */

  async function getMockCheckout(req, res, _params, url) {
    if (stripe.mode !== 'mock') { sendText(res, 404, 'Not found'); return; }
    const sessionId = url.searchParams.get('session') ?? '';
    let session;
    try { session = await stripe.retrieveSession(sessionId); } catch { sendHtml(res, 404, '<p>Unknown session.</p>'); return; }
    const order = await store.orders.findBySession(sessionId);
    sendHtml(res, 200, renderMockCheckout({ session, order, escapeHtml }));
  }

  async function postMockCheckoutAction(req, res, { action }) {
    if (stripe.mode !== 'mock') { sendText(res, 404, 'Not found'); return; }
    const body = await readJson(req);
    const sessionId = String(body.session ?? '');

    if (action === 'cancel') {
      const session = await stripe.expireSession(sessionId);
      await handleStripeEvent({
        id: `evt_mock_${randomUUID()}`, type: 'checkout.session.expired', data: { object: session },
      }, ctx);
      sendJson(res, 200, { ok: true, redirect: session.cancel_url });
      return;
    }

    const session = await stripe.completeSession(sessionId);
    await handleStripeEvent({
      id: `evt_mock_${randomUUID()}`, type: 'checkout.session.completed', data: { object: session },
    }, ctx);
    sendJson(res, 200, { ok: true, redirect: session.success_url });
  }

  /* ── Diagnostics ─────────────────────────────────────────────────────── */

  async function getHealth(req, res) {
    sendJson(res, 200, {
      ok: true,
      mode: settings.mode,
      payments: stripe.mode,
      allowPlaceholderPrices: settings.allowPlaceholderPrices,
      pricingGaps: pricingGaps().length,
      availability: availabilitySources(),
      warnings: configWarnings(),
    });
  }

  const routes = [
    ['GET',  '/api/catalog', getCatalog],
    ['POST', '/api/cart/price', postCartPrice],
    ['POST', '/api/checkout', postCheckout],
    ['POST', '/api/stripe/webhook', postStripeWebhook],
    ['GET',  '/api/orders/:token', getOrder],
    ['GET',  '/api/card/:token', getCard],
    ['POST', '/api/card/validate', postValidateCard],
    ['GET',  '/api/provider/queue', getProviderQueue],
    ['POST', '/api/provider/orders/:id/:decision', postProviderDecision],
    ['GET',  '/mock-checkout', getMockCheckout],
    ['POST', '/mock-checkout/:action', postMockCheckoutAction],
    ['GET',  '/api/health', getHealth],
    // The QR a guest shows points here, so it must resolve to the venue's page and
    // not fall through to the guide's catch-all.
    ['GET',  '/validate-card', (req, res) => serveStatic(req, res, ROOT, '/validate-card.html')],
  ];

  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const route = matchRoute(routes, req.method, url.pathname);

    if (route) {
      try {
        await route.handler(req, res, route.params, url);
      } catch (error) {
        const status = error.statusCode ?? 500;
        if (status >= 500) console.error('[api]', req.method, url.pathname, error);
        if (!res.headersSent) sendJson(res, status, { error: status >= 500 ? 'internal-error' : error.message });
      }
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (await serveStatic(req, res, ROOT, url.pathname)) return;
      // Hash routing means everything unknown is still the guide.
      if (!url.pathname.startsWith('/api/') && await serveStatic(req, res, ROOT, '/index.html')) return;
    }
    sendText(res, 404, 'Not found');
  }

  return { handle, store, stripe, settings, listen: (port = settings.port) => createServer(handle).listen(port) };
}

/* ── Event handling, shared by the real webhook and the mock ───────────── */

/**
 * One place where a Stripe event changes an order.
 *
 * Idempotent twice over: the event id is remembered, and every step it takes is
 * safe to repeat. Stripe retries on any non-2xx and will happily deliver the same
 * event again — discovering that by issuing a second Privilege Card is not an
 * acceptable way to find out.
 */
export async function handleStripeEvent(event, { store, stripe, settings }) {
  if (!event?.id || !event?.type) return { ignored: true, reason: 'malformed' };
  if (await store.events.seen(event.id)) return { deduplicated: true };

  const object = event.data?.object ?? {};
  let order = null;

  if (object.metadata?.order_id) order = await store.orders.get(object.metadata.order_id);
  if (!order && object.id && event.type.startsWith('checkout.session')) order = await store.orders.findBySession(object.id);
  if (!order && event.type.startsWith('payment_intent')) order = await store.orders.findByPaymentIntent(object.id);
  if (!order && object.payment_intent) order = await store.orders.findByPaymentIntent(object.payment_intent);

  if (!order) {
    await store.events.remember(event.id, { type: event.type, note: 'no matching order' });
    return { ignored: true, reason: 'no-order' };
  }

  const move = async (status, patch = {}, note = '') => {
    if (!canTransition(order.status, status)) {
      return { skipped: true, from: order.status, to: status };
    }
    const next = appendEvent({ ...order, ...patch, status }, `status:${status}`, note);
    order = await store.orders.update(order.id, { ...patch, status, events: next.events });
    return { status };
  };

  let outcome = { ignored: true, reason: event.type };

  switch (event.type) {
    case 'checkout.session.completed': {
      const intentId = typeof object.payment_intent === 'string' ? object.payment_intent : order.stripe_payment_intent_id;
      const manual = order.payment_mode === 'authorize-then-capture';
      if (manual) {
        // Money is held, not taken. The guest owes nothing until a driver says yes.
        outcome = await move(PAYMENT_STATUS.authorized, {
          stripe_payment_intent_id: intentId,
          fulfilment_status: FULFILMENT_STATUS['awaiting-confirmation'],
          provider: { ...order.provider, status: 'awaiting', updated_at: new Date().toISOString() },
        }, 'authorised, awaiting provider');
      } else {
        outcome = await move(PAYMENT_STATUS.paid, { stripe_payment_intent_id: intentId }, 'paid at checkout');
        const fulfilled = await fulfilOrder(order, { store, signingKey: settings.cardSigningKey });
        order = fulfilled.order;
        outcome.entitlements = fulfilled.cards.length;
      }
      break;
    }

    case 'checkout.session.expired':
      outcome = await move(PAYMENT_STATUS.cancelled, { fulfilment_status: FULFILMENT_STATUS.cancelled }, 'checkout abandoned');
      break;

    case 'payment_intent.succeeded': {
      outcome = await move(PAYMENT_STATUS.paid, { stripe_payment_intent_id: object.id }, 'captured');
      const fulfilled = await fulfilOrder(order, { store, signingKey: settings.cardSigningKey });
      order = fulfilled.order;
      outcome.entitlements = fulfilled.cards.length;
      break;
    }

    case 'payment_intent.amount_capturable_updated':
      outcome = await move(PAYMENT_STATUS.authorized, {
        stripe_payment_intent_id: object.id,
        fulfilment_status: FULFILMENT_STATUS['awaiting-confirmation'],
      }, 'authorisation held');
      break;

    case 'payment_intent.canceled':
      outcome = await move(PAYMENT_STATUS.cancelled, { fulfilment_status: FULFILMENT_STATUS.cancelled }, 'authorisation released');
      break;

    case 'payment_intent.payment_failed':
      outcome = await move(PAYMENT_STATUS.failed, {}, object.last_payment_error?.message ?? '');
      break;

    case 'charge.refunded':
      outcome = await move(PAYMENT_STATUS.refunded, {}, 'refunded');
      break;

    default:
      outcome = { ignored: true, reason: `unhandled:${event.type}` };
  }

  await store.events.remember(event.id, { type: event.type, order_id: order.id });
  return outcome;
}

/* ── Provider decisions ────────────────────────────────────────────────── */

/**
 * The driver said yes: take the money that has been held since booking.
 *
 * If the authorisation cannot be captured — some payment methods will not hold
 * one, and an authorisation also lapses after a week — the fallback is to charge
 * and, if that is wrong, refund. It is the worse path and is only taken when the
 * better one is unavailable, which is why it is recorded on the order.
 */
export async function confirmProviderOrder(order, { store, stripe, settings }, note = '') {
  const events = [...(order.events ?? []), { at: new Date().toISOString(), type: 'provider-confirmed', note }];
  try {
    await stripe.capturePaymentIntent(order.stripe_payment_intent_id, {}, { idempotencyKey: `capture:${order.id}` });
  } catch (error) {
    return store.orders.update(order.id, {
      status: PAYMENT_STATUS.confirmed,
      fulfilment_status: FULFILMENT_STATUS.confirmed,
      provider: { status: 'confirmed', note, updated_at: new Date().toISOString(), capture_error: error.message },
      events: [...events, { at: new Date().toISOString(), type: 'capture-failed', note: error.message }],
    });
  }
  return store.orders.update(order.id, {
    status: PAYMENT_STATUS.paid,
    fulfilment_status: FULFILMENT_STATUS.confirmed,
    provider: { status: 'confirmed', note, updated_at: new Date().toISOString() },
    events: [...events, { at: new Date().toISOString(), type: 'captured' }],
  });
}

/** Nobody is available: let the hold go, so the guest is never actually charged. */
export async function declineProviderOrder(order, { store, stripe }, note = '') {
  const events = [...(order.events ?? []), { at: new Date().toISOString(), type: 'provider-declined', note }];
  let released = true;
  try {
    await stripe.cancelPaymentIntent(order.stripe_payment_intent_id, {}, { idempotencyKey: `cancel:${order.id}` });
  } catch (error) {
    released = false;
    events.push({ at: new Date().toISOString(), type: 'cancel-failed', note: error.message });
  }
  return store.orders.update(order.id, {
    status: PAYMENT_STATUS.cancelled,
    fulfilment_status: FULFILMENT_STATUS.declined,
    provider: { status: 'declined', note, updated_at: new Date().toISOString(), authorisation_released: released },
    events,
  });
}

export { revoke, isSellable };
