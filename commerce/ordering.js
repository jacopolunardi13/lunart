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
 * because they are rejected, but because they are never read. Surcharges are the
 * same: an oversized suitcase costs what the price table says it costs, and the
 * client only gets to say how many there are.
 */

import { PRODUCTS, visibleVariants } from './catalog.js';
import { resolvePrice, isSellable, CURRENCY } from './prices.js';
import { getWine, leadTimeMinutesFor, leadMinutesForWineOrder } from './wine.js';
import { propertyTimeToInstant, propertyDate, addDays, isValidDate, isValidTime } from './time.js';
import { isSlotOffered, slotsFor } from './schedule.js';
import { cardFitsStay, asStay, stayDates } from './stay.js';

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

/** True when this line needs a delivery slot or a time at all. */
export function needsTime(product, line) {
  if (product?.requiresTime) return true;
  const rule = product?.requiresTimeWhen;
  if (!rule) return false;
  return line?.options?.[rule.option] === rule.equals;
}

/**
 * When ordering closes for a given delivery.
 *
 * `dayBefore` is a wall-clock deadline the day before, in Florence time.
 * `leadMinutes` counts back from the end of the chosen window, by however much
 * notice the order needs — for wine that comes from what the whole wine order is
 * worth, which is why the basket's subtotal is passed in rather than guessed.
 */
export function cutoffFor(product, variant, { date, slotId } = {}, context = {}) {
  const rule = product?.cutoff;
  if (!rule || !date || !isValidDate(date)) return { deadline: null, kind: rule?.kind ?? null, minutes: null };

  if (rule.kind === 'dayBefore' || rule.kind === 'eveningBefore') {
    const hour = String(rule.hour ?? 12).padStart(2, '0');
    return {
      kind: 'dayBefore',
      hour: rule.hour ?? 12,
      deadline: propertyTimeToInstant(addDays(date, -1), `${hour}:00`),
      minutes: null,
    };
  }

  if (rule.kind === 'leadMinutes') {
    const minutes = leadMinutesFor(product, variant, rule, context);
    const slot = (product.deliverySlots ?? []).find((s) => s.id === slotId);
    // Counted from the end of the window: the last moment the bottle may arrive.
    const edge = slot?.to ?? slot?.from ?? '23:59';
    const until = propertyTimeToInstant(date, edge);
    if (!until) return { deadline: null, kind: 'leadMinutes', minutes };
    return { kind: 'leadMinutes', minutes, deadline: new Date(until.getTime() - minutes * 60_000) };
  }

  return { deadline: null, kind: rule.kind, minutes: null };
}

/**
 * How much notice this particular thing needs.
 *
 * For wine the rule is the order, not the bottle: €90 or more in the basket is an
 * express run at ninety minutes, below it waits for the next day's delivery. A
 * bottle may still declare its own `leadTimeMinutes` when it is physically
 * elsewhere, and that wins — where something is beats what it costs.
 */
export function leadMinutesFor(product, variant, rule = product?.cutoff, context = {}) {
  if (typeof variant?.leadTimeMinutes === 'number') return variant.leadTimeMinutes;
  const bottle = variant && getWine(variant.id);
  if (bottle) {
    const own = leadTimeMinutesFor(bottle);
    if (typeof own === 'number') return own;
    return leadMinutesForWineOrder(context.wineSubtotal ?? 0);
  }
  if (typeof rule?.minutes === 'number') return rule.minutes;
  if (typeof product?.leadTimeMinutes === 'number') return product.leadTimeMinutes;
  return 0;
}

/**
 * Until when a guest can call this off.
 * A service rule, nothing to do with the accommodation booking's own terms.
 */
export function cancellableUntil(product, line = {}) {
  const rule = product?.cancellation;
  if (!rule || rule.kind === 'none') return { kind: 'none', deadline: null };
  if (!isValidDate(line.date)) return { kind: rule.kind, deadline: null };

  if (rule.kind === 'dayBefore') {
    const hour = String(rule.hour ?? 12).padStart(2, '0');
    return { kind: 'dayBefore', hour: rule.hour ?? 12, deadline: propertyTimeToInstant(addDays(line.date, -1), `${hour}:00`) };
  }

  if (rule.kind === 'hoursBefore') {
    const slot = (product.deliverySlots ?? []).find((s) => s.id === line.slotId);
    const at = slot?.from ?? line.time;
    if (!at || !isValidTime(at)) return { kind: 'hoursBefore', hours: rule.hours, deadline: null };
    const start = propertyTimeToInstant(line.date, at);
    return { kind: 'hoursBefore', hours: rule.hours, deadline: new Date(start.getTime() - rule.hours * 3_600_000) };
  }

  return { kind: rule.kind, deadline: null };
}

/**
 * Is this an address Stripe will accept?
 *
 * Deliberately permissive — deciding whether an address exists is for the mail
 * server, not for a regex — and deliberately not nothing. A guest typed
 * "irenegmail.com" into the checkout, Stripe refused the session because there
 * was no `@` in it, and LunArt could only say "payment-provider-unavailable":
 * a payment failure for a typo, reported as an outage. One shape, checked in the
 * browser so the guest is told at once, and again on the server so the browser is
 * not the one deciding.
 */
export const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
export const looksLikeEmail = (value) => EMAIL_SHAPE.test(String(value ?? '').trim());

/** True when this line can still be cancelled at `now`. */
export function isCancellable(product, line, now = new Date()) {
  const { kind, deadline } = cancellableUntil(product, line);
  if (kind === 'none') return false;
  if (!deadline) return true;
  return now <= deadline;
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
 * What a line costs on top of its own price: an option that upgrades the bottle, a
 * numeric field that counts oversized suitcases. Each one is priced from the table
 * by its own SKU, so the client decides how many and never how much.
 */
export function surchargesFor(product, line, { allowPlaceholders = false } = {}) {
  const out = [];

  for (const option of product?.options ?? []) {
    const chosenId = line.options?.[option.id];
    const choice = option.choices?.find((c) => c.id === chosenId);
    if (!choice?.surcharge?.sku) continue;
    const price = resolvePrice(choice.surcharge.sku);
    out.push({
      kind: 'option', id: option.id, choice: choice.id, sku: choice.surcharge.sku,
      units: 1, unit: price.amount ?? 0, amount: price.amount ?? 0,
      sellable: isSellable(choice.surcharge.sku, { allowPlaceholders }),
    });
  }

  for (const field of product?.requiresFields ?? []) {
    if (!field.surcharge?.sku) continue;
    const units = Math.trunc(Number(line.fields?.[field.id] ?? 0));
    if (!Number.isFinite(units) || units <= 0) continue;
    const price = resolvePrice(field.surcharge.sku);
    out.push({
      kind: 'field', id: field.id, sku: field.surcharge.sku,
      units, unit: price.amount ?? 0, amount: (price.amount ?? 0) * units,
      sellable: isSellable(field.surcharge.sku, { allowPlaceholders }),
    });
  }

  return out;
}

/**
 * Check and price one line.
 * Returns every problem it finds rather than the first, so a form can show them all.
 */
export function validateLine(rawLine, { now = new Date(), allowPlaceholders = false, stay = null, context = {} } = {}) {
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
  // A variant still being settled is in the catalogue but not for sale, and is not
  // published either — asking for it by name does not make it buyable.
  if (variant?.hidden || variant?.pending) errors.push({ code: 'variant-unavailable', field: 'variantId' });

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

  // Slot or time, which some products only need in certain configurations.
  if (needsTime(product, line)) {
    const slots = product.deliverySlots ?? [];
    if (slots.length > 0) {
      if (!line.slotId || !slots.some((s) => s.id === line.slotId)) {
        errors.push({ code: 'slot-required', field: 'slotId' });
      }
    } else if (!line.time || !isValidTime(line.time)) {
      errors.push({ code: 'time-required', field: 'time' });
    }
  }

  /**
   * A product sold against someone's calendar can only be sold at a time that
   * calendar actually offers. Checked here rather than only in the form, because
   * the form is a convenience and this is the decision — a hand-written request
   * naming three in the morning gets the same answer as a mis-click.
   */
  if (product.availabilityMode === 'timeslots' && line.date && line.time) {
    if (!isSlotOffered(product.id, line.date, line.time)) {
      errors.push({ code: 'slot-unavailable', field: 'time' });
    }
  }

  /**
   * Anything sold inside a stay has to fit inside it. With no stay known — the
   * guide opened without a personal link — there is nothing to check against, and
   * inventing a window would be worse than not having one.
   */
  const bounded = asStay(stay);
  if (product.withinStay && bounded) {
    const days = variant?.meta?.days ?? 0;
    if (line.date && !stayDates(bounded).includes(line.date)) {
      errors.push({ code: 'date-outside-stay', field: 'date', stay: bounded });
    } else if (line.date && days && !cardFitsStay(bounded, line.date, days)) {
      errors.push({ code: 'duration-outside-stay', field: 'variantId', stay: bounded, days });
    }
  }

  if (product.requiresRoom && !line.room) errors.push({ code: 'room-required', field: 'room' });

  // Options, including the ones a variant narrows down.
  for (const option of product.options ?? []) {
    const allowed = variant?.allowedOptions?.[option.id];
    const chosen = line.options[option.id];
    const known = option.choices.some((c) => c.id === chosen);
    const required = option.required && (!allowed || allowed.length > 0);
    if (required && !chosen) errors.push({ code: 'option-required', field: option.id });
    else if (chosen && !known) errors.push({ code: 'option-invalid', field: option.id });
    else if (chosen && allowed && !allowed.includes(chosen)) {
      errors.push({ code: 'option-not-available', field: option.id, allowed });
    }
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
  const cutoff = cutoffFor(product, variant, line, context);
  if (cutoff.deadline && now > cutoff.deadline) {
    errors.push({ code: 'past-cutoff', field: 'date', deadline: cutoff.deadline.toISOString(), minutes: cutoff.minutes });
  }

  // Price. Derived from the catalogue, never from the payload.
  const sku = skuFor(product, variant);
  const price = resolvePrice(sku);
  if (!isSellable(sku, { allowPlaceholders })) {
    errors.push({ code: price.status === 'placeholder' ? 'price-not-confirmed' : 'price-not-set', field: 'price', sku });
  }

  const surcharges = surchargesFor(product, line, { allowPlaceholders });
  for (const surcharge of surcharges) {
    if (!surcharge.sellable) errors.push({ code: 'surcharge-not-priced', field: surcharge.id, sku: surcharge.sku });
  }

  const unit = typeof price.amount === 'number' ? price.amount : 0;
  const quantity = Math.max(0, line.quantity);
  const extra = surcharges.reduce((sum, s) => sum + s.amount, 0);
  const cancel = cancellableUntil(product, line);

  return {
    ok: errors.length === 0,
    line: { ...line, sku },
    product,
    variant,
    errors,
    price,
    unit,
    surcharges,
    surcharge: extra,
    amount: errors.length === 0 ? unit * quantity + extra : 0,
    cutoff: cutoff.deadline ? { ...cutoff, deadline: cutoff.deadline.toISOString() } : null,
    cancellation: cancel.deadline ? { ...cancel, deadline: cancel.deadline.toISOString() } : cancel,
  };
}

/**
 * Check and price a whole basket.
 *
 * Two passes, because one rule is about the basket rather than the line: how much
 * notice wine needs depends on what the wine in the basket is worth. The first pass
 * prices the wine, the second decides with that number in hand — so two bottles
 * bought together can be express when either alone would not be.
 */
export function priceCart(rawLines = [], { now = new Date(), allowPlaceholders = false, stay = null } = {}) {
  const raw = Array.isArray(rawLines) ? rawLines : [];

  const wineSubtotal = raw.reduce((sum, rawLine) => {
    const line = sanitiseLine(rawLine);
    const product = getProduct(line.productId);
    if (product?.category !== 'wine') return sum;
    const variant = getVariant(product, line.variantId);
    const price = resolvePrice(skuFor(product, variant));
    const quantity = Math.max(0, Math.trunc(line.quantity));
    return sum + (typeof price.amount === 'number' ? price.amount * quantity : 0);
  }, 0);

  const context = { wineSubtotal };
  const lines = raw.map((l) => validateLine(l, { now, allowPlaceholders, stay, context }));
  const ok = lines.length > 0 && lines.every((l) => l.ok);
  const subtotal = lines.reduce((sum, l) => sum + l.amount, 0);
  return {
    ok,
    currency: CURRENCY,
    lines,
    subtotal,
    total: subtotal,
    wineSubtotal,
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

export { CURRENCY, visibleVariants };

/** The times a product is actually free, for the form and for `/api/availability`. */
export function offeredSlots(productId, date) {
  return slotsFor(productId, date);
}
