/**
 * The new routes over real HTTP, and the handful of cross-cutting promises.
 *
 * Three of these are the ones somebody would otherwise find out the hard way: the
 * recovery endpoint cannot be used to discover which booking numbers exist, the
 * Staff API is not open, and the Opera Caffè 30% is not quietly attached to a card
 * a guest has to pay for.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../server/app.js';
import { createStore } from '../server/store.js';
import { createMockStripe } from '../server/stripe.js';
import { resetRateLimits } from '../server/rate-limit.js';
import { ingestEvent } from '../server/ingest/index.js';
import { createMemoryMailbox } from '../server/ingest/mailbox.js';
import { buildReservation } from '../server/reservations.js';
import { applyPriceOverrides } from '../commerce/prices.js';
import { applyPartners, PARTNERS, cardPartners, stayPartners, stayBenefits, cardBenefits, guestBenefit } from '../commerce/partners.js';
import { devPartners } from '../commerce/partners.dev.js';
import { DEV_PRICES } from '../commerce/prices.dev.js';
import { PRODUCTS, visibleVariants, publicProduct } from '../commerce/catalog.js';
import { SERVICE_MINUTES, serviceMinutes } from '../commerce/schedule.js';
import { isPurchasable } from '../commerce/index.js';
import { rooms, plannedRooms } from '../data/rooms.js';
import { UI } from '../src/i18n.js';
import { propertyDate, addDays } from '../commerce/time.js';
import { readFile } from 'node:fs/promises';

let server;
let base;
let app;
let db;

before(async () => {
  applyPriceOverrides(DEV_PRICES);
  applyPartners(devPartners());
  db = createStore();
  app = await createApp({
    store: db,
    stripe: createMockStripe(),
    allowPlaceholderPrices: true,
    useDevPrices: false,
    seed: false,
    cardSigningKey: 'consolidation-test',
    staffToken: '',
    mode: 'development',
    publicUrl: 'http://127.0.0.1',
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetRateLimits();
});

after(() => {
  server?.close();
  applyPriceOverrides({});
  applyPartners(PARTNERS);
});

const api = async (path, { method, body, headers } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

const reservation = async (over = {}) => {
  const today = propertyDate();
  const result = await ingestEvent({
    store: db,
    event: {
      kind: 'new', source: 'quovai', booking_reference: `HTTP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      first_name: 'Marta', last_name: 'Venturi', guest_email: 'marta@example.invalid',
      check_in: today, check_out: addDays(today, 3), adults: 2, room: '303',
      message_id: `<${Math.random()}@q>`, ...over,
    },
  });
  return result.reservation;
};

/* ── The personal link over HTTP ─────────────────────────────────────────── */

test('a personal link resolves over the API, with the card lengths that fit', async () => {
  const booked = await reservation();
  const { status, body } = await api(`/api/guide/${booked.guide_token}`);

  assert.equal(status, 200);
  assert.equal(body.first_name, 'Marta');
  assert.equal(body.room, '303');
  assert.equal(body.can_purchase, true);
  // A four-day stay: the 2-day card fits, the 5- and 8-day ones do not.
  assert.deepEqual(body.cardOptions.map((option) => option.variantId), ['2d']);
  assert.ok(body.cardOptions[0].startDates.length >= 1);
  assert.equal('last_name' in body, false);
  assert.equal('guest_email' in body, false);
});

test('an unknown link is a plain 404', async () => {
  const { status, body } = await api(`/api/guide/${'x'.repeat(32)}`);
  assert.equal(status, 404);
  assert.deepEqual(body, { error: 'not-found' });
});

test('/g/<token> serves the guide itself, so the link opens the app', async () => {
  const booked = await reservation();
  const response = await fetch(`${base}/g/${booked.guide_token}`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<title>LunArt — Guest Guide<\/title>/);
});

test('the recovery page is served, and is not the guide', async () => {
  const response = await fetch(`${base}/recover`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Ritrova la tua guida/);
});

/* ── Recovery, and not being an enumeration oracle ───────────────────────── */

test('recovery answers identically whether the booking exists or not', async () => {
  resetRateLimits();
  const booked = await reservation({ booking_reference: 'RECOVER-ME' });

  const right = await api('/api/guide/recover', { body: { lastName: 'Venturi', reference: 'RECOVER-ME' } });
  assert.equal(right.status, 200);
  assert.equal(right.body.link, `http://127.0.0.1/g/${booked.guide_token}`);

  const wrongNumber = await api('/api/guide/recover', { body: { lastName: 'Venturi', reference: 'RECOVER-NOT' } });
  const wrongName = await api('/api/guide/recover', { body: { lastName: 'Nobody', reference: 'RECOVER-ME' } });
  assert.equal(wrongNumber.status, 404);
  assert.equal(wrongName.status, 404);
  assert.deepEqual(wrongNumber.body, wrongName.body, 'the same answer, to the letter');
  assert.deepEqual(wrongNumber.body, { ok: false, reason: 'not-found' });
});

test('recovery is rate limited, so booking numbers cannot be worked through', async () => {
  resetRateLimits();
  const attempts = [];
  for (let i = 0; i < 7; i++) {
    attempts.push(await api('/api/guide/recover', { body: { lastName: 'Venturi', reference: `GUESS-${i}` } }));
  }
  const limited = attempts.filter((attempt) => attempt.status === 429);
  assert.ok(limited.length >= 2, 'the attempts stop being answered');
  assert.equal(limited[0].body.reason, 'too-many-attempts');
  resetRateLimits();
});

test('an incomplete recovery request is refused without a lookup', async () => {
  resetRateLimits();
  const { status, body } = await api('/api/guide/recover', { body: { lastName: 'Venturi' } });
  assert.equal(status, 400);
  assert.equal(body.reason, 'incomplete');
});

/* ── The staff API ───────────────────────────────────────────────────────── */

test('the staff API is behind a token when one is configured', async () => {
  const guarded = await createApp({
    store: db, stripe: createMockStripe(), staffToken: 'secret', mode: 'development', seed: false,
  });
  const listener = guarded.listen(0);
  await new Promise((resolve) => listener.once('listening', resolve));
  const port = listener.address().port;

  const refused = await fetch(`http://127.0.0.1:${port}/api/staff/dashboard`);
  assert.equal(refused.status, 401);

  const allowed = await fetch(`http://127.0.0.1:${port}/api/staff/dashboard`, {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(allowed.status, 200);

  const wrong = await fetch(`http://127.0.0.1:${port}/api/staff/dashboard`, {
    headers: { authorization: 'Bearer nearly' },
  });
  assert.equal(wrong.status, 401);
  listener.close();
});

test('the staff dashboard reports whether push is configured', async () => {
  const { status, body } = await api('/api/staff/dashboard');
  assert.equal(status, 200);
  assert.equal(body.push.configured, false);
  assert.ok(Array.isArray(body.sources));
});

test('a reservation can be created, edited, linked and cancelled from the staff API', async () => {
  const today = propertyDate();
  const created = await api('/api/staff/reservations', {
    body: {
      first_name: 'Diego', last_name: 'Prova', check_in: addDays(today, 4), check_out: addDays(today, 6),
      room: '301', guest_email: 'diego@example.invalid', adults: 2,
    },
  });
  assert.equal(created.status, 201);
  const id = created.body.reservation.id;

  const edited = await api(`/api/staff/reservations/${id}/edit`, { body: { room: '302' } });
  assert.equal(edited.body.reservation.room, '302');

  const link = await api(`/api/staff/reservations/${id}/link`, { body: {} });
  assert.match(link.body.link, /^http:\/\/127\.0\.0\.1\/g\/[A-Za-z0-9_-]+$/);

  const rotated = await api(`/api/staff/reservations/${id}/link`, { body: { rotate: true } });
  assert.notEqual(rotated.body.link, link.body.link);

  const preview = await api(`/api/staff/reservations/${id}/email`, { body: {} });
  assert.ok(preview.body.preview.subject);
  assert.ok(preview.body.preview.text.includes('/g/'));

  const cancelled = await api(`/api/staff/reservations/${id}/cancel`, { body: { reason: 'prova' } });
  assert.equal(cancelled.body.reservation.status, 'cancelled');
});

test('a forwarded notification can be fed in by hand', async () => {
  const raw = await readFile(new URL('./fixtures/quovai-new.eml', import.meta.url), 'utf8');
  const split = raw.indexOf('\n\n');
  const { status, body } = await api('/api/staff/sync/ingest', {
    body: { subject: '🔔 Prenotazione per LunArt', from: 'QuoVai', body: raw.slice(split + 2), messageId: '<by-hand@q>' },
  });
  assert.equal(status, 200);
  assert.equal(body.action, 'created');
  const saved = await db.reservations.findByBooking('quovai', '5312447891');
  assert.equal(saved.room, '303');
});

test('polling and reconciling say they are not configured rather than failing quietly', async () => {
  const poll = await api('/api/staff/sync/poll', { body: {} });
  assert.equal(poll.status, 503);
  assert.equal(poll.body.reason, 'no-mailbox-configured');

  const reconcile = await api('/api/staff/sync/reconcile', { body: {} });
  assert.equal(reconcile.status, 503);
  assert.equal(reconcile.body.reason, 'no-feeds-configured');
});

test('the QuoVai webhook route exists and refuses until it is configured', async () => {
  const { status, body } = await api('/api/quovai/webhook', { body: { kind: 'new', booking_reference: 'X' } });
  assert.equal(status, 503);
  assert.equal(body.error, 'source-not-configured');
  assert.ok(body.requires.includes('QUOVAI_WEBHOOK_SECRET'));
});

test('the staff app and its manifest are served', async () => {
  const page = await fetch(`${base}/staff`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /LunArt Staff/);

  const manifest = await fetch(`${base}/staff/manifest.webmanifest`);
  assert.equal(manifest.status, 200);
  const parsed = await manifest.json();
  assert.equal(parsed.scope, '/staff');
  assert.equal(parsed.display, 'standalone');
});

/* ── What the stay includes, and what the card adds ──────────────────────── */

test('the Opera Caffè benefit comes with the stay, not with the card', async () => {
  const opera = PARTNERS.find((partner) => partner.partner_id === 'opera-caffe');
  assert.equal(opera.inclusion, 'stay');
  assert.equal(opera.applies_to, 'all-guests', 'everyone on the reservation, not two people');

  assert.ok(stayPartners().some((partner) => partner.partner_id === 'opera-caffe'));
  assert.equal(cardPartners().some((partner) => partner.partner_id === 'opera-caffe'), false,
    'buying a card must not be the way to get something that is already included');

  const { body } = await api('/api/catalog');
  assert.ok(body.stayBenefits.some((benefit) => benefit.partner_id === 'opera-caffe'));
  assert.equal(body.cardBenefits.some((benefit) => benefit.partner_id === 'opera-caffe'), false);
  assert.equal(guestBenefit('opera-caffe').applies_to, 'all-guests');
});

test('a card issued to a guest lists only what the card itself gets them', async () => {
  const benefits = cardBenefits();
  assert.ok(benefits.length >= 1, 'the preview has one example partner');
  assert.equal(benefits.some((benefit) => benefit.partner_id === 'opera-caffe'), false);
  assert.ok(benefits.every((benefit) => benefit.inclusion === 'card'));
});

test('with no card partner at all, the card is not sold', () => {
  applyPartners(PARTNERS);   // production: only Opera, which is a stay benefit
  assert.equal(cardPartners().length, 0);
  const card = PRODUCTS.find((product) => product.id === 'privilege-card');
  assert.equal(isPurchasable(card, { allowPlaceholders: true }), false,
    'a card with nothing behind it is not a product');
  applyPartners(devPartners());
  assert.equal(isPurchasable(card, { allowPlaceholders: true }), true, 'and it comes back by itself');
});

/* ── The hair service, as the guest sees it ──────────────────────────────── */

test('the ceremony styling is in the model and not in the catalogue', async () => {
  const product = PRODUCTS.find((entry) => entry.id === 'hair-service');
  assert.ok(product.variants.some((variant) => variant.id === 'ceremony'), 'modelled');
  assert.equal(visibleVariants(product).some((variant) => variant.id === 'ceremony'), false, 'not shown');
  assert.equal(publicProduct(product).variants.some((variant) => variant.id === 'ceremony'), false);

  const { body } = await api('/api/catalog');
  const published = body.products.find((entry) => entry.id === 'hair-service');
  assert.equal(published.variants.length, 6);
  assert.equal(published.variants.some((variant) => variant.id === 'ceremony'), false);
  // Colour is not a thing a guest can choose. It is named once, in the terms, to
  // say it is not available — which is the opposite of offering it.
  for (const variant of published.variants) {
    assert.equal(/colore|colour|colpi di sole|highlight/i.test(JSON.stringify(variant)), false, variant.id);
  }
  assert.match(published.terms.it, /Colore e colpi di sole non sono al momento disponibili/);
  assert.match(published.terms.en, /Colour and highlights are not available/);
});

test('the internal durations exist for the calendar and are never shown', async () => {
  assert.equal(SERVICE_MINUTES['men-beard'], 30);
  assert.equal(SERVICE_MINUTES['men-cut'], 60);
  assert.equal(SERVICE_MINUTES['men-cut-beard'], 60);
  assert.equal(SERVICE_MINUTES['women-blowdry'], 90);
  assert.equal(SERVICE_MINUTES['women-cut-blow'], 90);
  assert.equal(SERVICE_MINUTES['women-evening'], 90);
  assert.equal(serviceMinutes('nonsense'), 90, 'an unknown service blocks the longest slot');

  // Nothing in the published product carries a duration a UI could render.
  const { body } = await api('/api/catalog');
  const published = body.products.find((entry) => entry.id === 'hair-service');
  for (const variant of published.variants) {
    assert.equal('minutes' in (variant.meta ?? {}), false, `${variant.id} must not publish a duration`);
  }

  // And the product form never reaches for a service duration to print. The only
  // minutes a guest is ever shown are a wine order's notice period, which is a
  // deadline rather than how long somebody will be in the room.
  const sheet = await readFile(new URL('../src/commerce/ui/product-sheet.js', import.meta.url), 'utf8');
  assert.equal(sheet.includes('meta.minutes'), false, 'the form must not render a duration');
  assert.equal(sheet.includes('serviceMinutes'), false, 'nor import one');
});

test('no wash service is promised, and the terms say so', () => {
  const product = PRODUCTS.find((entry) => entry.id === 'hair-service');
  assert.match(product.terms.it, /Non è previsto il lavaggio/);
  assert.match(product.terms.en, /no wash service/i);
  assert.match(product.description.it, /capelli già lavati/);
});

/* ── Rooms and language ──────────────────────────────────────────────────── */

test('the rooms are the current mapping, and the future is not published', () => {
  assert.deepEqual(
    rooms.map((room) => [room.number, room.category.it]),
    [['301', 'Standard'], ['302', 'Queen'], ['303', 'Superior'], ['304', 'Queen'], ['305', 'Superior']],
  );
  assert.equal(rooms.some((room) => room.number === '306'), false, 'the sixth room is not published');
  assert.equal(plannedRooms[0].number, '306');
  assert.equal(plannedRooms[0].category, null, 'and its category is not claimed');

  // The triples, as they actually are.
  assert.match(rooms.find((room) => room.number === '303').summary.it, /tripla/);
  assert.match(rooms.find((room) => room.number === '305').summary.it, /tripla/);
  assert.match(rooms.find((room) => room.number === '304').summary.it, /non è una tripla standard/);
});

test('every interface string exists in both languages', () => {
  const it = Object.keys(UI.it);
  const en = Object.keys(UI.en);
  assert.deepEqual(it.filter((key) => !en.includes(key)), []);
  assert.deepEqual(en.filter((key) => !it.includes(key)), []);
  for (const key of it) {
    assert.equal(typeof UI.it[key], 'string', key);
    assert.ok(UI.it[key].trim().length > 0, key);
    assert.ok(UI.en[key].trim().length > 0, key);
  }
});

test('a placeholder in one language exists in the other', () => {
  /**
   * The failure this catches: `'Ti rimborsiamo {amount}'` translated as
   * `'We will refund it'`. Both are non-empty strings, both pass every other check,
   * and one of them tells an English-speaking guest nothing about how much.
   */
  const placeholders = (value) => [...String(value).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of Object.keys(UI.it)) {
    assert.deepEqual(placeholders(UI.it[key]), placeholders(UI.en[key]), key);
  }
});

test('every product renders in both languages, coming-soon ones included', async () => {
  const { body } = await api('/api/catalog');
  for (const product of body.products) {
    assert.ok(product.title.it && product.title.en, product.id);
    if (product.comingSoon) continue;
    assert.ok(product.summary.it && product.summary.en, product.id);
    assert.ok(product.terms.it && product.terms.en, product.id);
    for (const variant of product.variants ?? []) {
      assert.ok(variant.title.it && variant.title.en, `${product.id}:${variant.id}`);
    }
  }
});

/* ── Demonstration mode ──────────────────────────────────────────────────── */

/**
 * The preview has to be a real server and an impossible accident.
 *
 * These check the second half: with `LUNART_PREVIEW` on, a credential in the
 * environment is not merely unused — it is never read. The whole value of a
 * shareable demo is that nobody can charge a card or email a guest from it.
 */

const withEnv = async (vars, run) => {
  const before = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  try {
    // The config module reads the environment once, at import, so it is imported
    // fresh here rather than reused.
    const { config, configWarnings } = await import(`../server/config.js?preview=${Math.random()}`);
    return await run({ config, configWarnings });
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test('preview mode refuses to read a credential, however it got there', async () => {
  await withEnv({
    LUNART_PREVIEW: '1',
    STRIPE_SECRET_KEY: 'sk_live_this_would_take_real_money',
    STRIPE_WEBHOOK_SECRET: 'whsec_real',
    MAIL_PROVIDER: 'gmail',
    GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'token',
    VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:x@y.z',
    GOOGLE_CALENDAR_ID: 'cal', GOOGLE_SERVICE_ACCOUNT_EMAIL: 'sa@x', GOOGLE_SERVICE_ACCOUNT_KEY: 'key',
    QUOVAI_ICAL_FEEDS: '303:https://feed.example/303.ics',
    QUOVAI_WEBHOOK_SECRET: 'shhh',
  }, ({ config }) => {
    assert.equal(config.preview, true);
    assert.equal(config.stripe.secretKey, '', 'no payment key is read');
    assert.equal(config.stripe.enabled, false);
    assert.equal(config.mailProvider, '', 'nothing can send mail');
    assert.equal(config.gmailRefreshToken, '', 'no mailbox can be read');
    assert.equal(config.vapidPrivateKey, '', 'nothing can be pushed');
    assert.equal(config.googleServiceAccountKey, '', 'no calendar can be written');
    assert.deepEqual(config.icalFeeds, [], 'no feed is fetched');
    assert.equal(config.quovaiWebhookSecret, '');
    assert.equal(config.mailboxSource, 'memory', 'the only mailbox is the in-process one');
    assert.equal(config.useDevPrices, true, 'and the demo data is on, so everything is walkable');
  });
});

test('outside preview mode the same environment is read normally', async () => {
  await withEnv({
    LUNART_PREVIEW: '',
    STRIPE_SECRET_KEY: 'sk_test_ordinary',
    MAIL_PROVIDER: 'gmail',
    GMAIL_REFRESH_TOKEN: 'token',
  }, ({ config }) => {
    assert.equal(config.preview, false);
    assert.equal(config.stripe.secretKey, 'sk_test_ordinary');
    assert.equal(config.mailProvider, 'gmail');
    assert.equal(config.gmailRefreshToken, 'token');
  });
});

test('a preview says so, and says it loudly if the Staff app is left open', async () => {
  await withEnv({ LUNART_PREVIEW: '1', STAFF_TOKEN: '' }, ({ configWarnings }) => {
    const warnings = configWarnings();
    assert.match(warnings[0], /demonstration mode/i);
    assert.ok(warnings.some((warning) => /STAFF_TOKEN/.test(warning)), 'and asks for a token');
  });

  await withEnv({ LUNART_PREVIEW: '1', STAFF_TOKEN: 'a-long-generated-value' }, ({ configWarnings }) => {
    const warnings = configWarnings();
    assert.equal(warnings.length, 1, 'with a token, only the demonstration notice remains');
  });
});

test('the host tells the preview its own address', async () => {
  await withEnv({ LUNART_PREVIEW: '1', PUBLIC_URL: '', RENDER_EXTERNAL_URL: 'https://lunart-preview.onrender.com/' },
    ({ config }) => {
      assert.equal(config.publicUrl, 'https://lunart-preview.onrender.com', 'trailing slash trimmed');
    });

  await withEnv({ PUBLIC_URL: 'https://chosen.example', RENDER_EXTERNAL_URL: 'https://ignored.example' },
    ({ config }) => {
      assert.equal(config.publicUrl, 'https://chosen.example', 'an explicit value still wins');
    });
});

test('the preview front door lists the demo links, and only exists in a preview', async () => {
  const quiet = await fetch(`${base}/preview`);
  assert.equal(quiet.status, 404, 'an ordinary server has no such page');

  const db2 = createStore();
  const previewApp = await createApp({
    store: db2,
    stripe: createMockStripe(),
    preview: true,
    useDevPrices: true,
    allowPlaceholderPrices: true,
    staffToken: 'preview-token',
    mode: 'development',
    publicUrl: 'https://lunart-preview.onrender.com',
  });
  const listener = previewApp.listen(0);
  await new Promise((resolve) => listener.once('listening', resolve));
  const previewBase = `http://127.0.0.1:${listener.address().port}`;

  const page = await (await fetch(`${previewBase}/preview`)).text();
  assert.match(page, /ANTEPRIMA|Anteprima/);
  assert.match(page, /\/g\/[A-Za-z0-9_-]{20,}/, 'a personal link is listed');
  assert.match(page, /\/staff/);
  assert.match(page, /\/partner\/opera-caffe/);
  assert.match(page, /nessun pagamento reale|Nessuna carta/i, 'and what is switched off');

  // Every page a guest, a member of staff or a venue opens carries the flag.
  for (const path of ['/', '/staff', '/recover', '/validate-card', '/partner/opera-caffe']) {
    const html = await (await fetch(`${previewBase}${path}`)).text();
    assert.match(html, /class="preview-flag"/, `${path} is marked`);
  }

  // Health is honest about why nothing is configured: a preview's credentials are
  // refused, not missing, and an operator should not go looking for them.
  const health = await (await fetch(`${previewBase}/api/health`)).json();
  assert.equal(health.preview, true);
  assert.equal(health.payments, 'mock');
  for (const [name, integration] of Object.entries(health.integrations)) {
    assert.equal(integration.state, 'disabled-in-preview', `${name} is off by design`);
    assert.match(integration.note, /LUNART_PREVIEW/);
  }

  // The seeded reservations are reachable through their own links.
  const [reservation] = await db2.reservations.list({ limit: 1 });
  const guide = await fetch(`${previewBase}/g/${reservation.guide_token}`);
  assert.equal(guide.status, 200);

  // And the Staff API is still behind the token.
  assert.equal((await fetch(`${previewBase}/api/staff/dashboard`)).status, 401);
  assert.equal((await fetch(`${previewBase}/api/staff/dashboard`, {
    headers: { authorization: 'Bearer preview-token' },
  })).status, 200);

  listener.close();
});

test('nothing but a preview ever carries the flag', async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.equal(html.includes('preview-flag'), false);
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.preview, false);
  // And an ordinary server never explains itself away as a demonstration.
  for (const integration of Object.values(health.integrations)) {
    assert.notEqual(integration.state, 'disabled-in-preview');
  }
});

/* ── The parser repair, over the real HTTP surface ─────────────────────────
   The repair is the one operation in the system that deliberately looks past the
   message de-duplication, so these check the two things that makes dangerous:
   that it is behind the staff token like everything else, and that running it
   from the outside does exactly what running it from the inside does — correct
   what is there, create nothing, send nothing. */

test('the repair endpoint is behind the staff token', async () => {
  const app = await createApp({
    store: createStore(),
    stripe: createMockStripe(),
    staffToken: 'repair-token',
    mode: 'production',
    mailbox: createMemoryMailbox([]),
  });
  const listener = app.listen(0);
  await new Promise((resolve) => listener.once('listening', resolve));
  const base = `http://127.0.0.1:${listener.address().port}`;

  const refused = await fetch(`${base}/api/staff/sync/repair`, { method: 'POST' });
  assert.equal(refused.status, 401);

  const allowed = await fetch(`${base}/api/staff/sync/repair`, {
    method: 'POST', headers: { authorization: 'Bearer repair-token' },
  });
  assert.equal(allowed.status, 200);
  listener.close();
});

test('the repair corrects the live rows through the API, and only those', async () => {
  const { REAL_RESERVATIONS } = await import('./fixtures/quovai.js');
  const db = createStore();

  // The staging store as the old parser left it: dates and links, no names, no rooms.
  for (const row of [
    { ref: '6230618454MODIFIED', from: '2026-10-02', to: '2026-10-03' },
    { ref: '6703524869NEW', from: '2026-11-07', to: '2026-11-08' },
  ]) {
    await db.reservations.create(buildReservation({
      source: 'quovai', booking_reference: row.ref, check_in: row.from, check_out: row.to, adults: 2,
    }));
  }

  const app = await createApp({
    store: db,
    stripe: createMockStripe(),
    staffToken: 'repair-token',
    mode: 'production',
    mailbox: createMemoryMailbox([...REAL_RESERVATIONS]),
  });
  const listener = app.listen(0);
  await new Promise((resolve) => listener.once('listening', resolve));
  const base = `http://127.0.0.1:${listener.address().port}`;
  const repair = () => fetch(`${base}/api/staff/sync/repair`, {
    method: 'POST', headers: { authorization: 'Bearer repair-token' },
  }).then((r) => r.json());

  const first = await repair();
  assert.equal(first.ok, true);
  assert.equal(first.matched, 2);
  assert.equal(first.repaired, 2);
  assert.equal(first.unmatched, 2, 'the two stays we never held are left alone');

  const rows = await db.reservations.list();
  assert.equal(rows.length, 2, 'repair created nothing');
  assert.deepEqual(
    rows.map((r) => `${r.first_name} ${r.last_name} · ${r.room}`).sort(),
    ['Irene Cappellini · 302', 'Martin Markert · 304'],
  );
  assert.equal((await db.deliveries.list()).length, 0, 'and scheduled no email');

  // Idempotent: the mailbox is refilled, the answer is "nothing to do".
  const second = await repair();
  assert.equal(second.repaired, 0);
  assert.equal(second.unchanged, 0, 'the memory mailbox hands each message over once');
  listener.close();
});
