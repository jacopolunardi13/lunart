/**
 * Pricing, cut-offs and the cart.
 *
 * The important ones are the tampering tests. A browser can send anything it
 * likes, so the contract worth proving is that nothing it sends about money is
 * ever read: the server derives the SKU from its own catalogue and prices it
 * there.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateLine, priceCart, sanitiseLine, cutoffFor, leadMinutesFor,
  getProduct, getVariant, skuFor, paymentModeFor,
} from '../commerce/ordering.js';
import { resolvePrice, isSellable, applyPriceOverrides, pricingGaps, PRICES } from '../commerce/prices.js';
import { WINES, getWine, leadTimeMinutesFor, curatedWines } from '../commerce/wine.js';
import { PRODUCTS } from '../commerce/catalog.js';
import { PARTNERS, activePartners, benefitFor, BENEFIT_KINDS } from '../commerce/partners.js';
import { propertyTimeToInstant, propertyDate, addDays, lastDayOf } from '../commerce/time.js';
import { COMMERCE_CATEGORIES } from '../commerce/schema.js';

const NOW = new Date('2026-10-03T08:00:00Z');     // 10:00 in Florence
const soon = (days) => addDays(propertyDate(NOW), days);

const line = (over = {}) => ({
  productId: 'wine-in-room', variantId: 'brunello', quantity: 1,
  date: soon(3), slotId: 'w-1900', room: '303', ...over,
});

/* ── Prices ──────────────────────────────────────────────────────────────── */

test('the transfer is the one confirmed price, and it is EUR 90', () => {
  const price = resolvePrice('transfer-airport');
  assert.equal(price.amount, 9000);
  assert.equal(price.status, 'confirmed');
  assert.ok(isSellable('transfer-airport'), 'a confirmed price sells anywhere');
});

test('an unconfirmed price never sells on a production server', () => {
  assert.equal(isSellable('wine:brunello'), false, 'placeholder refused by default');
  assert.equal(isSellable('wine:brunello', { allowPlaceholders: true }), true, 'allowed when asked for');
});

test('a price nobody has set never sells, however the server is configured', () => {
  for (const sku of ['privilege-card:2d', 'privilege-card:5d', 'privilege-card:8d', 'light-breakfast']) {
    assert.equal(resolvePrice(sku).status, 'to-configure', sku);
    assert.equal(isSellable(sku), false, sku);
    assert.equal(isSellable(sku, { allowPlaceholders: true }), false, `${sku} with placeholders`);
  }
});

test('wine is priced from the carta unless it is overridden', () => {
  for (const bottle of WINES) {
    const price = resolvePrice(`wine:${bottle.id}`);
    assert.equal(price.amount, bottle.sourcePrice, bottle.name);
    assert.equal(price.status, 'placeholder');
  }
});

test('an unknown SKU resolves rather than throwing', () => {
  const price = resolvePrice('nonsense:sku');
  assert.equal(price.amount, null);
  assert.equal(price.missing, true);
});

test('everything still waiting on a decision is listed', () => {
  const gaps = pricingGaps();
  assert.ok(gaps.length > 0);
  assert.ok(gaps.every((gap) => gap.status !== 'confirmed'));
  assert.ok(gaps.some((gap) => gap.sku === 'privilege-card:8d'));
});

/* ── The client cannot name a price ──────────────────────────────────────── */

test('anything resembling money is dropped on the way in', () => {
  const clean = sanitiseLine({
    productId: 'wine-in-room', variantId: 'brunello', quantity: 1,
    amount: 1, price: 1, unit_amount: 1, total: 1, sku: 'transfer-airport', currency: 'XXX',
  });
  for (const key of ['amount', 'price', 'unit_amount', 'total', 'sku', 'currency']) {
    assert.equal(key in clean, false, `${key} should not survive sanitising`);
  }
});

test('a tampered amount changes nothing about what is charged', () => {
  const honest = validateLine(line(), { now: NOW, allowPlaceholders: true });
  const tampered = validateLine({ ...line(), amount: 1, price: 1, total: 1 }, { now: NOW, allowPlaceholders: true });
  assert.equal(honest.amount, 7000);
  assert.equal(tampered.amount, 7000, 'the server priced it from the catalogue');
});

test('a tampered SKU cannot buy a cheap thing at another price', () => {
  // Claiming the privilege card's SKU on a wine line must not change either.
  const result = validateLine({ ...line(), sku: 'privilege-card:2d' }, { now: NOW, allowPlaceholders: true });
  assert.equal(result.line.sku, 'wine:brunello');
  assert.equal(result.amount, 7000);
});

test('quantity is clamped to what the product allows', () => {
  const tooMany = validateLine(line({ quantity: 99 }), { now: NOW, allowPlaceholders: true });
  assert.equal(tooMany.ok, false);
  assert.ok(tooMany.errors.some((e) => e.code === 'quantity-out-of-range'));
  assert.equal(tooMany.amount, 0, 'a refused line is worth nothing');

  const negative = validateLine(line({ quantity: -5 }), { now: NOW, allowPlaceholders: true });
  assert.equal(negative.ok, false);
  assert.equal(negative.amount, 0);
});

test('a refused line never contributes to a total', () => {
  const cart = priceCart([line(), line({ date: '2020-01-01' })], { now: NOW, allowPlaceholders: true });
  assert.equal(cart.ok, false);
  assert.equal(cart.total, 7000, 'only the good line counts');
});

/* ── Cut-offs ────────────────────────────────────────────────────────────── */

test('a bottle under EUR 100 needs twelve hours', () => {
  const bottle = getWine('brunello');
  assert.ok(bottle.sourcePrice < 10000);
  assert.equal(leadTimeMinutesFor(bottle), 720);

  const product = getProduct('wine-in-room');
  const variant = getVariant(product, 'brunello');
  const { deadline, minutes } = cutoffFor(product, variant, { date: '2026-10-05', slotId: 'w-1900' });
  assert.equal(minutes, 720);
  // 19:00 in Florence on the 5th, less twelve hours.
  assert.equal(deadline.toISOString(), new Date(propertyTimeToInstant('2026-10-05', '19:00').getTime() - 720 * 60_000).toISOString());
});

test('a bottle at EUR 100 or above needs ninety minutes', () => {
  for (const id of ['modus-primo', 'moet-chandon', 'dom-perignon']) {
    const bottle = getWine(id);
    assert.ok(bottle.sourcePrice >= 10000, id);
    assert.equal(leadTimeMinutesFor(bottle), 90, id);
  }
});

test('a bottle can state its own notice, whatever it costs', () => {
  // The capability matters more than any value we would invent: the real
  // constraint is where a bottle is, not what it costs.
  const cheapButSlow = { id: 'x', sourcePrice: 3000, leadTimeMinutes: 2880 };
  const dearButQuick = { id: 'y', sourcePrice: 50000, leadTimeMinutes: 30 };
  assert.equal(leadTimeMinutesFor(cheapButSlow), 2880, 'the override wins over the cheap default');
  assert.equal(leadTimeMinutesFor(dearButQuick), 30, 'and over the expensive one');

  const product = getProduct('wine-in-room');
  assert.equal(leadMinutesFor(product, { id: 'z', leadTimeMinutes: 15 }), 15);
});

test('ordering a bottle too late is refused', () => {
  const now = new Date('2026-10-05T16:00:00Z');      // 18:00 in Florence
  const late = validateLine(
    { productId: 'wine-in-room', variantId: 'brunello', quantity: 1, date: '2026-10-05', slotId: 'w-1900', room: '303' },
    { now, allowPlaceholders: true },
  );
  assert.equal(late.ok, false);
  assert.ok(late.errors.some((e) => e.code === 'past-cutoff'));

  // The same evening, the ninety-minute bottle is still fine.
  const inTime = validateLine(
    { productId: 'wine-in-room', variantId: 'dom-perignon', quantity: 1, date: '2026-10-05', slotId: 'w-2100', room: '303' },
    { now, allowPlaceholders: true },
  );
  assert.equal(inTime.ok, true, JSON.stringify(inTime.errors));
});

test('breakfast closes at nine the evening before, Florence time', () => {
  const product = getProduct('brunch');
  const { deadline, kind } = cutoffFor(product, null, { date: '2026-10-06' });
  assert.equal(kind, 'eveningBefore');
  assert.equal(deadline.toISOString(), propertyTimeToInstant('2026-10-05', '21:00').toISOString());

  const base = { productId: 'brunch', variantId: 'opera', quantity: 1, date: '2026-10-06', slotId: 'b-0830', room: '303', options: { hotDrink: 'espresso' } };
  const justInTime = validateLine(base, { now: new Date('2026-10-05T18:59:00Z'), allowPlaceholders: true });  // 20:59 local
  const tooLate   = validateLine(base, { now: new Date('2026-10-05T19:01:00Z'), allowPlaceholders: true });  // 21:01 local
  assert.equal(justInTime.ok, true, JSON.stringify(justInTime.errors));
  assert.equal(tooLate.ok, false);
  assert.ok(tooLate.errors.some((e) => e.code === 'past-cutoff'));
});

test('the deadline is a wall clock in Florence, not UTC', () => {
  // Summer and winter give different instants for the same stated hour.
  const winter = cutoffFor(getProduct('brunch'), null, { date: '2026-01-16' }).deadline;
  const summer = cutoffFor(getProduct('brunch'), null, { date: '2026-07-16' }).deadline;
  assert.equal(winter.toISOString(), '2026-01-15T20:00:00.000Z');
  assert.equal(summer.toISOString(), '2026-07-15T19:00:00.000Z');
});

/* ── Validation of everything else a line needs ──────────────────────────── */

test('a line is checked for all of its requirements at once', () => {
  const bare = validateLine({ productId: 'brunch', quantity: 1 }, { now: NOW, allowPlaceholders: true });
  const codes = bare.errors.map((e) => e.code);
  assert.ok(codes.includes('variant-required'));
  assert.ok(codes.includes('date-required'));
  assert.ok(codes.includes('slot-required'));
  assert.ok(codes.includes('room-required'));
  assert.ok(codes.includes('option-required'));
});

test('an option that is not on the menu is refused', () => {
  const result = validateLine({
    productId: 'brunch', variantId: 'opera', quantity: 1, date: soon(2),
    slotId: 'b-0830', room: '303', options: { hotDrink: 'champagne' },
  }, { now: NOW, allowPlaceholders: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'option-invalid'));
});

test('the transfer needs the details a driver actually needs', () => {
  const missing = validateLine({
    productId: 'transfer-airport', variantId: 'to-airport', quantity: 1, date: soon(5), time: '09:30',
  }, { now: NOW });
  const fields = missing.errors.filter((e) => e.code === 'field-required').map((e) => e.field);
  assert.deepEqual(fields.sort(), ['luggage', 'passengerName', 'passengers', 'phone']);

  const complete = validateLine({
    productId: 'transfer-airport', variantId: 'to-airport', quantity: 1, date: soon(5), time: '09:30',
    fields: { passengerName: 'Jacopo', passengers: '2', luggage: '2', phone: '+39392' },
  }, { now: NOW });
  assert.equal(complete.ok, true, JSON.stringify(complete.errors));
  assert.equal(complete.amount, 9000);
});

test('a number field outside its range is refused', () => {
  const result = validateLine({
    productId: 'transfer-airport', variantId: 'to-airport', quantity: 1, date: soon(5), time: '09:30',
    fields: { passengerName: 'Jacopo', passengers: '40', luggage: '2', phone: '+39392' },
  }, { now: NOW });
  assert.ok(result.errors.some((e) => e.code === 'field-out-of-range' && e.field === 'passengers'));
});

test('things not on sale cannot be bought', () => {
  const coming = validateLine({ productId: 'chianti-experience', quantity: 1, date: soon(10) }, { now: NOW, allowPlaceholders: true });
  assert.equal(coming.ok, false);
  assert.ok(coming.errors.some((e) => e.code === 'not-on-sale'));

  const onRequest = validateLine({ productId: 'celebration-setup', quantity: 1, date: soon(3), room: '303' }, { now: NOW, allowPlaceholders: true });
  assert.equal(onRequest.ok, false);
  assert.ok(onRequest.errors.some((e) => e.code === 'request-only'));
});

/* ── Baskets ─────────────────────────────────────────────────────────────── */

test('a basket of several different things adds up', () => {
  const cart = priceCart([
    line(),                                                   // Brunello, 70
    line({ variantId: 'vermentino', slotId: 'w-2000' }),      // Vermentino, 34
    { productId: 'brunch', variantId: 'opera', quantity: 1, date: soon(2), slotId: 'b-0830', room: '303', options: { hotDrink: 'espresso' } },
  ], { now: NOW, allowPlaceholders: true });

  assert.equal(cart.ok, true, JSON.stringify(cart.errors));
  assert.equal(cart.lines.length, 3);
  assert.equal(cart.total, 7000 + 3400 + 5000);
  assert.equal(cart.currency, 'EUR');
});

test('quantity multiplies', () => {
  const cart = priceCart([line({ quantity: 3 })], { now: NOW, allowPlaceholders: true });
  assert.equal(cart.total, 21000);
});

test('an empty basket is not a valid one', () => {
  const cart = priceCart([], { now: NOW });
  assert.equal(cart.ok, false);
  assert.equal(cart.empty, true);
  assert.equal(cart.total, 0);
});

test('a basket holding the transfer is authorised rather than charged', () => {
  const withTransfer = priceCart([
    line(),
    { productId: 'transfer-airport', variantId: 'to-airport', quantity: 1, date: soon(5), time: '09:30',
      fields: { passengerName: 'J', passengers: '1', luggage: '1', phone: '+39' } },
  ], { now: NOW, allowPlaceholders: true });
  assert.equal(paymentModeFor(withTransfer.lines), 'authorize-then-capture');
  assert.equal(paymentModeFor(priceCart([line()], { now: NOW, allowPlaceholders: true }).lines), 'instant');
});

/* ── Catalogue integrity ─────────────────────────────────────────────────── */

test('every product is complete and bilingual', () => {
  const categories = new Set(COMMERCE_CATEGORIES.map((c) => c.id));
  for (const product of PRODUCTS) {
    for (const field of ['title', 'summary', 'description', 'terms']) {
      assert.ok(product[field]?.it?.trim(), `${product.id}.${field} is missing Italian`);
      assert.ok(product[field]?.en?.trim(), `${product.id}.${field} is missing English`);
    }
    assert.ok(categories.has(product.category), `${product.id} has an unknown category`);
    assert.ok(['always', 'cutoff', 'timeslots', 'manual-confirm', 'external', 'request'].includes(product.availabilityMode), product.id);
    assert.ok(['instant', 'authorize-then-capture', 'external-checkout', 'request-only'].includes(product.purchaseMode), product.id);
  }
});

test('every variant resolves to a SKU the pricing table knows about', () => {
  for (const product of PRODUCTS) {
    for (const variant of product.variants ?? []) {
      const sku = skuFor(product, variant);
      const price = resolvePrice(sku);
      assert.ok(!price.missing, `${sku} has no price entry at all`);
    }
  }
});

test('the wine selection is a subset of the carta, and on sale', () => {
  const curated = curatedWines();
  assert.ok(curated.length > 0 && curated.length < WINES.length, 'curated, not the whole list');
  for (const bottle of curated) {
    assert.equal(bottle.available, true);
    assert.ok(WINES.includes(bottle));
  }
  // Taking a bottle off sale removes it from the selection without deleting it.
  const first = curated[0];
  first.available = false;
  assert.ok(!curatedWines().includes(first));
  first.available = true;
});

test('partner benefits are not assumed to be a house percentage', () => {
  const kinds = new Set(PARTNERS.map((p) => p.benefit.kind));
  assert.ok(kinds.size >= 3, 'the model carries more than one shape of benefit');
  for (const partner of PARTNERS) {
    assert.ok(BENEFIT_KINDS.includes(partner.benefit.kind), partner.id);
    assert.ok(partner.benefit.label?.it && partner.benefit.label?.en, `${partner.id} label`);
  }
  for (const partner of activePartners()) {
    assert.notEqual(partner.example, true, 'an example must never be active');
  }
  assert.equal(benefitFor('example-bar'), null, 'inactive partners give nothing');
});

test('price overrides replace the table and can be taken away again', () => {
  const before = resolvePrice('transfer-airport').amount;
  applyPriceOverrides({ 'transfer-airport': { amount: 12345, status: 'confirmed' } });
  assert.equal(resolvePrice('transfer-airport').amount, 12345);
  applyPriceOverrides({});
  assert.equal(resolvePrice('transfer-airport').amount, before);
  assert.equal(PRICES['transfer-airport'].amount, 9000, 'the file itself is untouched');
});

test('a card runs to the end of its last day, inclusive', () => {
  assert.equal(lastDayOf('2026-10-05', 1), '2026-10-05');
  assert.equal(lastDayOf('2026-10-05', 2), '2026-10-06');
  assert.equal(lastDayOf('2026-10-05', 5), '2026-10-09');
  assert.equal(lastDayOf('2026-10-05', 8), '2026-10-12');
  assert.equal(lastDayOf('2026-12-30', 5), '2027-01-03', 'across a year end');
});
