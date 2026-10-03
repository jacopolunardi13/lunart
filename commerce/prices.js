/**
 * Every amount LunArt charges, in one file.
 *
 * This is the file to edit to set commercial terms. Nothing else in the codebase
 * contains a price, and the server reads it directly — the browser is shown prices
 * only so it can render them, and never sends one back.
 *
 * Amounts are integer eurocents.
 *
 * Each entry carries a `status`, and the distinction matters:
 *
 *   confirmed     LunArt has set this. Sellable anywhere.
 *   placeholder   A real number from a real document, but not confirmed as the
 *                 price LunArt charges — the carta vini bottle column, or Opera
 *                 Caffè's per-person brunch rate. Sellable only on a server
 *                 started with ALLOW_PLACEHOLDER_PRICES, which is how the preview
 *                 runs; production refuses it.
 *   to-configure  Nobody has set a price. Never sellable. The product still
 *                 renders, and says so.
 *
 * Nothing here is invented. Where there was no number to work from, the entry is
 * `to-configure` and the product cannot be bought, which is the honest state.
 */

import { WINES, getWine } from './wine.js';

export const PRICE_STATUS = {
  confirmed: 'confirmed',
  placeholder: 'placeholder',
  'to-configure': 'to-configure',
};

export const CURRENCY = 'EUR';

/** Keyed by SKU: either `productId` or `productId:variantId`. */
export const PRICES = {
  // ── Privilege Card ───────────────────────────────────────────────────────
  'privilege-card:2d': { amount: 1500, status: 'confirmed' },
  'privilege-card:5d': { amount: 2500, status: 'confirmed' },
  'privilege-card:8d': { amount: 3500, status: 'confirmed' },

  // ── Private Hair Service ─────────────────────────────────────────────────
  // Carried out in the guest's own room by the professional LunArt works with.
  'hair-service:men-cut':        { amount: 5000, status: 'confirmed' },
  'hair-service:men-beard':      { amount: 3500, status: 'confirmed' },
  'hair-service:men-cut-beard':  { amount: 7000, status: 'confirmed' },
  'hair-service:women-blowdry':  { amount: 7000, status: 'confirmed' },
  'hair-service:women-cut-blow': { amount: 9500, status: 'confirmed' },
  'hair-service:women-evening':  { amount: 9000, status: 'confirmed' },
  // Not on sale until the provider confirms it; colour and highlights are not
  // offered at all for now.
  'hair-service:ceremony':       { amount: null, status: 'to-configure' },

  // ── Breakfast ────────────────────────────────────────────────────────────
  'light-breakfast': { amount: null, status: 'to-configure' },
  'brunch:opera': {
    amount: 5000, status: 'placeholder',
    source: '€25 a persona dal listino Opera Caffè, per 2 persone. Prezzo LunArt da confermare.',
  },
  'brunch:mare': {
    amount: 5000, status: 'placeholder',
    source: '€25 a persona dal listino Opera Caffè, per 2 persone. Prezzo LunArt da confermare.',
  },

  // ── Transfer ─────────────────────────────────────────────────────────────
  'transfer-airport': {
    amount: 9000, status: 'confirmed',
    source: 'Tariffa LunArt per il transfer privato da/per l’aeroporto di Firenze.',
  },

  // ── Not yet on sale ──────────────────────────────────────────────────────
  'celebration-setup': { amount: null, status: 'to-configure' },
  'chianti-experience': { amount: null, status: 'to-configure' },
};

/**
 * Wine is priced from the carta by default, so a new bottle does not need a line
 * here. Put a bottle in this map to charge something other than the carta price —
 * an in-room margin, a promotion, a corkage.
 */
export const WINE_PRICE_OVERRIDES = {
  // 'brunello': { amount: 8500, status: 'confirmed' },
};

/**
 * Prices in force right now, which are not always the ones written above.
 *
 * The server applies its configuration at boot — the preview fills in the gaps
 * from `prices.dev.js`, production does not — and then publishes the resulting
 * table through `/api/catalog`. The browser applies that same table before it
 * renders anything, so the cart's arithmetic and the server's agree by
 * construction instead of by coincidence. The browser is still not trusted: it is
 * simply shown the same numbers it will be charged.
 */
let overrides = new Map();

export function applyPriceOverrides(table = {}) {
  overrides = new Map(Object.entries(table));
}

export const priceOverrides = () => Object.fromEntries(overrides);

/**
 * Resolve one SKU to an amount.
 * Always returns an object, so callers never have to guard on undefined.
 */
export function resolvePrice(sku) {
  const override = overrides.get(sku);
  if (override) return { ...override, sku, overridden: true };

  if (sku.startsWith('wine:')) {
    const id = sku.slice('wine:'.length);
    const override = WINE_PRICE_OVERRIDES[id];
    if (override) return { amount: override.amount, status: override.status ?? 'confirmed', source: override.source, sku };
    const bottle = getWine(id);
    if (!bottle) return { amount: null, status: 'to-configure', sku, missing: true };
    return {
      amount: bottle.sourcePrice,
      status: 'placeholder',
      source: 'Prezzo della carta vini (colonna bottiglia). Prezzo LunArt in camera da confermare.',
      sku,
    };
  }

  const entry = PRICES[sku];
  if (!entry) return { amount: null, status: 'to-configure', sku, missing: true };
  return { ...entry, sku };
}

/** True when this SKU may be sold on a server with these settings. */
export function isSellable(sku, { allowPlaceholders = false } = {}) {
  const price = resolvePrice(sku);
  if (typeof price.amount !== 'number' || price.amount <= 0) return false;
  if (price.status === PRICE_STATUS.confirmed) return true;
  return price.status === PRICE_STATUS.placeholder && allowPlaceholders;
}

/** Everything still waiting on a decision, for the review screen and the handover. */
export function pricingGaps() {
  const gaps = [];
  for (const [sku, entry] of Object.entries(PRICES)) {
    if (entry.status !== PRICE_STATUS.confirmed) {
      gaps.push({ sku, status: entry.status, amount: entry.amount, source: entry.source });
    }
  }
  for (const bottle of WINES) {
    const resolved = resolvePrice(`wine:${bottle.id}`);
    if (resolved.status !== PRICE_STATUS.confirmed) {
      gaps.push({ sku: `wine:${bottle.id}`, status: resolved.status, amount: resolved.amount, source: resolved.source });
    }
  }
  return gaps;
}

/** Every SKU in the catalogue with the amount in force, for `/api/catalog`. */
export function priceTable(skus) {
  const table = {};
  for (const sku of skus) {
    const { amount, status, source } = resolvePrice(sku);
    table[sku] = { amount, status, source };
  }
  return table;
}
