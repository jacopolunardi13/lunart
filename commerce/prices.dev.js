/**
 * Prices for the preview only. Never loaded in production.
 *
 * The products with no commercial terms yet cannot be exercised end to end —
 * you cannot test a card purchase that refuses to be bought. This file fills those
 * gaps with figures that are obviously not real, so the flow can be walked through
 * without anyone mistaking a test value for a decision. €1.00 is not a price for an
 * eight-day privilege card, and that is the point.
 *
 * Loaded only when LUNART_DEV_PRICES=1, which `npm run dev` and the tests set and
 * a production server does not.
 */

export const DEV_PRICES = {
  'privilege-card:2d': { amount: 100, status: 'placeholder', source: 'VALORE DI PROVA — non commerciale' },
  'privilege-card:5d': { amount: 200, status: 'placeholder', source: 'VALORE DI PROVA — non commerciale' },
  'privilege-card:8d': { amount: 300, status: 'placeholder', source: 'VALORE DI PROVA — non commerciale' },
  'light-breakfast':   { amount: 100, status: 'placeholder', source: 'VALORE DI PROVA — non commerciale' },
};
