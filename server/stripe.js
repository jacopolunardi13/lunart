/**
 * A small Stripe client, and a stand-in for when there are no keys.
 *
 * Written against the REST API rather than the official SDK, on purpose: the
 * surface we need is four calls and a signature check, the repository otherwise
 * has no runtime dependencies, and every byte that goes to Stripe is visible here.
 * Swapping in `stripe` later means replacing this one file — nothing else imports
 * it directly.
 *
 * Payment Links are not used. The flow is: guide → cart → server validation →
 * Checkout Session created server-side from amounts the server computed → payment
 * → webhook → order. A Payment Link would mean a price the client could choose.
 */

import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

const API = 'https://api.stripe.com';

/** Stripe takes form-encoded bodies with bracketed paths: a[b][0][c]=v */
export function formEncode(value, prefix = '') {
  const pairs = [];
  const walk = (node, path) => {
    if (node === undefined || node === null) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
    } else if (typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        walk(child, path ? `${path}[${key}]` : key);
      }
    } else {
      pairs.push(`${encodeURIComponent(path)}=${encodeURIComponent(String(node))}`);
    }
  };
  walk(value, prefix);
  return pairs.join('&');
}

/**
 * Verify a webhook came from Stripe and is recent.
 *
 * Throws rather than returning false: a caller that forgets to check a boolean
 * would process a forged event, and there is no safe default here.
 */
export function verifyWebhookSignature(rawBody, signatureHeader, secret, { toleranceSeconds = 300, now = Date.now() } = {}) {
  if (!secret) throw new Error('webhook secret is not configured');
  if (!signatureHeader) throw new Error('missing Stripe-Signature header');

  let timestamp = null;
  const signatures = [];
  for (const part of String(signatureHeader).split(',')) {
    const [key, value] = part.split('=');
    if (key?.trim() === 't') timestamp = Number(value);
    if (key?.trim() === 'v1') signatures.push(value?.trim());
  }
  if (!timestamp || Number.isNaN(timestamp)) throw new Error('malformed Stripe-Signature header');

  // A replayed delivery from hours ago is not a delivery we want to act on.
  if (Math.abs(Math.floor(now / 1000) - timestamp) > toleranceSeconds) {
    throw new Error('webhook timestamp outside tolerance');
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const matched = signatures.some((candidate) => {
    if (!candidate || candidate.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(candidate, 'hex'), expectedBuffer);
    } catch {
      return false;
    }
  });
  if (!matched) throw new Error('webhook signature does not match');

  return JSON.parse(rawBody);
}

class StripeError extends Error {
  constructor(message, { status, type, code } = {}) {
    super(message);
    this.name = 'StripeError';
    this.status = status;
    this.type = type;
    this.code = code;
  }
}

/** The real client. */
export function createStripe({ secretKey, apiVersion = '2024-06-20', fetchImpl = globalThis.fetch, baseUrl = API } = {}) {
  async function request(method, path, body, { idempotencyKey } = {}) {
    const headers = {
      authorization: `Bearer ${secretKey}`,
      'stripe-version': apiVersion,
      'content-type': 'application/x-www-form-urlencoded',
    };
    // Every write carries one, so a retried request cannot charge twice.
    if (idempotencyKey && method !== 'GET') headers['idempotency-key'] = idempotencyKey;

    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : formEncode(body ?? {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = payload?.error ?? {};
      throw new StripeError(error.message ?? `Stripe returned ${response.status}`, {
        status: response.status, type: error.type, code: error.code,
      });
    }
    return payload;
  }

  return {
    mode: 'live',
    createCheckoutSession: (params, options) => request('POST', '/v1/checkout/sessions', params, options),
    retrieveSession: (id) => request('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`),
    retrievePaymentIntent: (id) => request('GET', `/v1/payment_intents/${encodeURIComponent(id)}`),
    capturePaymentIntent: (id, params = {}, options) =>
      request('POST', `/v1/payment_intents/${encodeURIComponent(id)}/capture`, params, options),
    cancelPaymentIntent: (id, params = {}, options) =>
      request('POST', `/v1/payment_intents/${encodeURIComponent(id)}/cancel`, params, options),
    createRefund: (params, options) => request('POST', '/v1/refunds', params, options),
  };
}

/**
 * The stand-in used when no key is configured.
 *
 * It implements the same five calls against in-memory objects and hands back a URL
 * to the server's own checkout page, so the whole purchase — including manual
 * capture, capture and cancellation — can be walked through and tested without an
 * account. It is not a simulation of Stripe's behaviour in general: it is enough
 * of one that the code paths either side of it are the real ones.
 */
export function createMockStripe() {
  const sessions = new Map();
  const intents = new Map();

  const intentFor = (session) => intents.get(session.payment_intent);

  return {
    mode: 'mock',
    sessions,
    intents,

    async createCheckoutSession(params) {
      const id = `cs_mock_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const intentId = `pi_mock_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const amount = (params.line_items ?? []).reduce(
        (sum, item) => sum + Number(item.price_data?.unit_amount ?? 0) * Number(item.quantity ?? 1), 0,
      );
      const captureMethod = params.payment_intent_data?.capture_method ?? 'automatic';

      intents.set(intentId, {
        id: intentId,
        object: 'payment_intent',
        amount,
        amount_capturable: captureMethod === 'manual' ? amount : 0,
        amount_received: 0,
        currency: params.currency ?? 'eur',
        capture_method: captureMethod,
        status: 'requires_payment_method',
      });

      const session = {
        id,
        object: 'checkout.session',
        amount_total: amount,
        currency: params.currency ?? 'eur',
        payment_intent: intentId,
        payment_status: 'unpaid',
        status: 'open',
        metadata: params.metadata ?? {},
        customer_email: params.customer_email ?? null,
        success_url: params.success_url,
        cancel_url: params.cancel_url,
        url: `/mock-checkout?session=${encodeURIComponent(id)}`,
      };
      sessions.set(id, session);
      return session;
    },

    async retrieveSession(id) {
      const session = sessions.get(id);
      if (!session) throw new StripeError('No such checkout session', { status: 404 });
      return session;
    },

    async retrievePaymentIntent(id) {
      const intent = intents.get(id);
      if (!intent) throw new StripeError('No such payment intent', { status: 404 });
      return intent;
    },

    async capturePaymentIntent(id, params = {}) {
      const intent = intents.get(id);
      if (!intent) throw new StripeError('No such payment intent', { status: 404 });
      if (intent.status === 'succeeded') return intent;        // capture is idempotent here
      if (intent.status !== 'requires_capture') {
        throw new StripeError(`payment intent is ${intent.status}, cannot capture`, { status: 400, code: 'payment_intent_unexpected_state' });
      }
      // Capturing for less than was authorised is a real Stripe feature and the one
      // the cancellation path depends on, so the stand-in has to honour it or the
      // reduced-capture case would only ever be exercised against the live API.
      const asked = Number(params.amount_to_capture);
      const amount = Number.isFinite(asked) && asked >= 0
        ? Math.min(Math.trunc(asked), intent.amount_capturable)
        : intent.amount_capturable;
      intent.status = 'succeeded';
      intent.amount_received = amount;
      intent.amount_capturable = 0;
      return intent;
    },

    async cancelPaymentIntent(id) {
      const intent = intents.get(id);
      if (!intent) throw new StripeError('No such payment intent', { status: 404 });
      if (intent.status === 'canceled') return intent;
      if (intent.status === 'succeeded') {
        throw new StripeError('payment intent already captured, cancel is not possible', { status: 400, code: 'payment_intent_unexpected_state' });
      }
      intent.status = 'canceled';
      intent.amount_capturable = 0;
      return intent;
    },

    async createRefund({ payment_intent: intentId, amount }) {
      const intent = intents.get(intentId);
      if (!intent) throw new StripeError('No such payment intent', { status: 404 });
      if (intent.status !== 'succeeded' && intent.status !== 'partially_refunded') {
        throw new StripeError('nothing to refund', { status: 400 });
      }
      /**
       * Partial refunds, because that is the ordinary case.
       *
       * A guest cancels the brunch out of an order that also holds a Privilege Card.
       * Stripe refunds the amount asked for and leaves the intent otherwise alone;
       * a stand-in that marked the whole thing `refunded` would make the mixed-order
       * path untestable without a live key, which is exactly the path most worth
       * testing.
       */
      const already = Number(intent.amount_refunded ?? 0);
      const available = Math.max(0, Number(intent.amount_received ?? 0) - already);
      const asked = Number.isFinite(Number(amount)) ? Math.trunc(Number(amount)) : available;
      if (asked <= 0 || asked > available) {
        throw new StripeError('refund amount is more than is available', { status: 400, code: 'amount_too_large' });
      }
      intent.amount_refunded = already + asked;
      intent.status = intent.amount_refunded >= Number(intent.amount_received ?? 0) ? 'refunded' : 'partially_refunded';
      return {
        id: `re_mock_${randomUUID().slice(0, 12)}`,
        object: 'refund',
        payment_intent: intentId,
        amount: asked,
      };
    },

    /** Drives the mock checkout page: the guest "pays". */
    async completeSession(id) {
      const session = sessions.get(id);
      if (!session) throw new StripeError('No such checkout session', { status: 404 });
      const intent = intentFor(session);
      session.status = 'complete';
      if (intent.capture_method === 'manual') {
        intent.status = 'requires_capture';
        session.payment_status = 'unpaid';   // authorised, not taken — as Stripe reports it
      } else {
        intent.status = 'succeeded';
        intent.amount_received = intent.amount;
        session.payment_status = 'paid';
      }
      return session;
    },

    async expireSession(id) {
      const session = sessions.get(id);
      if (!session) throw new StripeError('No such checkout session', { status: 404 });
      session.status = 'expired';
      const intent = intentFor(session);
      if (intent && intent.status !== 'succeeded') intent.status = 'canceled';
      return session;
    },
  };
}

export { StripeError };
