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
  // No wash service: hair should already be washed, and the professional damps it
  // down with his own spray where the cut needs it.
  'hair-service:men-cut':        { amount: 4900, status: 'confirmed' },
  'hair-service:men-beard':      { amount: 3500, status: 'confirmed' },
  'hair-service:men-cut-beard':  { amount: 6900, status: 'confirmed' },
  'hair-service:women-blowdry':  { amount: 7900, status: 'confirmed' },
  'hair-service:women-cut-blow': { amount: 9500, status: 'confirmed' },
  'hair-service:women-evening':  { amount: 8900, status: 'confirmed' },
  // Not shown and not on sale until the provider confirms it. Colour and
  // highlights are not offered at all, which is why no SKU exists for them.
  'hair-service:ceremony':       { amount: null, status: 'to-configure' },

  // ── Breakfast ────────────────────────────────────────────────────────────
  // Both are for two people. The room already has a Nespresso machine and a
  // kettle, so the light breakfast brings no hot drink; the brunch carries the
  // juice and hot drink from the Opera menu.
  'light-breakfast': { amount: 4900, status: 'confirmed' },
  'brunch:opera':    { amount: 6900, status: 'confirmed' },
  'brunch:mare':     { amount: 6900, status: 'confirmed' },
  /** Arranged by asking, for an early departure. No price has been set. */
  'sunrise-breakfast': { amount: null, status: 'to-configure' },

  // ── Transfer ─────────────────────────────────────────────────────────────
  'transfer-airport': {
    amount: 9000, status: 'confirmed',
    source: 'Tariffa LunArt per il transfer privato da/per l’aeroporto di Firenze.',
  },
  /** Per oversized or extra large item, beyond the standard allowance. */
  'transfer-airport:oversized': { amount: 1500, status: 'confirmed' },

  // ── Luggage transfer ─────────────────────────────────────────────────────
  'luggage-transfer:smn':     { amount: 5000,  status: 'confirmed' },
  'luggage-transfer:centro':  { amount: 6000,  status: 'confirmed' },
  'luggage-transfer:airport': { amount: 9000,  status: 'confirmed' },
  'luggage-transfer:comune':  { amount: 10000, status: 'confirmed' },
  'luggage-transfer:oversized': { amount: 1500, status: 'confirmed' },

  // ── Romantic and celebration set-ups ─────────────────────────────────────
  'celebration:romantic':  { amount: 12900, status: 'confirmed' },
  'celebration:signature': { amount: 21900, status: 'confirmed' },
  'celebration:champagne': { amount: 27900, status: 'confirmed' },
  // The two champagne upgrades are not written down: they are the difference
  // between the bottle in the package and the one being asked for, so changing a
  // wine price changes the upgrade with it. See `upgradePrice` below.

  // ── Not yet on sale ──────────────────────────────────────────────────────
  'chianti-experience': { amount: null, status: 'to-configure' },
};

/**
 * What LunArt charges for a bottle in the room.
 *
 * These are selling prices confirmed by LunArt, which is why they live here rather
 * than being derived from the carta. A bottle with no entry falls back to the carta
 * figure as a placeholder, so it renders and says the price is unconfirmed instead
 * of being sold at a number nobody agreed to.
 */
export const WINE_PRICE_OVERRIDES = {
  'chianti-barrique':   { amount: 3900 },
  'chianti-riserva':    { amount: 6500 },
  amarone:              { amount: 7500 },
  bolgheri:             { amount: 7900 },
  brunello:             { amount: 8900 },
  vermentino:           { amount: 4300 },
  chardonnay:           { amount: 4500 },
  vernaccia:            { amount: 5900 },
  'rose-fermo':         { amount: 5500 },
  'prosecco-cuvee':     { amount: 5500 },
  'franciacorta-saten': { amount: 10500 },
  'moet-chandon':       { amount: 15900 },
  'ruinart-bdb':        { amount: 29900 },
  'dom-perignon':       { amount: 59000 },
};

/**
 * The bottle a celebration package includes, and what an upgrade costs.
 *
 * The Champagne Celebration comes with Moët & Chandon. Asking for Ruinart or Dom
 * Pérignon instead costs the difference between the two bottles — not a number
 * typed in twice. `celebration:upgrade-<wineId>` resolves through here, so the
 * upgrade follows the wine list by construction.
 */
export const CELEBRATION_BASE_BOTTLE = { champagne: 'moet-chandon' };
export const CELEBRATION_UPGRADES = { champagne: ['ruinart-bdb', 'dom-perignon'] };

function upgradePrice(sku) {
  const wineId = sku.slice('celebration:upgrade-'.length);
  const tier = Object.keys(CELEBRATION_UPGRADES).find((key) => CELEBRATION_UPGRADES[key].includes(wineId));
  if (!tier) return { amount: null, status: 'to-configure', sku, missing: true };
  const wanted = resolvePrice(`wine:${wineId}`);
  const included = resolvePrice(`wine:${CELEBRATION_BASE_BOTTLE[tier]}`);
  if (typeof wanted.amount !== 'number' || typeof included.amount !== 'number') {
    return { amount: null, status: 'to-configure', sku, missing: true };
  }
  const bothConfirmed = wanted.status === PRICE_STATUS.confirmed && included.status === PRICE_STATUS.confirmed;
  return {
    amount: Math.max(0, wanted.amount - included.amount),
    status: bothConfirmed ? PRICE_STATUS.confirmed : PRICE_STATUS.placeholder,
    source: `Differenza fra ${wineId} e ${CELEBRATION_BASE_BOTTLE[tier]} nella selezione vini.`,
    derived: true,
    sku,
  };
}

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

  if (sku.startsWith('celebration:upgrade-')) return upgradePrice(sku);

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
  for (const list of Object.values(CELEBRATION_UPGRADES)) {
    for (const wineId of list) {
      const sku = `celebration:upgrade-${wineId}`;
      const resolved = resolvePrice(sku);
      if (resolved.status !== PRICE_STATUS.confirmed) {
        gaps.push({ sku, status: resolved.status, amount: resolved.amount, source: resolved.source });
      }
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
