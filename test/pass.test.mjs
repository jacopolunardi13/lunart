/**
 * The LunArt Pass, the purchases that belong to a stay, and the three offers.
 *
 * Three things are being protected here, and they are not the same kind of thing.
 *
 * The Pass is a promise about paper: LunArt hands out breakfast tokens and Opera
 * Caffè collects them, and the Pass is the half of that check which knows what day
 * it is. If a Pass says "attiva" after the guest has gone home, a voucher kept
 * from August is good forever. So its states are tested at the hour boundaries,
 * not in the middle of a stay where every implementation would agree.
 *
 * The purchases are a promise about devices: a guest who ordered on the laptop and
 * opens the link on their phone has to find the order. That means the server
 * answers, not the browser — and the moment the server answers, the question
 * becomes whose orders it will hand over, which is the isolation test.
 *
 * The ranking is a promise about short stays: most LunArt bookings are a night or
 * two, so anything that hides a product behind a phase hides most of the catalogue
 * most of the time. The tests check that the order changes and that the set never
 * shrinks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp, handleStripeEvent } from '../server/app.js';
import { createStore } from '../server/store.js';
import { createMockStripe } from '../server/stripe.js';
import { buildReservation, RESERVATION_STATUS } from '../server/reservations.js';
import { passFor, passState, passForReservation, PASS_TIER, PASS_STATE } from '../server/pass.js';
import { buildCard } from '../server/card.js';
import { featuredProducts, momentOf, PRIORITY, FEATURED } from '../commerce/ranking.js';
import { PRODUCTS } from '../commerce/catalog.js';
import { isPurchasable } from '../commerce/index.js';
import { applyPartners, PARTNERS, cardPartners, stayBenefits, cardBenefits } from '../commerce/partners.js';
import { applyPriceOverrides } from '../commerce/prices.js';
import { DEV_PRICES } from '../commerce/prices.dev.js';

/** Far enough ahead that a wine order's lead time is met whenever this runs. */
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const WINE_DAY = inDays(31);

const stay = (overrides = {}) => buildReservation({
  source: 'quovai',
  booking_reference: `T-${Math.random().toString(36).slice(2, 8)}`,
  first_name: 'Giulia',
  last_name: 'Rossi',
  room: '303',
  check_in: '2026-11-10',
  check_out: '2026-11-13',
  adults: 2,
  ...overrides,
});

/* ── The Pass comes with the stay ───────────────────────────────────────── */

test('every reservation has a Pass, and nobody bought it', () => {
  const pass = passFor(stay());
  assert.ok(pass, 'a reservation is enough');
  assert.equal(pass.tier, PASS_TIER.pass);
  assert.equal(pass.holder, 'Giulia');
  assert.equal(pass.room, '303');
  assert.equal(pass.check_in, '2026-11-10');
  assert.equal(pass.check_out, '2026-11-13');
  assert.equal(pass.nights, 3);
  assert.ok(pass.reference, 'a reference a guest can read down the phone');
});

test('the Pass shows the first name and never the surname', () => {
  // The personal link is built so a surname never travels in a URL or sits on a
  // screen in a breakfast room. A card is not a reason to undo that.
  const pass = passFor(stay({ first_name: 'Giulia', last_name: 'Rossi' }));
  assert.equal(pass.holder, 'Giulia');
  assert.ok(!JSON.stringify(pass).includes('Rossi'));
});

test('a Pass exists with nothing bought at all', async () => {
  const store = createStore();
  const reservation = await store.reservations.create(stay());
  const pass = await passForReservation({ store, reservation });
  assert.ok(pass);
  assert.equal(pass.tier, PASS_TIER.pass);
  assert.deepEqual(pass.privileges, [], 'nothing is unlocked, and nothing pretends to be');
  assert.equal(pass.card, null);
});

/* ── What the Pass is worth, and when ───────────────────────────────────── */

test('the Pass runs from the first night to the end of the last day', () => {
  const reservation = stay({ check_in: '2026-11-10', check_out: '2026-11-13' });
  const at = (iso) => passState(reservation, new Date(iso));

  // Europe/Rome in November is UTC+1.
  assert.equal(at('2026-11-09T22:59:00Z'), PASS_STATE.notStarted, 'the night before, still not started');
  assert.equal(at('2026-11-09T23:00:00Z'), PASS_STATE.active, 'midnight in Florence on the arrival day');
  assert.equal(at('2026-11-11T12:00:00Z'), PASS_STATE.active);
  // Breakfast on the morning you leave is covered.
  assert.equal(at('2026-11-13T06:00:00Z'), PASS_STATE.active, 'the morning of checkout still counts');
  assert.equal(at('2026-11-13T22:59:00Z'), PASS_STATE.active, 'to the end of the checkout day');
  assert.equal(at('2026-11-13T23:00:00Z'), PASS_STATE.expired, 'and not a minute longer');
  assert.equal(at('2027-01-01T12:00:00Z'), PASS_STATE.expired);
});

/**
 * The whole operational point.
 *
 * The paper voucher is not going away and is not being counted. What stops one
 * from being used next spring is that the Pass behind it has expired.
 */
test('a voucher kept after the stay is no longer backed by a live Pass', () => {
  const reservation = stay({ check_in: '2026-11-10', check_out: '2026-11-13' });
  const duringBreakfast = new Date('2026-11-12T07:30:00Z');
  const nextSpring = new Date('2027-04-02T07:30:00Z');

  assert.equal(passFor(reservation, { now: duringBreakfast }).live, true);
  assert.equal(passFor(reservation, { now: nextSpring }).live, false);
  assert.equal(passFor(reservation, { now: nextSpring }).state, PASS_STATE.expired);
});

test('a cancelled reservation has a Pass that says so', () => {
  const reservation = stay({ status: RESERVATION_STATUS.cancelled });
  const pass = passFor(reservation, { now: new Date('2026-11-11T12:00:00Z') });
  assert.equal(pass.state, PASS_STATE.cancelled);
  assert.equal(pass.live, false, 'a cancelled stay backs nothing');
});

/* ── Privilege is the same Pass, unlocked ───────────────────────────────── */

test('buying the upgrade turns the Pass into Privilege — it does not add a card', async () => {
  const store = createStore();
  const reservation = await store.reservations.create(stay());

  const before = await passForReservation({ store, reservation });
  assert.equal(before.tier, PASS_TIER.pass);

  await store.cards.create(buildCard({
    orderId: 'order_1',
    reservationId: reservation.id,
    holderName: 'Giulia Rossi',
    startDate: '2026-11-10',
    days: 3,
    variantId: 'card-3',
    signingKey: 'k'.repeat(32),
  }));

  const after = await passForReservation({ store, reservation });
  assert.equal(after.tier, PASS_TIER.privilege, 'the same Pass, upgraded');
  assert.ok(after.card?.access_token, 'and it can open its QR screen');
  assert.equal(after.room, before.room, 'still the same stay underneath');
  assert.equal(after.check_in, before.check_in);
});

test('a card bound to another stay does not upgrade this one', async () => {
  const store = createStore();
  const mine = await store.reservations.create(stay({ first_name: 'Giulia' }));
  const theirs = await store.reservations.create(stay({ first_name: 'Marco' }));

  await store.cards.create(buildCard({
    orderId: 'order_2',
    reservationId: theirs.id,
    holderName: 'Marco',
    startDate: '2026-11-10',
    days: 3,
    variantId: 'card-3',
    signingKey: 'k'.repeat(32),
  }));

  assert.equal((await passForReservation({ store, reservation: mine })).tier, PASS_TIER.pass);
  assert.equal((await passForReservation({ store, reservation: theirs })).tier, PASS_TIER.privilege);
});

test('a revoked card does not keep a Pass looking Privilege', async () => {
  const store = createStore();
  const reservation = await store.reservations.create(stay());
  const card = await store.cards.create({
    ...buildCard({
      orderId: 'order_3',
      reservationId: reservation.id,
      holderName: 'Giulia',
      startDate: '2026-11-10',
      days: 3,
      variantId: 'card-3',
      signingKey: 'k'.repeat(32),
    }),
    status: 'revoked',
  });
  assert.ok(card.id);
  assert.equal((await passForReservation({ store, reservation })).tier, PASS_TIER.pass);
});

/* ── What is included is not what is for sale ───────────────────────────── */

/**
 * The line that must never move.
 *
 * Opera Caffè's 30% comes with the stay. Listing it as something the Privilege
 * upgrade unlocks would be selling a guest something they already have, which is
 * the fastest way to stop being believed.
 */
test('the Opera Caffè benefit is part of the stay and never a Privilege benefit', () => {
  const included = stayBenefits().map((b) => b.partner_id);
  const privilege = cardBenefits().map((b) => b.partner_id);

  assert.ok(included.includes('opera-caffe'), 'it comes with the stay');
  assert.ok(!privilege.includes('opera-caffe'), 'and is never sold as a card benefit');

  const pass = passFor(stay());
  assert.ok(pass.included.some((b) => b.partner_id === 'opera-caffe'));
  assert.ok(!pass.privileges.some((b) => b.partner_id === 'opera-caffe'));
});

test('an upgraded Pass still lists Opera under what the stay includes', async () => {
  const store = createStore();
  const reservation = await store.reservations.create(stay());
  await store.cards.create(buildCard({
    orderId: 'order_4',
    reservationId: reservation.id,
    holderName: 'Giulia',
    startDate: '2026-11-10',
    days: 3,
    variantId: 'card-3',
    signingKey: 'k'.repeat(32),
  }));
  const pass = await passForReservation({ store, reservation });
  assert.ok(pass.included.some((b) => b.partner_id === 'opera-caffe'));
  assert.ok(!pass.privileges.some((b) => b.partner_id === 'opera-caffe'));
});

/**
 * Privilege is not on sale until there is something to sell.
 *
 * An upgrade whose only benefit is one the stay already gives is not a product, and
 * the catalogue refuses to sell it while no partner reserves anything for it. That
 * rail is still live — it reads the register on every call — it is simply satisfied
 * now that Le Firme and Blue Velvet are in it.
 */
test('Privilege cannot be sold while no partner offers a card benefit', () => {
  const saved = PARTNERS.map((p) => ({ ...p }));
  const card = PRODUCTS.find((p) => p.id === 'privilege-card');
  try {
    applyPartners(saved.map((p) => ({ ...p, eligibility: { passState: 'active', entitlementsAll: [] } })));
    assert.equal(cardPartners().length, 0, 'nobody reserves anything for the upgrade');
    assert.equal(isPurchasable(card, { allowPlaceholders: true }), false, 'so it is not for sale');
  } finally {
    applyPartners(saved);
  }
  assert.equal(isPurchasable(card, { allowPlaceholders: true }), true,
    'and with the real partners back, it is');
});

/**
 * There is no longer a demo partner, and that is the point.
 *
 * A fake venue existed only because production had none; it made the flow walkable
 * and nothing else. Real partners retired it, and a demo standing next to Le Firme
 * would now be a way to mislead whoever is testing. The register is the same in
 * every environment.
 */
test('no partner in the register is a stand-in', () => {
  for (const partner of cardPartners()) {
    assert.doesNotMatch(
      `${partner.partner_id} ${partner.name}`.toLowerCase(),
      /demo|esempio|example|placeholder|fittizio/,
      `"${partner.partner_id}" reads as a stand-in`,
    );
  }
});

/* ── Purchases belong to the stay, not to the browser ───────────────────── */

async function serverWith(store, t = null) {
  const app = await createApp({
    store,
    stripe: createMockStripe(),
    staffToken: 'pass-token',
    mode: 'production',
    useDevPrices: false,
    allowPlaceholderPrices: true,
  });
  const listener = app.listen(0);
  await new Promise((resolve) => listener.once('listening', resolve));
  t?.after(() => listener.close());
  return { listener, base: `http://127.0.0.1:${listener.address().port}` };
}

test('a guest finds their orders through their link, from a browser that has never seen them', async (t) => {
  const store = createStore();
  const reservation = await store.reservations.create(stay());
  await store.orders.create({
    object: 'order',
    access_token: 'order-token-aaaaaaaaaaaaaaaaaaaa',
    reservation_id: reservation.id,
    status: 'paid',
    amount: 8900,
    currency: 'EUR',
    lines: [{ title: 'Vino in camera', quantity: 1, date: '2026-11-11', time: '19:00' }],
    entitlements: [],
    events: [],
  });

  const { listener, base } = await serverWith(store, t);
  // No localStorage, no cookies, nothing remembered: just the link.
  const context = await (await fetch(`${base}/api/guide/${reservation.guide_token}`)).json();

  assert.equal(context.purchases.length, 1);
  assert.equal(context.purchases[0].status, 'paid');
  assert.equal(context.purchases[0].amount, 8900);
  assert.equal(context.purchases[0].lines[0].title, 'Vino in camera');
  assert.ok(context.purchases[0].access_token, 'with the token needed to open it');
  assert.ok(context.purchases[0].reference, 'and a reference a guest can quote');
});

test('one guest never sees another guest’s purchases', async (t) => {
  const store = createStore();
  const mine = await store.reservations.create(stay({ first_name: 'Giulia' }));
  const theirs = await store.reservations.create(stay({ first_name: 'Marco' }));

  for (const [reservation, title] of [[mine, 'Il mio vino'], [theirs, 'Il loro brunch']]) {
    await store.orders.create({
      object: 'order',
      access_token: `token-${reservation.id}`,
      reservation_id: reservation.id,
      status: 'paid',
      amount: 1000,
      currency: 'EUR',
      lines: [{ title, quantity: 1 }],
      entitlements: [],
      events: [],
    });
  }

  const { listener, base } = await serverWith(store, t);
  const context = await (await fetch(`${base}/api/guide/${mine.guide_token}`)).json();

  assert.equal(context.purchases.length, 1);
  assert.equal(context.purchases[0].lines[0].title, 'Il mio vino');
  assert.ok(!JSON.stringify(context.purchases).includes('brunch'), 'and nothing of theirs leaks');
});

test('an order bought from the public guide belongs to nobody’s stay', async (t) => {
  const store = createStore();
  const reservation = await store.reservations.create(stay());
  await store.orders.create({
    object: 'order',
    access_token: 'anonymous-order-token-aaaaaaaa',
    reservation_id: null,
    status: 'paid',
    amount: 4900,
    currency: 'EUR',
    lines: [{ title: 'Brunch', quantity: 1 }],
    entitlements: [],
    events: [],
  });

  const { listener, base } = await serverWith(store, t);
  const context = await (await fetch(`${base}/api/guide/${reservation.guide_token}`)).json();
  assert.deepEqual(context.purchases, [], 'a sale with no stay attaches to no stay');
});

/* ── Three offers, ranked, and nothing hidden ───────────────────────────── */

test('the moment is read from the dates, not guessed', () => {
  assert.equal(momentOf({ phase: 'before' }), 'before');
  assert.equal(momentOf({ phase: 'staying', checkIn: '2026-11-10', today: '2026-11-10' }), 'arrival');
  assert.equal(momentOf({ phase: 'staying', checkIn: '2026-11-10', today: '2026-11-11' }), 'staying');
  assert.equal(momentOf({ phase: 'leaving', checkIn: '2026-11-10', today: '2026-11-13' }), 'leaving');
  assert.equal(momentOf({}), 'before', 'the public guide is nobody who has arrived');
});

test('each moment leads with what that moment is for', () => {
  const lead = (moment) => featuredProducts({ moment })[0]?.id;
  assert.equal(lead('before'), 'transfer-airport', 'getting here is the pre-arrival question');
  assert.equal(lead('arrival'), 'wine-in-room', 'tonight, and nothing to plan');
  assert.equal(lead('staying'), 'wine-in-room');
  assert.equal(lead('leaving'), 'luggage-transfer', 'nothing else is happening today');
});

test('the home offers three, and only things that can be bought', () => {
  for (const moment of Object.keys(PRIORITY)) {
    const featured = featuredProducts({ moment });
    assert.ok(featured.length <= FEATURED, `${moment} offers at most ${FEATURED}`);
    for (const product of featured) {
      assert.equal(product.comingSoon ?? false, false, `${product.id} is not on sale`);
      assert.notEqual(product.status, 'coming-soon');
      assert.ok(
        isPurchasable(product, { allowPlaceholders: true }) || product.purchaseMode === 'request-only',
        `${product.id} would open a sheet that cannot sell anything`,
      );
    }
  }
});

/**
 * The reason the ranking is a ranking and not a filter.
 *
 * Most LunArt stays are one or two nights. A design that hid products by phase
 * would, on a one-night booking, hide most of the catalogue for most of the time
 * the guest is holding the phone.
 */
test('a one-night stay loses access to nothing', () => {
  const sellable = PRODUCTS.filter((p) => p.active && isPurchasable(p, { allowPlaceholders: true }));
  const reachable = new Set(sellable.map((p) => p.id));

  for (const moment of Object.keys(PRIORITY)) {
    for (const product of featuredProducts({ moment })) {
      assert.ok(reachable.has(product.id), 'everything featured is in the catalogue');
    }
  }
  // The shop lists the catalogue regardless of moment: the ranking reorders the
  // three on the home and takes nothing out of the shop.
  assert.ok(sellable.length > FEATURED, 'there is more than the home shows');
});

test('the order changes with the moment, and the set does not shrink', () => {
  const before = featuredProducts({ moment: 'before' }).map((p) => p.id);
  const staying = featuredProducts({ moment: 'staying' }).map((p) => p.id);
  assert.notDeepEqual(before, staying, 'the moment is doing something');
  assert.equal(before.length, staying.length, 'and it is reordering, not removing');
});

/* ── The money path ─────────────────────────────────────────────────────── */

/**
 * The bug a guest actually hit: paid at Stripe, came back, and the order still
 * said "waiting for payment" while the basket still held the wine.
 */
test('an order left pending is reconciled when the guest comes back to look at it', async (t) => {
  const store = createStore();
  const stripe = createMockStripe();
  applyPriceOverrides(DEV_PRICES);
  const reservation = await store.reservations.create(stay({ check_in: inDays(30), check_out: inDays(33) }));

  const app = await createApp({
    store, stripe, staffToken: 't', mode: 'production', allowPlaceholderPrices: true,
  });
  const listener = app.listen(0);
  await new Promise((resolve) => listener.once('listening', resolve));
  t.after(() => listener.close());
  const base = `http://127.0.0.1:${listener.address().port}`;

  const checkout = await (await fetch(`${base}/api/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      guideToken: reservation.guide_token,
      lang: 'it',
      customer: { name: 'Giulia Rossi', email: 'giulia@example.invalid' },
      lines: [{ productId: 'wine-in-room', variantId: 'chianti-barrique', quantity: 1, date: WINE_DAY, slotId: 'w-1900', room: '303' }],
    }),
  })).json();

  assert.ok(checkout.accessToken, `checkout refused: ${JSON.stringify(checkout)}`);

  // The guest pays. Stripe knows; no webhook has reached us.
  await stripe.completeSession(checkout.sessionId ?? (await store.orders.findByAccessToken(checkout.accessToken)).stripe_session_id);

  const order = await (await fetch(`${base}/api/orders/${checkout.accessToken}`)).json();
  assert.equal(order.status, 'paid', 'looking at it is enough to settle it');

  // And the webhook, arriving late with its own event id, changes nothing.
  const session = await stripe.retrieveSession(order.stripe_session_id ?? (await store.orders.findByAccessToken(checkout.accessToken)).stripe_session_id);
  const again = await handleStripeEvent(
    { id: 'evt_late_webhook', type: 'checkout.session.completed', data: { object: session } },
    { store, stripe, settings: { cardSigningKey: 'k'.repeat(32) } },
  );
  assert.ok(again.repeated || again.skipped || again.status === 'paid');

  const settled = await store.orders.findByAccessToken(checkout.accessToken);
  assert.equal(settled.status, 'paid');
  const paidEvents = settled.events.filter((e) => e.type === 'status:paid');
  assert.equal(paidEvents.length, 1, 'paid once in the record, however many times it was told');
});

test('a purchase made on a personal link is filed against that stay', async (t) => {
  const store = createStore();
  const stripe = createMockStripe();
  applyPriceOverrides(DEV_PRICES);
  const reservation = await store.reservations.create(stay({ check_in: inDays(30), check_out: inDays(33) }));

  const app = await createApp({ store, stripe, staffToken: 't', mode: 'production', allowPlaceholderPrices: true });
  const listener = app.listen(0);
  await new Promise((resolve) => listener.once('listening', resolve));
  t.after(() => listener.close());
  const base = `http://127.0.0.1:${listener.address().port}`;

  const checkout = await (await fetch(`${base}/api/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      guideToken: reservation.guide_token,
      lang: 'it',
      customer: { name: 'Giulia Rossi', email: 'giulia@example.invalid' },
      lines: [{ productId: 'wine-in-room', variantId: 'chianti-barrique', quantity: 1, date: WINE_DAY, slotId: 'w-1900', room: '303' }],
    }),
  })).json();
  assert.ok(checkout.accessToken);

  const order = await store.orders.findByAccessToken(checkout.accessToken);
  assert.equal(order.reservation_id, reservation.id, 'the stay owns it');

  // And it is there on a cold open of the link.
  const context = await (await fetch(`${base}/api/guide/${reservation.guide_token}`)).json();
  assert.equal(context.purchases.length, 1);
  assert.equal(context.purchases[0].access_token, checkout.accessToken);
});
