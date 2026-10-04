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
import { readFile } from 'node:fs/promises';

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
import { applySchedule, scheduleInForce, slotsFor, daysWithSlots } from '../commerce/schedule.js';
import {
  PARTNERS, activePartners, getPartner, guestBenefit, applyPartners, cardPartners,
  cardBenefits, stayBenefits,
} from '../commerce/partners.js';
import { publicProduct } from '../commerce/catalog.js';
import { cardStartDates, cardVariantsForStay } from '../commerce/stay.js';
import { renderMockCheckout } from './mock-checkout.js';
import { renderPreviewIndex } from './preview-index.js';
import { rateLimit, clientKey } from './rate-limit.js';

import { staffView, completePastStays, stayOf, isLive } from './reservations.js';
import { resolveGuideLink, guideContextView, recoverGuideLink } from './guide-link.js';
import {
  createMailer, scheduleGuideEmail, sendDueGuideEmails, renderGuideEmail,
  mailProviders, guideUrl, DELIVERY_STATUS,
} from './delivery.js';
import { ingestMessage, ingestMessages, ingestEvent, resolveAlert, raiseAlert } from './ingest/index.js';
import { createMailbox, mailboxSources, pollMailbox, createMemoryMailbox } from './ingest/mailbox.js';
import { createQuovaiApiAdapter, reservationSources } from './ingest/quovai-api.js';
import { reconcileFeeds } from './ingest/ical.js';
import { repairFromMailbox } from './ingest/repair.js';
import { createPushAdapter, notifyStaff, registerSubscription } from './push.js';
import { createProviderCalendar, providerCalendars } from './calendar/google.js';
import { freeSlots, freeDays, slotIsFree, verifySlotForCheckout } from './calendar/index.js';
import { createScheduler } from './scheduler.js';
import {
  STAFF_QUEUES, queueOf, staffOrderView, orderQueues, dashboard, syncOverview,
  setFulfilment, requestSubstitution, assignOrder, cancelOrder, refundOrder,
  createManualReservation, editReservation, cancelReservationByStaff, guideLinkFor,
} from './staff.js';

const ROOT = new URL('..', import.meta.url).pathname;

export async function createApp(overrides = {}) {
  const settings = { ...config, ...overrides };
  const store = overrides.store ?? createStore({ dataDir: settings.dataDir });

  // Preview-only prices are applied here, once, so every later read — the server's
  // and, through /api/catalog, the browser's — sees exactly the same table.
  if (settings.useDevPrices) {
    const { DEV_PRICES } = await import('../commerce/prices.dev.js');
    applyPriceOverrides(DEV_PRICES);
    // The same flag loads a fortnight of invented availability, so the booking
    // flow can be walked through. Production has neither.
    const { devSchedule } = await import('../commerce/schedule.dev.js');
    applySchedule(devSchedule());
    // And one obviously-fake card partner, so the Privilege Card can be bought and
    // the whole flow walked. Production has none, which is why it is not on sale.
    const { devPartners } = await import('../commerce/partners.dev.js');
    applyPartners(devPartners());
  }

  const stripe = overrides.stripe
    ?? (settings.stripe.secretKey
      ? createStripe({ secretKey: settings.stripe.secretKey, apiVersion: settings.stripe.apiVersion })
      : createMockStripe());

  /**
   * The outside world, as adapters. Each one reports whether it is actually
   * configured, and the unconfigured ones refuse rather than pretending.
   */
  const mailer = overrides.mailer ?? createMailer(settings);
  const mailbox = overrides.mailbox ?? createMailbox(settings);
  const push = overrides.push ?? createPushAdapter(settings);
  const quovaiApi = overrides.quovaiApi ?? createQuovaiApiAdapter(settings);
  const providerCalendar = overrides.providerCalendar ?? createProviderCalendar(settings);

  const ctx = { settings, store, stripe, mailer, push, providerCalendar };

  const origin = settings.publicUrl;

  /**
   * Two invented reservations, so the Staff app and the personal link have
   * something to show. Only in the preview, only when the store is empty, and
   * through the real ingestion path rather than written straight in.
   */
  let previewSeed = null;
  if (settings.useDevPrices && overrides.seed !== false) {
    const { seedPreview } = await import('./dev-seed.js');
    previewSeed = await seedPreview({ store, publicUrl: origin });
  }

  /* ── Catalogue ───────────────────────────────────────────────────────── */

  async function getCatalog(req, res) {
    const allowPlaceholders = settings.allowPlaceholderPrices;
    sendJson(res, 200, {
      currency: 'EUR',
      categories: COMMERCE_CATEGORIES,
      products: PRODUCTS.map((product) => ({
        ...publicProduct(product),
        purchasable: isPurchasable(product, { allowPlaceholders }),
      })),
      planned: PLANNED_PRODUCTS,
      wines: WINES,
      wineKinds: WINE_KINDS,
      deliverySlots: DELIVERY_SLOTS,
      /** The appointment days on offer, so the date picker cannot offer a blank one. */
      availability: Object.fromEntries(
        await Promise.all(PRODUCTS.filter((p) => p.availabilityMode === 'timeslots').map(async (p) => {
          const days = await freeDays({ calendar: providerCalendar, productId: p.id });
          return [p.id, { days, configured: days.length > 0, calendar: providerCalendar.configured }];
        })),
      ),
      /**
       * The schedule in force, so the browser checks a line against exactly the
       * times the server will accept. Same reasoning as the price table: one
       * source, published, rather than two copies that drift.
       */
      schedule: scheduleInForce(),
      partners: activePartners(),
      /**
       * The two kinds of benefit, kept apart. What comes with the stay is not what
       * the card is for, and a guest who already has the 30% must not be sold it
       * again.
       */
      stayBenefits: stayBenefits(settings.publicUrl),
      cardBenefits: cardBenefits(settings.publicUrl),
      /** The amounts in force. The browser renders these and sends none of them back. */
      prices: priceTable(allSkus()),
      allowPlaceholderPrices: allowPlaceholders,
      paymentsConfigured: stripe.mode !== 'mock',
      paymentsMode: stripe.mode,
    });
  }

  /**
   * The stay a request is being made inside, from the guest's own link.
   *
   * The browser sends the opaque guide token; the server turns it into dates. A
   * request with no token has no stay, and anything that has to fit inside one
   * simply cannot be sold — which is better than trusting a client-supplied range.
   */
  async function stayFor(body = {}) {
    const token = String(body.guideToken ?? '').trim();
    if (!token) return { stay: null, reservation: null };
    const resolved = await resolveGuideLink({ store, token });
    if (!resolved?.live) return { stay: null, reservation: resolved?.reservation ?? null, blocked: Boolean(resolved) };
    return { stay: resolved.stay, reservation: resolved.reservation };
  }

  /** Price a basket without buying it, so the cart can explain itself. */
  async function postCartPrice(req, res) {
    const body = await readJson(req);
    const { stay } = await stayFor(body);
    const priced = priceCart(body.lines ?? [], { allowPlaceholders: settings.allowPlaceholderPrices, stay });
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
        surcharge: l.surcharge ?? 0,
        surcharges: l.surcharges ?? [],
        ok: l.ok,
        errors: l.errors,
        cutoff: l.cutoff,
        cancellation: l.cancellation ?? null,
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

    const { stay, reservation, blocked } = await stayFor(body);
    if (blocked) {
      // The link resolves to a stay that is no longer live. Nothing new is sold
      // against a cancelled reservation.
      sendJson(res, 409, { error: 'reservation-not-live' });
      return;
    }

    const built = priceAndBuild({
      lines: body.lines ?? [],
      customer,
      lang,
      allowPlaceholders: settings.allowPlaceholderPrices,
      stay,
    });

    if (!built.ok) {
      // The cart is re-checked here even though the client already checked it.
      // The client's opinion is a convenience; this is the decision.
      sendJson(res, 422, { error: 'cart-invalid', errors: built.priced.errors, total: built.priced.total });
      return;
    }

    /**
     * The last look at the professional's calendar, and the one that can refuse.
     *
     * Browsing is allowed to fall back to the schedule when Google is unreachable;
     * a payment is not. Once a real calendar is configured, an appointment is only
     * sold if free/busy has just confirmed it — busy is refused, and so is a
     * calendar we could not read. Selling an unverified hour means a professional
     * arriving to a room already booked, a refund, and a guest given a time that
     * never existed; asking them to try again in a minute is far cheaper than that.
     *
     * With no calendar connected nothing changes: the schedule is the whole truth,
     * and `priceCart` has already checked it.
     */
    for (const line of built.priced.lines) {
      if (line.product?.availabilityMode !== 'timeslots') continue;

      const check = await verifySlotForCheckout({
        calendar: providerCalendar,
        productId: line.product.id,
        date: line.line.date,
        time: line.line.time,
        variantId: line.line.variantId,
      });
      if (check.ok) continue;

      if (check.reason === 'slot-taken') {
        sendJson(res, 409, {
          error: 'slot-taken',
          product: line.product.id,
          date: line.line.date,
          time: line.line.time,
        });
        return;
      }

      // The calendar could not be read. Nothing is created, nothing is charged, and
      // staff are told — a booking refused for this reason is LunArt losing a sale,
      // which is worth somebody noticing.
      await raiseAlert({
        store,
        key: `provider-calendar-unavailable:${providerCalendar.id}`,
        kind: 'provider-calendar-unavailable',
        severity: 'action',
        detail: {
          message: 'Calendario del professionista non raggiungibile: le prenotazioni hair vengono rifiutate.',
          calendar: providerCalendar.id,
          code: check.code ?? 'unavailable',
          error: check.message ?? null,
          product: line.product.id,
          date: line.line.date,
          time: line.line.time,
        },
      }).catch(() => {});

      console.warn('[checkout] refused: provider calendar unreadable —', check.message ?? check.code);
      sendJson(res, 503, {
        error: 'availability-temporarily-unavailable',
        product: line.product.id,
        date: line.line.date,
        time: line.line.time,
        retryable: true,
      }, { 'retry-after': '60' });
      return;
    }

    const order = await store.orders.create({
      ...built.order,
      /** Which stay this belongs to, when the guest came in by their own link. */
      reservation_id: reservation?.id ?? null,
      customer: {
        ...built.order.customer,
        room: built.order.customer.room || reservation?.room || '',
        booking_reference: built.order.customer.booking_reference || reservation?.booking_reference || '',
      },
    });
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
    let order = await store.orders.findByAccessToken(token);
    if (!order) { sendJson(res, 404, { error: 'not-found' }); return; }

    /**
     * Stripe webhooks are the durable source of truth, but the guest should not
     * sit on "pending" merely because a webhook is delayed or misconfigured.
     * When they return from Stripe, reconcile a still-pending order directly
     * against the Checkout Session created with this server's own Stripe key.
     *
     * This is intentionally read-only from Stripe's point of view: it retrieves
     * the session and feeds the same event handler the webhook uses. The event id
     * is deterministic, so refreshing the order page is idempotent.
     */
    if (
      order.status === PAYMENT_STATUS.pending
      && order.stripe_session_id
      && stripe.mode !== 'mock'
    ) {
      try {
        const session = await stripe.retrieveSession(order.stripe_session_id);
        let type = null;
        if (session.status === 'complete') type = 'checkout.session.completed';
        else if (session.status === 'expired') type = 'checkout.session.expired';

        if (type) {
          await handleStripeEvent({
            id: `reconcile:${type}:${session.id}`,
            type,
            data: { object: session },
          }, ctx);
          order = await store.orders.get(order.id) ?? order;
        }
      } catch (error) {
        // The order page must still load if Stripe is temporarily unreachable.
        console.warn('[order] Stripe reconciliation failed:', error.message);
      }
    }

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
      sendJson(res, 200, { ...view, qr: null, refreshIn: null });
      return;
    }

    const code = currentCode(card, {
      signingKey: settings.cardSigningKey,
      periodSeconds: settings.cardCodePeriodSeconds,
    });
    // Only the QR and when to ask again. The window number, the period and the
    // expiry stay on this side: the card is a membership card as far as the guest
    // is concerned, and the screen has nothing to say about how it is protected.
    sendJson(res, 200, {
      ...view,
      qr: qrPayload(settings.publicUrl, card, code.code),
      refreshIn: code.secondsRemaining,
    });
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

    // A venue that asked from its own page is told its own benefit, not a list.
    const partnerId = String(body.partner ?? '').trim() || null;
    const result = await validateCode({
      reference,
      code: body.code ?? body.k,
      store,
      signingKey: settings.cardSigningKey,
      periodSeconds: settings.cardCodePeriodSeconds,
      grace: settings.cardCodeGrace,
      partnerId,
    });
    sendJson(res, result.valid ? 200 : 422, result);
  }

  /**
   * The times a product is free on one day.
   *
   * Read from the same schedule the validator uses, so the form can only offer
   * what checkout will accept. With nothing configured it returns an empty list
   * and says so rather than inventing a grid.
   */
  async function getAvailability(req, res, { id }, url) {
    const product = PRODUCTS.find((p) => p.id === id);
    if (!product) { sendJson(res, 404, { error: 'not-found' }); return; }

    const date = url.searchParams.get('date');
    const variantId = url.searchParams.get('variant') || null;
    const days = daysWithSlots(product.id);

    // The schedule says when LunArt offers appointments; the calendar only takes
    // away the ones already committed. It can never add one.
    const onDay = date
      ? await freeSlots({ calendar: providerCalendar, productId: product.id, date, variantId })
      : { slots: [], source: 'schedule' };

    sendJson(res, 200, {
      product: product.id,
      mode: product.availabilityMode,
      configured: days.length > 0,
      days,
      slots: onDay.slots,
      source: onDay.source,
      calendar: {
        configured: providerCalendar.configured,
        ...(onDay.calendarError ? { error: onDay.calendarError } : {}),
      },
    });
  }

  /* ── Partners ────────────────────────────────────────────────────────── */

  /** What a partner's own scanner page needs to render itself. */
  async function getPartnerInfo(req, res, { id }) {
    const partner = getPartner(id);
    if (!partner?.active) { sendJson(res, 404, { error: 'not-found' }); return; }
    sendJson(res, 200, guestBenefit(partner.partner_id, settings.publicUrl));
  }

  /**
   * A manifest per partner, so each one can add their own scanner to the home
   * screen and get an icon that opens straight into it. Without this they would
   * all install as the same app and land on whichever page was bookmarked last.
   */
  async function getPartnerManifest(req, res, { id }) {
    const partner = getPartner(id);
    if (!partner?.active) { sendText(res, 404, 'Not found'); return; }
    res.writeHead(200, { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'no-cache' })
      .end(JSON.stringify({
        name: `LunArt · ${partner.name}`,
        short_name: partner.name.slice(0, 12),
        description: `Verifica le LunArt Privilege Card presso ${partner.name}.`,
        start_url: `/partner/${partner.partner_id}`,
        scope: `/partner/${partner.partner_id}`,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#faf9f7',
        theme_color: '#1a1a1a',
        lang: 'it',
        icons: [
          { src: '/assets/icon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: '/assets/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      }, null, 2));
  }

  /* ── Provider decisions, for staff ───────────────────────────────────── */

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

  /* ── The personal guide link ─────────────────────────────────────────── */

  /**
   * What the guide knows about the guest who opened it.
   *
   * The token is the only thing the browser holds, and it is opaque: this is where
   * it becomes a first name, a room and a set of dates. What comes back is the
   * minimum the guide needs — no surname, no email, no phone, no booking number.
   */
  async function getGuideContext(req, res, { token }) {
    const limited = rateLimit(`guide:${clientKey(req)}`, { limit: 60, windowMs: 60_000 });
    if (!limited.allowed) {
      sendJson(res, 429, { error: 'too-many-requests' }, { 'retry-after': String(limited.retryAfterSeconds) });
      return;
    }

    const resolved = await resolveGuideLink({ store, token });
    if (!resolved) { sendJson(res, 404, { error: 'not-found' }); return; }

    const view = guideContextView(resolved);
    /** The card lengths this stay can actually take, so the form offers no others. */
    const card = PRODUCTS.find((p) => p.id === 'privilege-card');
    const variants = resolved.stay ? cardVariantsForStay(card?.variants ?? [], resolved.stay) : [];
    sendJson(res, 200, {
      ...view,
      cardOptions: variants.map((variant) => ({
        variantId: variant.id,
        days: variant.meta?.days ?? null,
        startDates: cardStartDates(resolved.stay, variant.meta?.days ?? 0),
      })),
    });
  }

  /**
   * A banner nobody can miss, on a server nobody should mistake for the real one.
   *
   * Injected rather than written into the files, so the static site GitHub Pages
   * publishes is untouched and a preview cannot be confused with it.
   */
  const PREVIEW_BANNER = `<div class="preview-flag" role="status">
    <strong>ANTEPRIMA</strong> · dati di prova · nessun pagamento reale · nessuna email agli ospiti
  </div>`;

  async function sendPage(res, file, { base = false } = {}) {
    let html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    if (base) html = html.replace('<head>', '<head>\n<base href="/">');
    if (settings.preview) html = html.replace('<body>', `<body>\n${PREVIEW_BANNER}`);
    sendHtml(res, 200, html, { 'cache-control': 'no-cache' });
  }

  /**
   * The guide itself, served from a personal link.
   *
   * `index.html` references its assets relatively, because the static site is also
   * published by GitHub Pages and may sit under a path. From `/g/<token>` that would
   * ask for `/g/assets/...`, so this one route sends the same page with a `<base>` on
   * it. The file on disk is untouched: the static deployment keeps working exactly as
   * it does now.
   */
  const getGuidePage = (req, res) => sendPage(res, 'index.html', { base: true });
  const getIndexPage = (req, res) => sendPage(res, 'index.html');
  const getStaffPage = (req, res) => sendPage(res, 'staff.html');

  /**
   * The preview's own front door.
   *
   * A demonstration server reseeds itself whenever the host puts it to sleep, so the
   * personal links change. Rather than ask somebody to go and find them, this page
   * reads the live ones — on a server that only ever holds invented reservations,
   * and only when preview mode is on.
   */
  async function getPreviewIndex(req, res) {
    if (!settings.preview) { sendText(res, 404, 'Not found'); return; }

    const reservations = (await store.reservations.list({ limit: 10 }))
      .filter((reservation) => reservation.status === 'active' || reservation.status === 'modified');

    const links = reservations.map((reservation) => ({
      guest: [reservation.first_name, reservation.last_name].filter(Boolean).join(' '),
      room: reservation.room,
      dates: `${reservation.check_in} → ${reservation.check_out}`,
      url: `${origin}/g/${reservation.guide_token}`,
    }));

    sendHtml(res, 200, renderPreviewIndex({ origin, links, escapeHtml }), { 'cache-control': 'no-store' });
  }

  /**
   * A lost link, given back.
   *
   * Surname and booking number, heavily rate limited, and one answer for every
   * failure. The limit is per address and per surname, so working through booking
   * numbers for one guest is as slow as working through guests.
   */
  async function postGuideRecover(req, res) {
    const body = await readJson(req);
    const lastName = String(body.lastName ?? '').trim();
    const reference = String(body.reference ?? '').trim();

    // Per address generously, because a family on the same hotel Wi-Fi shares one;
    // per surname tightly, because that is the axis somebody guessing moves along.
    const byAddress = rateLimit(`recover:${clientKey(req)}`, { limit: 10, windowMs: 10 * 60_000 });
    const byName = rateLimit(`recover-name:${lastName.toLowerCase()}`, { limit: 5, windowMs: 10 * 60_000 });
    if (!byAddress.allowed || !byName.allowed) {
      sendJson(res, 429, { ok: false, reason: 'too-many-attempts' },
        { 'retry-after': String(Math.max(byAddress.retryAfterSeconds ?? 0, byName.retryAfterSeconds ?? 0)) });
      return;
    }

    if (!lastName || !reference) { sendJson(res, 400, { ok: false, reason: 'incomplete' }); return; }

    const result = await recoverGuideLink({ store, lastName, reference, origin });
    // Same status and same body whether the reservation exists or not.
    if (!result.ok) { sendJson(res, 404, { ok: false, reason: 'not-found' }); return; }
    sendJson(res, 200, result);
  }

  /* ── Reservation ingestion ───────────────────────────────────────────── */

  /**
   * QuoVai's webhook, when QuoVai has one.
   *
   * The route exists so the address can be given out and the plumbing tested; the
   * adapter decides whether it can be honoured. Unconfigured it answers 503 with a
   * reason, which is a better thing to find in their logs than a 404.
   */
  async function postQuovaiWebhook(req, res) {
    const raw = await readRawBody(req);
    if (!quovaiApi.configured) {
      sendJson(res, 503, { error: 'source-not-configured', requires: quovaiApi.requires });
      return;
    }
    if (!quovaiApi.verify(raw.toString('utf8'), req.headers['x-quovai-signature'] ?? req.headers['x-signature'])) {
      sendJson(res, 400, { error: 'signature-verification-failed' });
      return;
    }
    let event;
    try {
      event = quovaiApi.toEvent(JSON.parse(raw.toString('utf8')));
    } catch (error) {
      sendJson(res, 422, { error: error.code ?? 'unmappable-payload', message: error.message });
      return;
    }
    const result = await ingestEvent({ store, event });
    sendJson(res, result.ok ? 200 : 422, result);
  }

  /* ── Staff ───────────────────────────────────────────────────────────── */

  function staffAuthorised(req) {
    if (settings.staffToken) {
      const header = String(req.headers.authorization ?? '');
      return header === `Bearer ${settings.staffToken}`;
    }
    // Without a token configured this is a preview, not an operation. Refusing in
    // production is the safe side of the trade: better unusable than open.
    return settings.mode !== 'production';
  }

  const guard = (handler) => async (req, res, params, url) => {
    if (!staffAuthorised(req)) { sendJson(res, 401, { error: 'unauthorised' }); return; }
    await handler(req, res, params, url);
  };

  async function getStaffDashboard(req, res) {
    sendJson(res, 200, {
      ...await dashboard({ store }),
      push: { configured: push.configured, publicKey: push.publicKey },
      sources: reservationSources(settings),
    });
  }

  async function getStaffOrders(req, res, _params, url) {
    const queue = url.searchParams.get('queue');
    const orders = await store.orders.list({ limit: 200 });
    const chosen = queue && STAFF_QUEUES.includes(queue)
      ? orders.filter((order) => queueOf(order) === queue)
      : orders;
    sendJson(res, 200, {
      queue: queue ?? 'all',
      counts: Object.fromEntries(STAFF_QUEUES.map((q) => [q, orders.filter((o) => queueOf(o) === q).length])),
      orders: chosen.map((order) => staffOrderView(order)),
    });
  }

  /** One function per decision a person can make. Money only where it says money. */
  async function postStaffOrderAction(req, res, { id, action }) {
    const order = await store.orders.get(id);
    if (!order) { sendJson(res, 404, { error: 'not-found' }); return; }
    const body = await readJson(req).catch(() => ({}));
    const note = String(body.note ?? '').slice(0, 300);
    const by = String(body.by ?? 'staff').slice(0, 40);

    let result;
    switch (action) {
      case 'confirm':
        if (order.status !== PAYMENT_STATUS.authorized) {
          sendJson(res, 409, { error: 'not-awaiting-confirmation', status: order.status });
          return;
        }
        result = { ok: true, order: await confirmProviderOrder(order, ctx, note) };
        break;
      case 'reject':
        if (order.status !== PAYMENT_STATUS.authorized) {
          sendJson(res, 409, { error: 'not-awaiting-confirmation', status: order.status });
          return;
        }
        result = { ok: true, order: await declineProviderOrder(order, ctx, note) };
        break;
      case 'preparing':
        result = await setFulfilment({ store, order, to: FULFILMENT_STATUS['in-preparation'], note, by });
        break;
      case 'delivered':
        result = await setFulfilment({ store, order, to: FULFILMENT_STATUS.delivered, note, by });
        break;
      case 'completed':
        result = await setFulfilment({ store, order, to: FULFILMENT_STATUS.completed, note, by });
        break;
      case 'substitution':
        result = await requestSubstitution({ store, order, note, by });
        break;
      case 'assign':
        result = await assignOrder({ store, order, assignee: body.assignee, by });
        break;
      case 'cancel':
        result = await cancelOrder({ store, stripe, order, note, by });
        break;
      case 'refund':
        result = await refundOrder({ store, stripe, order, note, by });
        break;
      default:
        sendJson(res, 400, { error: 'unknown-action' });
        return;
    }

    if (!result.ok) { sendJson(res, 409, result); return; }
    sendJson(res, 200, {
      ok: true,
      order: staffOrderView(result.order),
      refund_outstanding: result.refund_outstanding ?? false,
      released: result.released ?? undefined,
    });
  }

  /** How to reach the guest about this order, assembled from the order itself. */
  async function getStaffOrderContact(req, res, { id }) {
    const order = await store.orders.get(id);
    if (!order) { sendJson(res, 404, { error: 'not-found' }); return; }
    const phone = order.customer?.phone
      || order.lines.map((l) => l.fields?.phone).find(Boolean)
      || '';
    const digits = String(phone).replace(/[^\d+]/g, '');
    sendJson(res, 200, {
      name: order.customer?.name ?? '',
      email: order.customer?.email ?? '',
      phone,
      room: order.customer?.room ?? order.lines.map((l) => l.room).find(Boolean) ?? '',
      whatsapp: digits ? `https://wa.me/${digits.replace(/^\+/, '')}` : null,
      tel: digits ? `tel:${digits}` : null,
      mailto: order.customer?.email ? `mailto:${order.customer.email}` : null,
    });
  }

  async function getStaffReservations(req, res, _params, url) {
    const all = await store.reservations.list({ limit: 300 });
    const which = url.searchParams.get('status');
    const rows = which ? all.filter((r) => r.status === which) : all;
    sendJson(res, 200, {
      reservations: rows
        .sort((a, b) => String(a.check_in).localeCompare(String(b.check_in)))
        .map(staffView),
    });
  }

  async function postStaffReservations(req, res) {
    const body = await readJson(req);
    const result = await createManualReservation({ store, input: body });
    if (!result.ok) { sendJson(res, 422, result); return; }
    await notifyStaff({
      store, push, event: 'reservation-new',
      data: {
        reservationId: result.reservation.id,
        guest: [result.reservation.first_name, result.reservation.last_name].filter(Boolean).join(' '),
        room: result.reservation.room,
        check_in: result.reservation.check_in,
        check_out: result.reservation.check_out,
      },
    });
    sendJson(res, 201, { ok: true, action: result.action, reservation: staffView(result.reservation) });
  }

  async function postStaffReservationAction(req, res, { id, action }) {
    const reservation = await store.reservations.get(id);
    if (!reservation) { sendJson(res, 404, { error: 'not-found' }); return; }
    const body = await readJson(req).catch(() => ({}));

    if (action === 'edit') {
      const result = await editReservation({ store, reservation, patch: body });
      sendJson(res, 200, { ok: true, action: result.action, reservation: staffView(result.reservation) });
      return;
    }
    if (action === 'cancel') {
      const result = await cancelReservationByStaff({ store, reservation, reason: body.reason ?? '' });
      sendJson(res, 200, { ok: true, reservation: staffView(result.reservation) });
      return;
    }
    if (action === 'link') {
      const result = await guideLinkFor({ store, reservation, origin, rotate: body.rotate === true });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    if (action === 'email') {
      // Re-date the email, or see what it would say. Nothing is sent from here.
      const delivery = await scheduleGuideEmail({ store, reservation, reason: 'staff' });
      sendJson(res, 200, {
        ok: true,
        delivery,
        preview: renderGuideEmail({ reservation, origin, lang: reservation.lang }),
      });
      return;
    }
    sendJson(res, 400, { error: 'unknown-action' });
  }

  async function getStaffSync(req, res) {
    const mailboxState = mailbox?.state?.() ?? {};
    const mailerState = mailer.state?.() ?? {};
    const pushState = push.state?.() ?? {};
    const calendarState = providerCalendar.state?.() ?? {};

    sendJson(res, 200, {
      ...await syncOverview({ store }),
      mailbox: mailbox
        ? {
          id: mailbox.id,
          implemented: mailbox.implemented !== false,
          configured: mailbox.configured,
          enabled: settings.mailboxPollMinutes > 0,
          lastError: mailboxState.lastError ?? null,
          lastSuccessAt: mailboxState.lastSuccessAt ?? null,
          requires: mailbox.requires ?? [],
        }
        : { id: null, implemented: true, configured: false, requires: ['RESERVATION_MAILBOX'] },
      mail: {
        provider: mailer.id,
        implemented: true,
        configured: mailer.configured,
        enabled: settings.deliveryPollMinutes > 0,
        lastError: mailerState.lastError ?? null,
        lastSuccessAt: mailerState.lastSuccessAt ?? null,
        requires: mailer.requires ?? ['MAIL_PROVIDER'],
      },
      push: {
        implemented: true,
        configured: push.configured,
        transport: push.id,
        lastError: pushState.lastError ?? null,
        lastSuccessAt: pushState.lastSuccessAt ?? null,
        requires: push.requires,
      },
      calendar: {
        id: providerCalendar.id,
        implemented: true,
        configured: providerCalendar.configured,
        lastError: calendarState.lastError ?? null,
        lastSuccessAt: calendarState.lastSuccessAt ?? null,
        requires: providerCalendar.requires,
      },
      sources: reservationSources(settings),
      /** What runs on a timer, and how it is getting on. */
      schedule: scheduler.state(),
    });
  }

  /** Read the mailbox now, rather than waiting for the next poll. */
  async function postStaffPoll(req, res) {
    const result = await pollMailbox({ store, mailbox, ingest: ingestMessages });
    sendJson(res, result.ok ? 200 : 503, result);
  }

  /**
   * Re-read the mailbox and correct what an earlier parser filed badly.
   *
   * Staff-triggered and nothing else: it is behind the same token as every other
   * staff route, it is not one of the scheduled jobs, and it is the only operation
   * that looks past the message de-duplication. Nothing it does creates a
   * reservation, moves a date, touches a guide link or sends an email — see
   * `server/ingest/repair.js`, which says so in more detail and is where the
   * guarantees actually live.
   */
  async function postStaffRepair(req, res) {
    const result = await repairFromMailbox({ store, mailbox });
    sendJson(res, result.ok ? 200 : 503, result);
  }

  /** Run one scheduled job on demand, from the Staff app. */
  async function postStaffRunJob(req, res, { job }) {
    if (!scheduler.has(job)) { sendJson(res, 404, { error: 'unknown-job' }); return; }
    const result = await scheduler.runJob(job, { force: true });
    sendJson(res, result.ok ? 200 : 409, { job, ...result, state: scheduler.state().find((entry) => entry.id === job) });
  }

  /** Compare the calendars now. */
  async function postStaffReconcile(req, res) {
    const result = await reconcileFeeds({ store, feeds: settings.icalFeeds });
    sendJson(res, result.ok ? 200 : 503, result);
  }

  /**
   * Feed one notification in by hand.
   *
   * The way a forwarded email becomes a reservation when the mailbox is not
   * connected, and the way the whole ingestion path is exercised in the preview.
   */
  async function postStaffIngest(req, res) {
    const body = await readJson(req);
    const result = await ingestMessage({
      store,
      message: {
        subject: body.subject ?? '',
        from: body.from ?? '',
        body: body.body ?? '',
        messageId: body.messageId ?? '',
      },
    });
    sendJson(res, result.ok ? 200 : 422, result);
  }

  async function postStaffAlertResolve(req, res, { id }) {
    const alert = await resolveAlert({ store, id });
    if (!alert) { sendJson(res, 404, { error: 'not-found' }); return; }
    sendJson(res, 200, { ok: true, alert });
  }

  /** Register a phone for notifications. Accepted with or without VAPID keys. */
  async function postStaffSubscribe(req, res) {
    const body = await readJson(req);
    const result = await registerSubscription({ store, subscription: body.subscription, label: body.label });
    sendJson(res, result.ok ? 200 : 400, { ...result, configured: push.configured });
  }

  /** Send one, so a phone can be checked. Says plainly when nothing really went. */
  async function postStaffNotifyTest(req, res) {
    const result = await notifyStaff({
      store, push, event: 'reconciliation',
      data: { key: 'test', message: 'Notifica di prova dalla LunArt Staff app' },
    });
    sendJson(res, 200, result);
  }

  /** The emails due now. Nothing leaves unless a mail provider is configured. */
  async function postStaffSendEmails(req, res) {
    const sent = await sendDueGuideEmails({ store, mailer, origin });
    sendJson(res, 200, {
      ok: true,
      provider: mailer.id,
      configured: mailer.configured,
      processed: sent.length,
      deliveries: sent,
    });
  }

  /** A manifest of its own, so the Staff app installs as itself. */
  async function getStaffManifest(req, res) {
    res.writeHead(200, { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'no-cache' })
      .end(JSON.stringify({
        name: 'LunArt Staff',
        short_name: 'LunArt Staff',
        description: 'Ordini, prenotazioni e sincronizzazione per lo staff LunArt.',
        start_url: '/staff',
        scope: '/staff',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#16140f',
        theme_color: '#16140f',
        lang: 'it',
        icons: [
          { src: '/assets/icon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: '/assets/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      }, null, 2));
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

  /**
   * What is actually true about one integration.
   *
   * Four states, because "it isn't working" covers four different problems and they
   * have four different fixes:
   *
   *   operational         implemented, configured, and the last thing it did worked
   *   credentials-missing implemented and waiting on a key — somebody has to fill in
   *                       an environment variable, and nothing else
   *   unavailable         implemented and configured, but the provider refused or
   *                       could not be reached. Nobody has to change anything; it
   *                       either comes back or it is an outage
   *   disabled            deliberately off: configured, but the interval is zero or
   *                       the feature was not asked for
   *
   * `not-implemented` exists for completeness and nothing returns it any more.
   */
  function integrationState({
    implemented = true, configured = false, enabled = true,
    lastError = null, lastSuccessAt = null, requires = [], note = null, extra = {},
  }) {
    // A preview's credentials are not missing, they are refused: saying
    // `credentials-missing` would send an operator looking for a value to add,
    // when adding it would change nothing.
    const state = !implemented ? 'not-implemented'
      : settings.preview && !configured ? 'disabled-in-preview'
        : !configured ? 'credentials-missing'
          : !enabled ? 'disabled'
            : lastError ? 'unavailable'
              : 'operational';
    return {
      implemented,
      configured,
      enabled,
      state,
      requires,
      lastError,
      lastSuccessAt,
      note: state === 'disabled-in-preview'
        ? 'LUNART_PREVIEW is on: this is switched off and its credentials are not read.'
        : note,
      ...extra,
    };
  }

  async function getHealth(req, res) {
    const mailboxState = mailbox?.state?.() ?? {};
    const mailerState = mailer.state?.() ?? {};
    const pushState = push.state?.() ?? {};
    const calendarState = providerCalendar.state?.() ?? {};

    sendJson(res, 200, {
      ok: true,
      mode: settings.mode,
      preview: settings.preview,
      payments: stripe.mode,
      allowPlaceholderPrices: settings.allowPlaceholderPrices,
      pricingGaps: pricingGaps().length,
      availability: availabilitySources(),
      appointmentDays: Object.fromEntries(
        PRODUCTS.filter((p) => p.availabilityMode === 'timeslots').map((p) => [p.id, daysWithSlots(p.id).length]),
      ),
      cardPartners: cardPartners().length,
      cardOnSale: isPurchasable(PRODUCTS.find((p) => p.id === 'privilege-card'), {
        allowPlaceholders: settings.allowPlaceholderPrices,
      }),

      /** Every outside system, and exactly where it stands. */
      integrations: {
        payments: integrationState({
          configured: stripe.mode !== 'mock',
          requires: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
          note: stripe.mode === 'mock' ? 'Built-in stand-in: the flow works, no money moves.' : null,
          extra: { provider: stripe.mode, testMode: settings.stripe.testMode },
        }),
        reservationMailbox: integrationState({
          implemented: true,
          configured: Boolean(mailbox?.configured),
          enabled: settings.mailboxPollMinutes > 0,
          requires: mailbox?.requires ?? ['RESERVATION_MAILBOX'],
          lastError: mailboxState.lastError ?? null,
          lastSuccessAt: mailboxState.lastSuccessAt ?? null,
          extra: {
            source: mailbox?.id ?? null,
            query: mailbox?.query ?? null,
            pollMinutes: settings.mailboxPollMinutes,
            lastCount: mailboxState.lastCount ?? 0,
            skipped: (mailboxState.skipped ?? []).length,
            options: mailboxSources(settings),
          },
        }),
        guestEmail: integrationState({
          implemented: true,
          configured: Boolean(mailer.configured),
          enabled: settings.deliveryPollMinutes > 0,
          requires: mailer.requires ?? ['MAIL_PROVIDER'],
          lastError: mailerState.lastError ?? null,
          lastSuccessAt: mailerState.lastSuccessAt ?? null,
          note: mailer.configured ? null : 'Every send is simulated: the body is rendered and kept, nothing leaves.',
          extra: {
            provider: mailer.id,
            requested: mailer.requestedProvider ?? settings.mailProvider ?? null,
            from: settings.mailFrom,
            pollMinutes: settings.deliveryPollMinutes,
            options: mailProviders(settings),
          },
        }),
        reservationApi: integrationState({
          implemented: true,
          configured: quovaiApi.configured,
          requires: quovaiApi.requires,
          note: quovaiApi.configured ? null : 'Interface agreed and routed; waiting on QuoVai.',
          extra: { openQuestions: quovaiApi.openQuestions.length },
        }),
        icalReconciliation: integrationState({
          implemented: true,
          configured: settings.icalFeeds.length > 0,
          enabled: settings.icalPollMinutes > 0,
          requires: ['QUOVAI_ICAL_FEEDS'],
          extra: { feeds: settings.icalFeeds.length, pollMinutes: settings.icalPollMinutes },
        }),
        staffPush: integrationState({
          implemented: true,
          configured: push.configured,
          requires: push.requires,
          lastError: pushState.lastError ?? null,
          lastSuccessAt: pushState.lastSuccessAt ?? null,
          note: push.configured ? null : 'The Staff app polls; notifications are recorded and marked simulated.',
          extra: { transport: push.id, sent: pushState.sent ?? 0, removed: pushState.removed ?? 0 },
        }),
        providerCalendar: integrationState({
          implemented: true,
          configured: providerCalendar.configured,
          requires: providerCalendar.requires,
          lastError: calendarState.lastError ?? null,
          lastSuccessAt: calendarState.lastSuccessAt ?? null,
          note: providerCalendar.configured ? null : 'Appointments are kept by LunArt and not written to a calendar.',
          extra: {
            id: providerCalendar.id,
            writeCalendar: providerCalendar.writeCalendar,
            timeZone: providerCalendar.timeZone ?? 'Europe/Rome',
            options: providerCalendars(settings),
          },
        }),
      },

      schedule: scheduler.state(),
      warnings: configWarnings(),
    });
  }

  /** The same thing, checked live rather than remembered. Staff only: it costs calls. */
  async function getIntegrationChecks(req, res) {
    const checks = {};
    for (const [name, adapter] of Object.entries({
      reservationMailbox: mailbox, guestEmail: mailer, staffPush: push, providerCalendar,
    })) {
      checks[name] = adapter?.check ? await adapter.check() : { ok: false, reason: 'no-check' };
    }
    sendJson(res, 200, { checks, at: new Date().toISOString() });
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
    ['GET',  '/api/staff/checks', guard(getIntegrationChecks)],
    ['POST', '/api/staff/sync/run/:job', guard(postStaffRunJob)],
    ['GET',  '/api/availability/:id', getAvailability],
    ['GET',  '/api/partners/:id', getPartnerInfo],
    ['GET',  '/partner/:id/manifest.webmanifest', getPartnerManifest],
    ['GET',  '/partner/:id', (req, res) => sendPage(res, 'partner.html')],

    /* The guest's own link. The page is the guide; the context comes from the API. */
    ['GET',  '/api/guide/:token', getGuideContext],
    ['POST', '/api/guide/recover', postGuideRecover],
    ['GET',  '/g/:token', getGuidePage],
    ['GET',  '/preview', getPreviewIndex],
    ['GET',  '/recover', (req, res) => sendPage(res, 'recover.html')],

    /* Reservation ingestion. */
    ['POST', '/api/quovai/webhook', postQuovaiWebhook],

    /* Staff. Every one of these is behind the staff token. */
    ['GET',  '/api/staff/dashboard', guard(getStaffDashboard)],
    ['GET',  '/api/staff/orders', guard(getStaffOrders)],
    ['GET',  '/api/staff/orders/:id/contact', guard(getStaffOrderContact)],
    ['POST', '/api/staff/orders/:id/:action', guard(postStaffOrderAction)],
    ['GET',  '/api/staff/reservations', guard(getStaffReservations)],
    ['POST', '/api/staff/reservations', guard(postStaffReservations)],
    ['POST', '/api/staff/reservations/:id/:action', guard(postStaffReservationAction)],
    ['GET',  '/api/staff/sync', guard(getStaffSync)],
    ['POST', '/api/staff/sync/poll', guard(postStaffPoll)],
    ['POST', '/api/staff/sync/repair', guard(postStaffRepair)],
    ['POST', '/api/staff/sync/reconcile', guard(postStaffReconcile)],
    ['POST', '/api/staff/sync/ingest', guard(postStaffIngest)],
    ['POST', '/api/staff/sync/send-emails', guard(postStaffSendEmails)],
    ['POST', '/api/staff/alerts/:id/resolve', guard(postStaffAlertResolve)],
    ['POST', '/api/staff/push/subscribe', guard(postStaffSubscribe)],
    ['POST', '/api/staff/push/test', guard(postStaffNotifyTest)],
    ['GET',  '/staff/manifest.webmanifest', getStaffManifest],
    ['GET',  '/staff', getStaffPage],
    // The QR a guest shows points here, so it must resolve to the venue's page and
    // not fall through to the guide's catch-all.
    ['GET',  '/validate-card', (req, res) => sendPage(res, 'validate-card.html')],
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
      if (url.pathname === '/' || url.pathname === '/index.html') { await getIndexPage(req, res); return; }
      if (await serveStatic(req, res, ROOT, url.pathname)) return;
      // Hash routing means everything unknown is still the guide.
      if (!url.pathname.startsWith('/api/')) { await getIndexPage(req, res); return; }
    }
    sendText(res, 404, 'Not found');
  }

  /**
   * The work nobody triggers.
   *
   * Four jobs on their own intervals, each off unless its configuration says
   * otherwise. The scheduler guarantees they never overlap themselves and backs off
   * when something upstream is down; `runScheduledWork` forces one of each, which is
   * what the tests and the Staff app's buttons use.
   */
  const scheduler = createScheduler({
    jobs: [
      {
        id: 'mailbox',
        intervalMinutes: settings.mailboxPollMinutes,
        enabled: Boolean(mailbox) && settings.mailboxPollMinutes > 0,
        requires: mailbox ? null : 'RESERVATION_MAILBOX',
        run: async () => {
          const result = await pollMailbox({ store, mailbox, ingest: ingestMessages });
          // A refusal is a failure as far as the schedule is concerned, so it backs
          // off instead of asking a mailbox that is not there every minute.
          if (!result.ok) throw new Error(result.reason ?? 'poll failed');
          return result;
        },
      },
      {
        id: 'guest-email',
        intervalMinutes: settings.deliveryPollMinutes,
        enabled: settings.deliveryPollMinutes > 0,
        run: async () => {
          const sent = await sendDueGuideEmails({ store, mailer, origin });
          return { processed: sent.length, provider: mailer.id, simulated: !mailer.configured };
        },
      },
      {
        id: 'ical',
        intervalMinutes: settings.icalPollMinutes,
        enabled: settings.icalFeeds.length > 0 && settings.icalPollMinutes > 0,
        requires: settings.icalFeeds.length > 0 ? null : 'QUOVAI_ICAL_FEEDS',
        run: async () => {
          const result = await reconcileFeeds({ store, feeds: settings.icalFeeds });
          if (!result.ok) throw new Error(result.reason ?? 'reconciliation failed');
          return result;
        },
      },
      {
        id: 'housekeeping',
        intervalMinutes: settings.housekeepingMinutes,
        enabled: settings.housekeepingMinutes > 0,
        run: async () => ({ completed: (await completePastStays({ store })).length }),
      },
    ],
  });

  /** One of each, now, whatever the intervals say. */
  async function runScheduledWork({ now = new Date(), force = true } = {}) {
    const did = {};
    for (const id of ['mailbox', 'guest-email', 'ical', 'housekeeping']) {
      did[id] = await scheduler.runJob(id, { force });
    }
    return did;
  }

  return {
    handle,
    store,
    stripe,
    settings,
    mailer,
    mailbox,
    push,
    quovaiApi,
    providerCalendar,
    runScheduledWork,
    scheduler,
    previewSeed,
    listen: (port = settings.port) => createServer(handle).listen(port),
  };
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
export async function handleStripeEvent(event, { store, stripe, settings, push = null, providerCalendar = null }) {
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
        await alertStaff(order, { store, push });
      } else {
        outcome = await move(PAYMENT_STATUS.paid, { stripe_payment_intent_id: intentId }, 'paid at checkout');
        const fulfilled = await fulfilOrder(order, { store, signingKey: settings.cardSigningKey, providerCalendar });
        order = fulfilled.order;
        outcome.entitlements = fulfilled.cards.length;
      }
      await alertStaff(order, { store, push });
      break;
    }

    case 'checkout.session.expired':
      outcome = await move(PAYMENT_STATUS.cancelled, { fulfilment_status: FULFILMENT_STATUS.cancelled }, 'checkout abandoned');
      break;

    case 'payment_intent.succeeded': {
      outcome = await move(PAYMENT_STATUS.paid, { stripe_payment_intent_id: object.id }, 'captured');
      const fulfilled = await fulfilOrder(order, { store, signingKey: settings.cardSigningKey, providerCalendar });
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

/**
 * Tell staff an order landed.
 *
 * Never allowed to fail the order: a notification that does not arrive is an
 * inconvenience, an exception thrown out of a webhook handler is a payment Stripe
 * will retry. Unconfigured push records the wording and says it was simulated.
 */
async function alertStaff(order, { store, push }) {
  if (!push) return;
  try {
    const first = order.lines[0];
    const money = `${(order.amount / 100).toFixed(2).replace('.', ',')} €`;
    await notifyStaff({
      store,
      push,
      event: order.fulfilment_status === FULFILMENT_STATUS['awaiting-confirmation'] ? 'order-awaiting' : 'order-new',
      data: {
        orderId: order.id,
        title: first?.variant_title ? `${first.title} — ${first.variant_title}` : (first?.title ?? 'Ordine'),
        room: order.customer?.room || first?.room || '',
        amount: money,
        when: [first?.date, first?.time].filter(Boolean).join(' '),
        express: order.lines.some((line) => line.product_id === 'wine-in-room') && order.amount >= 9000,
        url: '/staff',
      },
    });
  } catch (error) {
    console.warn('[push] staff notification failed:', error.message);
  }
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
