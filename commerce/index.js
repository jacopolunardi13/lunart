/**
 * The commerce layer, assembled.
 *
 * Imported unchanged by the browser and by the server. One catalogue, one set of
 * rules, one definition of what a cut-off means.
 */

export * from './schema.js';
export { PRODUCTS, PLANNED_PRODUCTS, visibleVariants, publicProduct } from './catalog.js';
export {
  WINES, WINE_KINDS, getWine, curatedWines, leadTimeMinutesFor,
  WINE_LEAD_TIME, leadMinutesForWineOrder,
} from './wine.js';
export {
  PRICES, WINE_PRICE_OVERRIDES, PRICE_STATUS, CURRENCY,
  CELEBRATION_UPGRADES, CELEBRATION_BASE_BOTTLE,
  resolvePrice, isSellable, pricingGaps, applyPriceOverrides, priceOverrides, priceTable,
} from './prices.js';
export {
  getProduct, getVariant, skuFor, cutoffFor, leadMinutesFor, needsTime,
  sanitiseLine, validateLine, priceCart, paymentModeFor,
  surchargesFor, cancellableUntil, isCancellable, offeredSlots,
} from './ordering.js';
export {
  stayDates, stayLength, isWithinStay, cardFitsStay, cardStartDates, cardVariantsForStay, asStay,
} from './stay.js';
export {
  PARTNERS, PARTNER_CATEGORIES, BENEFIT_KINDS, activePartners, getPartner,
  cardPartners, stayPartners, guestBenefit, cardBenefits, stayBenefits, allGuestBenefits,
  applyPartners, partnersInForce, validationPath, validationUrl,
} from './partners.js';
export {
  MANUAL_SCHEDULE, SERVICE_MINUTES, serviceMinutes, applySchedule, scheduleInForce,
  slotsFor, isSlotOffered, daysWithSlots,
} from './schedule.js';
export {
  checkAvailability, registerAvailabilityAdapter, getAvailabilityAdapter, availabilitySources,
} from './availability.js';
export {
  PROPERTY_TIMEZONE, propertyTimeToInstant, propertyDate, addDays, lastDayOf,
  endOfPropertyDay, isValidDate, isValidTime,
} from './time.js';

import { PRODUCTS, visibleVariants } from './catalog.js';
import { COMMERCE_CATEGORIES } from './schema.js';
import { isSellable } from './prices.js';
import { skuFor } from './ordering.js';
import { cardPartners } from './partners.js';

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

/** Every SKU a product can be bought under, including the ones not yet published. */
export function skusOf(product) {
  if (product.variants?.length) return product.variants.map((v) => skuFor(product, v));
  return [skuFor(product, null)];
}

/** The SKUs a guest can actually reach. */
export const sellableSkusOf = (product) => (
  product.variants?.length
    ? visibleVariants(product).map((v) => skuFor(product, v))
    : [skuFor(product, null)]
);

/**
 * True when a guest can actually complete a purchase of this product.
 *
 * `requiresPartners` is the rail under the Privilege Card: a card with no venue
 * behind it is an empty promise, so it is not for sale until one exists. It comes
 * back by itself the moment a partner is activated.
 */
export function isPurchasable(product, { allowPlaceholders = false } = {}) {
  if (!product?.active) return false;
  if (product.status === 'coming-soon' || product.status === 'inactive') return false;
  if (product.purchaseMode === 'request-only') return false;
  if (product.requiresPartners && cardPartners().length === 0) return false;
  return sellableSkusOf(product).some((sku) => isSellable(sku, { allowPlaceholders }));
}

/** Every SKU in the catalogue, for building the published price table. */
export const allSkus = () => [...new Set(PRODUCTS.flatMap(skusOf))];
