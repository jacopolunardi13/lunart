/** Formatting shared by every commerce screen. */

import { resolvePrice } from '../../../commerce/prices.js';

export function money(amount, { currency = 'EUR', lang = 'it' } = {}) {
  if (typeof amount !== 'number') return '';
  return new Intl.NumberFormat(lang === 'it' ? 'it-IT' : 'en-GB', {
    style: 'currency', currency, maximumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(amount / 100);
}

export function longDate(dateStr, lang = 'it') {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Intl.DateTimeFormat(lang === 'it' ? 'it-IT' : 'en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function shortDate(dateStr, lang = 'it') {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Intl.DateTimeFormat(lang === 'it' ? 'it-IT' : 'en-GB', {
    day: 'numeric', month: 'short',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** "entro 12 ore" / "entro 90 minuti" — how much notice something needs. */
export function noticeLabel(minutes, lang = 'it') {
  if (!minutes) return '';
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return lang === 'it'
      ? `${hours} ${hours === 1 ? 'ora' : 'ore'} di preavviso`
      : `${hours} ${hours === 1 ? 'hour' : 'hours'} notice`;
  }
  return lang === 'it' ? `${minutes} minuti di preavviso` : `${minutes} minutes notice`;
}

/**
 * The cheapest amount a product can be bought for, for the "from €x" on a card.
 * Returns null when nothing about it is priced.
 */
export function priceRange(product) {
  const skus = product.variants?.length
    ? product.variants.map((v) => v.sku ?? `${product.id}:${v.id}`)
    : [product.sku ?? product.id];
  const amounts = skus
    .map((sku) => resolvePrice(sku))
    .filter((p) => typeof p.amount === 'number' && p.amount > 0);
  if (amounts.length === 0) return null;
  const values = amounts.map((p) => p.amount);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    anyPlaceholder: amounts.some((p) => p.status === 'placeholder'),
  };
}

export { resolvePrice };
