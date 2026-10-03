/**
 * The cart.
 *
 * Lines are kept in localStorage so a guest can put a bottle aside, go and look at
 * the breakfast, and still have both when they come back — or close the browser on
 * the way to dinner and find the basket intact.
 *
 * What is stored is deliberately thin: product and variant ids, a quantity, a date,
 * a slot, chosen options. No amounts. Totals are computed from the catalogue the
 * server published, and recomputed by the server at checkout, so a cart edited in
 * devtools buys nothing it has not paid for.
 */

import { priceCart, getProduct, getVariant } from '../../commerce/ordering.js';

const STORAGE_KEY = 'lunart.cart.v1';
const listeners = new Set();

let lines = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isPlausible) : [];
  } catch {
    return [];   // private browsing, or someone put something odd in there
  }
}

function isPlausible(line) {
  return line && typeof line.productId === 'string' && Number.isInteger(line.quantity) && line.quantity > 0;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch { /* nothing we can do, and nothing that should stop the cart working */ }
  for (const listener of listeners) listener(lines);
}

export function onCartChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Two lines are the same line when every choice matches. Adding the same bottle
 * for the same evening twice should say "2", not list it twice; adding it for a
 * different evening should not.
 */
function keyOf(line) {
  return [
    line.productId, line.variantId ?? '', line.date ?? '', line.slotId ?? '', line.time ?? '', line.room ?? '',
    JSON.stringify(line.options ?? {}), JSON.stringify(line.fields ?? {}),
  ].join('|');
}

export const getLines = () => lines.map((line) => ({ ...line }));

export const count = () => lines.reduce((sum, line) => sum + line.quantity, 0);

export function add(line) {
  const incoming = {
    productId: line.productId,
    variantId: line.variantId ?? null,
    quantity: Math.max(1, Math.trunc(line.quantity ?? 1)),
    date: line.date ?? null,
    slotId: line.slotId ?? null,
    time: line.time ?? null,
    room: line.room ?? null,
    options: line.options ?? {},
    fields: line.fields ?? {},
  };

  const product = getProduct(incoming.productId);
  const max = product?.quantity?.max ?? 1;
  const existing = lines.find((candidate) => keyOf(candidate) === keyOf(incoming));

  if (existing) existing.quantity = Math.min(max, existing.quantity + incoming.quantity);
  else lines.push(incoming);

  save();
  return incoming;
}

export function setQuantity(index, quantity) {
  const line = lines[index];
  if (!line) return;
  const max = getProduct(line.productId)?.quantity?.max ?? 1;
  const next = Math.trunc(quantity);
  if (next <= 0) lines.splice(index, 1);
  else line.quantity = Math.min(max, Math.max(1, next));
  save();
}

export function remove(index) {
  lines.splice(index, 1);
  save();
}

export function clear() {
  lines = [];
  save();
}

/**
 * Price and check the basket with the same module the server uses.
 *
 * This is for showing a total and explaining a refused line without a round trip.
 * It is not the decision — the server prices it again at checkout and uses its own
 * answer.
 */
export function review({ now = new Date(), allowPlaceholders = true } = {}) {
  const priced = priceCart(lines, { now, allowPlaceholders });
  return {
    ...priced,
    lines: priced.lines.map((entry, index) => ({
      ...entry,
      index,
      product: entry.product,
      variant: entry.variant ?? getVariant(entry.product, entry.line.variantId),
    })),
  };
}

/** What gets posted to /api/checkout. Still no amounts. */
export const payload = () => lines.map((line) => ({ ...line }));
