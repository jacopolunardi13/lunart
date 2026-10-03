/**
 * Talking to the commerce API.
 *
 * The catalogue — including every amount — is fetched rather than imported, so the
 * prices the guide shows are the ones the server will charge. The browser keeps a
 * copy to render from and sends none of it back: a cart line is ids and dates.
 *
 * Everything degrades. If the API is not there — the guide served as static files
 * with no server behind it — the shop says so and points at the Concierge instead
 * of showing a broken checkout.
 */

import { applyPriceOverrides } from '../../commerce/prices.js';
import { applySchedule } from '../../commerce/schedule.js';

const BASE = '/api';

let catalogue = null;
let catalogueError = null;

async function request(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    signal,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error ?? `request failed (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

/**
 * Load the catalogue once per session.
 *
 * The amounts it carries are applied to the shared pricing module straight away,
 * so the cart's arithmetic in the browser and the server's at checkout come from
 * the same table rather than from two copies that might drift.
 */
export async function loadCatalogue({ force = false } = {}) {
  if (catalogue && !force) return catalogue;
  try {
    const payload = await request('/catalog');
    applyPriceOverrides(payload.prices ?? {});
    applySchedule(payload.schedule ?? null);
    catalogue = payload;
    catalogueError = null;
  } catch (error) {
    catalogueError = error;
    catalogue = null;
  }
  return catalogue;
}

export const catalogueAvailable = () => Boolean(catalogue);
export const catalogueProblem = () => catalogueError;

/** The appointment days a product has on offer, as the server published them. */
export const availableDays = (productId) => catalogue?.availability?.[productId]?.days ?? [];

/** The times free on one day. Asked for when a day is picked, never guessed. */
export const fetchSlots = (productId, date) =>
  request(`/availability/${encodeURIComponent(productId)}?date=${encodeURIComponent(date)}`);

export const priceCartRemotely = (lines) => request('/cart/price', { method: 'POST', body: { lines } });

export const startCheckout = (payload) => request('/checkout', { method: 'POST', body: payload });

export const fetchOrder = (accessToken) => request(`/orders/${encodeURIComponent(accessToken)}`);

export const fetchCard = (accessToken) => request(`/card/${encodeURIComponent(accessToken)}`);

export const validateCard = (reference, code) =>
  request('/card/validate', { method: 'POST', body: { reference, code } });
