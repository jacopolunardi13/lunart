/**
 * The commerce layer, assembled.
 *
 * Imported unchanged by the browser and by the server. One catalogue, one set of
 * rules, one definition of what a cut-off means.
 */

export * from './schema.js';
export { PRODUCTS, PLANNED_PRODUCTS } from './catalog.js';
export { WINES, WINE_KINDS, getWine, curatedWines, leadTimeMinutesFor, LEAD_TIME_DEFAULTS } from './wine.js';
export {
  PRICES, WINE_PRICE_OVERRIDES, PRICE_STATUS, CURRENCY,
  resolvePrice, isSellable, pricingGaps, applyPriceOverrides, priceOverrides, priceTable,
} from './prices.js';
export {
  getProduct, getVariant, skuFor, cutoffFor, leadMinutesFor,
  sanitiseLine, validateLine, priceCart, paymentModeFor,
} from './ordering.js';
export {
  checkAvailability, registerAvailabilityAdapter, getAvailabilityAdapter, availabilitySources,
} from './availability.js';
export {
  PROPERTY_TIMEZONE, propertyTimeToInstant, propertyDate, addDays, lastDayOf,
  endOfPropertyDay, isValidDate, isValidTime,
} from './time.js';

import { PRODUCTS } from './catalog.js';
import { COMMERCE_CATEGORIES } from './schema.js';
import { isSellable } from './prices.js';
import { skuFor } from './ordering.js';

/** What the shop shows, in category order, newest intent first. */
export function shopCategories() {
  return COMMERCE_CATEGORIES
    .map((category) => ({
      ...category,
      products: PRODUCTS.filter((p) => p.category === category.id && p.active),
    }))
    .filter((category) => category.products.length > 0);
}

/** The two or three things worth putting in front of a guest straight away. */
export const featuredProducts = () => PRODUCTS.filter((p) => p.active && p.featured);

/** Every SKU a product can be bought under. */
export function skusOf(product) {
  if (product.variants?.length) return product.variants.map((v) => skuFor(product, v));
  return [skuFor(product, null)];
}

/** True when a guest can actually complete a purchase of this product. */
export function isPurchasable(product, { allowPlaceholders = false } = {}) {
  if (!product?.active) return false;
  if (product.status === 'coming-soon' || product.status === 'inactive') return false;
  if (product.purchaseMode === 'request-only') return false;
  return skusOf(product).some((sku) => isSellable(sku, { allowPlaceholders }));
}

/** Every SKU in the catalogue, for building the published price table. */
export const allSkus = () => [...new Set(PRODUCTS.flatMap(skusOf))];
