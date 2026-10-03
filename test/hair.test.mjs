/**
 * The Private Hair Service.
 *
 * The thing worth proving here is that a time cannot be bought unless somebody
 * actually offered it. The form only shows free slots, but the form is a
 * convenience — the server checks the same schedule again, so a hand-written
 * request naming three in the morning gets the same answer as a mis-click.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../server/app.js';
import { createStore } from '../server/store.js';
import { createMockStripe } from '../server/stripe.js';
import { validateLine, priceCart, getProduct, getVariant, skuFor } from '../commerce/ordering.js';
import { resolvePrice } from '../commerce/prices.js';
import { applySchedule, slotsFor, daysWithSlots, isSlotOffered, MANUAL_SCHEDULE } from '../commerce/schedule.js';
import { devSchedule } from '../commerce/schedule.dev.js';
import { propertyDate } from '../commerce/time.js';
import { COMMERCE_CATEGORIES } from '../commerce/schema.js';

const SCHEDULE = devSchedule();
const DAY = daysWithSlots('hair-service', SCHEDULE)[0];
const TIME = slotsFor('hair-service', DAY, SCHEDULE)[0].time;

const line = (over = {}) => ({
  productId: 'hair-service', variantId: 'men-cut', quantity: 1,
  date: DAY, time: TIME, room: '303',
  fields: { guestName: 'Jacopo Lunardi', phone: '+39 392 472 5263' },
  ...over,
});

before(() => applySchedule(SCHEDULE));
after(() => applySchedule(null));

/* ── The catalogue ───────────────────────────────────────────────────────── */

test('the service has a category of its own in the shop', () => {
  const category = COMMERCE_CATEGORIES.find((c) => c.id === 'hair');
  assert.ok(category, 'hair is a category');
  assert.ok(category.title.it && category.title.en);
  assert.equal(getProduct('hair-service').category, 'hair');
});

test('the prices are the ones LunArt set, and they live server-side', () => {
  const expected = {
    'men-cut': 5000, 'men-beard': 3500, 'men-cut-beard': 7000,
    'women-blowdry': 7000, 'women-cut-blow': 9500, 'women-evening': 9000,
  };
  const product = getProduct('hair-service');
  for (const [variantId, amount] of Object.entries(expected)) {
    const price = resolvePrice(skuFor(product, getVariant(product, variantId)));
    assert.equal(price.amount, amount, variantId);
    assert.equal(price.status, 'confirmed', variantId);
  }
});

test('colour is not offered and ceremony styling is not yet buyable', () => {
  const product = getProduct('hair-service');
  const ids = product.variants.map((v) => v.id);
  for (const absent of ['colour', 'color', 'highlights', 'balayage']) {
    assert.ok(!ids.includes(absent), `${absent} should not be in the catalogue at all`);
  }
  assert.ok(ids.includes('ceremony'), 'ceremony styling is modelled');
  assert.equal(resolvePrice('hair-service:ceremony').amount, null);

  const result = validateLine(line({ variantId: 'ceremony' }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'price-not-set'));
});

test('every service is named in both languages', () => {
  for (const variant of getProduct('hair-service').variants) {
    assert.ok(variant.title.it?.trim(), `${variant.id} has no Italian name`);
    assert.ok(variant.title.en?.trim(), `${variant.id} has no English name`);
    assert.notEqual(variant.title.it, variant.title.en, `${variant.id} looks untranslated`);
  }
  const product = getProduct('hair-service');
  for (const field of ['title', 'summary', 'description', 'terms']) {
    assert.ok(product[field].it?.trim() && product[field].en?.trim(), field);
  }
  for (const field of product.requiresFields) {
    assert.ok(field.label.it?.trim() && field.label.en?.trim(), `field ${field.id}`);
  }
});

/* ── Appointments ────────────────────────────────────────────────────────── */

test('with no schedule configured, nothing can be booked', () => {
  applySchedule(null);
  assert.deepEqual(daysWithSlots('hair-service'), [], 'the default schedule is empty on purpose');

  const result = validateLine(line());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'slot-unavailable'));
  applySchedule(SCHEDULE);
});

test('a time has to be chosen', () => {
  const result = validateLine(line({ time: null }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'time-required'));
});

test('a day has to be chosen', () => {
  const result = validateLine(line({ date: null }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'date-required'));
});

test('a time nobody offered cannot be bought', () => {
  for (const invented of ['03:00', '23:45', '12:17', '09:59']) {
    const result = validateLine(line({ time: invented }));
    assert.equal(result.ok, false, `${invented} should be refused`);
    assert.ok(result.errors.some((e) => e.code === 'slot-unavailable'), invented);
    assert.equal(result.amount, 0);
  }
});

test('a day nobody offered cannot be bought either', () => {
  const closed = Object.keys(SCHEDULE['hair-service'])
    .map(Number).length === 0 ? null : '2027-01-01';
  const result = validateLine(line({ date: closed }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'slot-unavailable'));
});

test('an offered time is accepted and priced', () => {
  const result = validateLine(line());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.amount, 5000);
});

test('the schedule decides, not the shape of the time', () => {
  // Well-formed and plausible, but simply not on offer.
  assert.equal(isSlotOffered('hair-service', DAY, TIME), true);
  assert.equal(isSlotOffered('hair-service', DAY, '10:01'), false);
  assert.equal(isSlotOffered('hair-service', '2027-06-01', TIME), false);
});

test('the service needs the details whoever turns up will want', () => {
  const result = validateLine(line({ fields: {} }));
  const missing = result.errors.filter((e) => e.code === 'field-required').map((e) => e.field).sort();
  assert.deepEqual(missing, ['guestName', 'phone']);

  const noRoom = validateLine(line({ room: null }));
  assert.ok(noRoom.errors.some((e) => e.code === 'room-required'));
});

/* ── Through the API ─────────────────────────────────────────────────────── */

test('the booking flow, end to end', async () => {
  const app = await createApp({
    store: createStore(), stripe: createMockStripe(),
    cardSigningKey: 'hair-test-key', mode: 'development', publicUrl: 'http://127.0.0.1',
  });
  applySchedule(SCHEDULE);   // createApp may reset it when dev prices are off
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (path, body) => {
    const response = await fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };

  // The server publishes the days it will accept, and the times on one of them.
  const { body: days } = await call('/api/availability/hair-service');
  assert.equal(days.mode, 'timeslots');
  assert.ok(days.days.includes(DAY));
  const { body: onDay } = await call(`/api/availability/hair-service?date=${DAY}`);
  assert.ok(onDay.slots.some((slot) => slot.time === TIME));

  // A tampered price buys nothing cheaper.
  const { body: checkout } = await call('/api/checkout', {
    lang: 'it',
    customer: { name: 'Jacopo Lunardi', email: 'jacopo@example.com', phone: '+39392', room: '303' },
    lines: [{ ...line({ variantId: 'women-cut-blow' }), amount: 1, price: 1, total: 1 }],
  });
  assert.equal(checkout.amount, 9500, 'the server priced it from the catalogue');

  const session = new URL(checkout.checkoutUrl, base).searchParams.get('session');
  await call('/mock-checkout/complete', { session });

  const { body: order } = await call(`/api/orders/${checkout.accessToken}`);
  assert.equal(order.status, 'paid');
  assert.equal(order.lines.length, 1);
  assert.equal(order.lines[0].date, DAY, 'the day is on the order');
  assert.equal(order.lines[0].time, TIME, 'and so is the time');
  assert.equal(order.lines[0].room, '303');
  assert.equal(order.amount, 9500);

  // Everything whoever turns up will need is recorded.
  const stored = await app.store.orders.findByAccessToken(checkout.accessToken);
  const booked = stored.lines[0];
  assert.equal(booked.product_id, 'hair-service');
  assert.equal(booked.variant_id, 'women-cut-blow');
  assert.equal(booked.fields.guestName, 'Jacopo Lunardi');
  assert.ok(booked.fields.phone);
  assert.equal(stored.customer.email, 'jacopo@example.com');
  assert.ok(stored.stripe_session_id);
  assert.ok(stored.stripe_payment_intent_id);
  assert.equal(stored.provider.assignee, null, 'nobody is assigned until somebody is');

  // And an unavailable time is refused at checkout, not only in the form.
  const { status, body: refused } = await call('/api/checkout', {
    lang: 'it',
    customer: { name: 'Jacopo', email: 'j@example.com' },
    lines: [line({ time: '04:00' })],
  });
  assert.equal(status, 422);
  assert.ok(refused.errors.some((e) => e.code === 'slot-unavailable'));

  server.close();
});

test('a basket can hold a haircut alongside everything else', () => {
  const cart = priceCart([
    line(),
    { productId: 'wine-in-room', variantId: 'brunello', quantity: 1, date: DAY, slotId: 'w-1900', room: '303' },
  ], { allowPlaceholders: true });
  assert.equal(cart.ok, true, JSON.stringify(cart.errors));
  assert.equal(cart.total, 5000 + 7000);
});

test('the shipped schedule is empty, so nothing is invented', () => {
  assert.deepEqual(MANUAL_SCHEDULE['hair-service'], {},
    'the committed schedule must stay empty until somebody gives us real hours');
});
