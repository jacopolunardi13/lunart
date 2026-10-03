/**
 * Turning what a guest picked into what they owe.
 *
 * This module is the authority. The browser runs it too, so the cart can show a
 * total and explain a refused line without a round trip, but the server runs it
 * again on every checkout and uses only its own answer.
 *
 * `sanitiseLine` is the reason that is safe: a cart line is reduced to ids,
 * quantities and dates before anything looks at it. A payload carrying `amount`,
 * `price`, `total` or a doctored `sku` loses those fields on the way in — not
 * because they are rejected, but because they are never read.
 */

import { PRODUCTS } from './catalog.js';
import { resolvePrice, isSellable, CURRENCY } from './prices.js';
import { getWine, leadTimeMinutesFor } from './wine.js';
import { propertyTimeToInstant, propertyDate, addDays, isValidDate, isValidTime } from './time.js';

const productsById = new Map(PRODUCTS.map((p) => [p.id, p]));
export const getProduct = (id) => productsById.get(id);

export function getVariant(product, variantId) {
  if (!product?.variants?.length) return null;
  return product.variants.find((v) => v.id === variantId) ?? null;
}

/** The SKU a line is priced against. Derived here, never taken from the client. */
export function skuFor(product, variant) {
  if (variant?.sku) return variant.sku;
  if (product?.sku) return product.sku;
  return variant ? `${product.id}:${variant.id}` : product.id;
}

/**
 * When ordering closes for a given delivery.
 *
 * `eveningBefore` is a wall-clock deadline the day before, in Florence time.
 * `leadMinutes` counts back from the start of the chosen slot, by however much
 * notice the item itself needs — for wine that comes from the bottle, so two
 * bottles in the same basket can have different deadlines.
 */
export function cutoffFor(product, variant, { date, slotId } = {}) {
  const rule = product?.cutoff;
  if (!rule || !date || !isValidDate(date)) return { deadline: null, kind: rule?.kind ?? null, minutes: null };

  if (rule.kind === 'eveningBefore') {
    const hour = String(rule.hour ?? 21).padStart(2, '0');
    return {
      kind: 'eveningBefore',
      hour: rule.hour ?? 21,
      deadline: propertyTimeToInstant(addDays(date, -1), `${hour}:00`),
      minutes: null,
    };
  }

  if (rule.kind === 'leadMinutes') {
    const minutes = leadMinutesFor(product, variant, rule);
    const slot = (product.deliverySlots ?? []).find((s) => s.id === slotId);
    const start = slot?.from ?? '00:00';
    const slotStart = propertyTimeToInstant(date, start);
    if (!slotStart) return { deadline: null, kind: 'leadMinutes', minutes };
    return { kind: 'leadMinutes', minutes, deadline: new Date(slotStart.getTime() - minutes * 60_000) };
  }

  return { deadline: null, kind: rule.kind, minutes: null };
}

/** How much notice this particular thing needs. */
export function leadMinutesFor(product, variant, rule = product?.cutoff) {
  if (typeof variant?.leadTimeMinutes === 'number') return variant.leadTimeMinutes;
  const bottle = variant && getWine(variant.id);
  if (bottle) return leadTimeMinutesFor(bottle);
  if (typeof rule?.minutes === 'number') return rule.minutes;
  if (typeof product?.leadTimeMinutes === 'number') return product.leadTimeMinutes;
  return 0;
}

/**
 * Reduce a client payload to the fields we will read.
 *
 * Anything else — including anything that looks like money — is dropped here, so
 * no later code has to remember not to trust it.
 */
export function sanitiseLine(raw = {}) {
  const asString = (value, max = 200) =>
    (typeof value === 'string' ? value : '').trim().slice(0, max);

  const options = {};
  if (raw.options && typeof raw.options === 'object' && !Array.isArray(raw.options)) {
    for (const [key, value] of Object.entries(raw.options)) {
      options[asString(key, 40)] = asString(value, 40);
    }
  }
  const fields = {};
  if (raw.fields && typeof raw.fields === 'object' && !Array.isArray(raw.fields)) {
    for (const [key, value] of Object.entries(raw.fields)) {
      fields[asString(key, 40)] = asString(value, 500);
    }
  }

  return {
    productId: asString(raw.productId, 60),
    variantId: asString(raw.variantId, 60) || null,
    quantity: Number.isFinite(Number(raw.quantity)) ? Math.trunc(Number(raw.quantity)) : 0,
    date: asString(raw.date, 10) || null,
    slotId: asString(raw.slotId, 40) || null,
    time: asString(raw.time, 5) || null,
    room: asString(raw.room, 20) || null,
    options,
    fields,
  };
}

/**
 * Check and price one line.
 * Returns every problem it finds rather than the first, so a form can show them all.
 */
export function validateLine(rawLine, { now = new Date(), allowPlaceholders = false } = {}) {
  const line = sanitiseLine(rawLine);
  const errors = [];
  const product = getProduct(line.productId);

  if (!product) {
    return { ok: false, line, errors: [{ code: 'unknown-product', field: 'productId' }], amount: 0 };
  }
  if (!product.active || product.status === 'inactive') {
    errors.push({ code: 'product-inactive', field: 'productId' });
  }
  if (product.status === 'coming-soon') errors.push({ code: 'not-on-sale', field: 'productId' });
  if (product.purchaseMode === 'request-only') errors.push({ code: 'request-only', field: 'productId' });

  const variant = getVariant(product, line.variantId);
  if (product.variants?.length > 0 && !variant) {
    errors.push({ code: 'variant-required', field: 'variantId' });
  }

  // Quantity
  const { min = 1, max = 1 } = product.quantity ?? {};
  if (!Number.isInteger(line.quantity) || line.quantity < min || line.quantity > max) {
    errors.push({ code: 'quantity-out-of-range', field: 'quantity', min, max });
  }

  // Date
  if (product.requiresDate) {
    if (!line.date || !isValidDate(line.date)) {
      errors.push({ code: 'date-required', field: 'date' });
    } else if (line.date < propertyDate(now)) {
      errors.push({ code: 'date-in-past', field: 'date' });
    }
  }

  // Slot or time
  if (product.requiresTime) {
    const slots = product.deliverySlots ?? [];
    if (slots.length > 0) {
      if (!line.slotId || !slots.some((s) => s.id === line.slotId)) {
        errors.push({ code: 'slot-required', field: 'slotId' });
      }
    } else if (!line.time || !isValidTime(line.time)) {
      errors.push({ code: 'time-required', field: 'time' });
    }
  }

  if (product.requiresRoom && !line.room) errors.push({ code: 'room-required', field: 'room' });

  // Options
  for (const option of product.options ?? []) {
    const chosen = line.options[option.id];
    const known = option.choices.some((c) => c.id === chosen);
    if (option.required && !chosen) errors.push({ code: 'option-required', field: option.id });
    else if (chosen && !known) errors.push({ code: 'option-invalid', field: option.id });
  }

  // Free-text fields
  for (const field of product.requiresFields ?? []) {
    const value = line.fields[field.id];
    if (field.required && !value) errors.push({ code: 'field-required', field: field.id });
    if (value && field.type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n) || (field.min != null && n < field.min) || (field.max != null && n > field.max)) {
        errors.push({ code: 'field-out-of-range', field: field.id, min: field.min, max: field.max });
      }
    }
  }

  // Cut-off
  const cutoff = cutoffFor(product, variant, line);
  if (cutoff.deadline && now > cutoff.deadline) {
    errors.push({ code: 'past-cutoff', field: 'date', deadline: cutoff.deadline.toISOString(), minutes: cutoff.minutes });
  }

  // Price. Derived from the catalogue, never from the payload.
  const sku = skuFor(product, variant);
  const price = resolvePrice(sku);
  if (!isSellable(sku, { allowPlaceholders })) {
    errors.push({ code: price.status === 'placeholder' ? 'price-not-confirmed' : 'price-not-set', field: 'price', sku });
  }

  const unit = typeof price.amount === 'number' ? price.amount : 0;
  const quantity = Math.max(0, line.quantity);
  return {
    ok: errors.length === 0,
    line: { ...line, sku },
    product,
    variant,
    errors,
    price,
    unit,
    amount: errors.length === 0 ? unit * quantity : 0,
    cutoff: cutoff.deadline ? { ...cutoff, deadline: cutoff.deadline.toISOString() } : null,
  };
}

/** Check and price a whole basket. */
export function priceCart(rawLines = [], { now = new Date(), allowPlaceholders = false } = {}) {
  const lines = (Array.isArray(rawLines) ? rawLines : []).map((l) => validateLine(l, { now, allowPlaceholders }));
  const ok = lines.length > 0 && lines.every((l) => l.ok);
  const subtotal = lines.reduce((sum, l) => sum + l.amount, 0);
  return {
    ok,
    currency: CURRENCY,
    lines,
    subtotal,
    total: subtotal,
    errors: lines.flatMap((l, index) => l.errors.map((e) => ({ ...e, index }))),
    empty: lines.length === 0,
  };
}

/**
 * How this basket has to be paid for.
 * A basket holding anything that needs a provider's yes is authorised, not charged.
 */
export function paymentModeFor(pricedLines) {
  const modes = new Set(pricedLines.map((l) => l.product?.purchaseMode).filter(Boolean));
  if (modes.has('authorize-then-capture')) return 'authorize-then-capture';
  return 'instant';
}

export { CURRENCY };
