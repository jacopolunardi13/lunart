/**
 * What a guest bought, and what happened to it.
 *
 * Order tokens are kept in this browser rather than behind a login. A guest who
 * has already checked in should not have to make an account to find out whether
 * a driver confirmed — the link they were given is enough, and the token only
 * ever reveals their own order.
 */

import { esc } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { UI } from '../../i18n.js';
import { openCustomSheet, replaceSheetBody } from '../../ui/sheet.js';
import { money, shortDate } from './format.js';
import { fetchOrder } from '../api.js';
import { clear as clearCart } from '../cart.js';

const STORAGE_KEY = 'lunart.orders.v1';
const PENDING_KEY = 'lunart.checkout-pending.v1';

/** Noted when a guest leaves for the payment page, cleared when the order lands. */
export function markCheckoutPending(token) {
  try { localStorage.setItem(PENDING_KEY, token); } catch { /* ignore */ }
}

const pendingCheckout = () => {
  try { return localStorage.getItem(PENDING_KEY); } catch { return null; }
};

const clearPending = () => {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
};

/** States that mean the guest is committed: the basket's work is done. */
const WENT_THROUGH = new Set(['authorized', 'confirmed', 'paid']);

export function rememberedOrders() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((token) => typeof token === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberOrder(token) {
  if (!token) return;
  const tokens = rememberedOrders().filter((existing) => existing !== token);
  tokens.unshift(token);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens.slice(0, 20))); } catch { /* ignore */ }
}

/** Plain words for a payment state, from the guest's side of it. */
const STATUS_TEXT = {
  it: {
    pending: 'In attesa di pagamento',
    authorized: 'Autorizzato — in attesa di conferma',
    confirmed: 'Confermato',
    paid: 'Confermato e pagato',
    cancelled: 'Annullato — nessun addebito',
    refunded: 'Rimborsato',
    failed: 'Pagamento non riuscito',
  },
  en: {
    pending: 'Waiting for payment',
    authorized: 'Authorised — awaiting confirmation',
    confirmed: 'Confirmed',
    paid: 'Confirmed and paid',
    cancelled: 'Cancelled — nothing charged',
    refunded: 'Refunded',
    failed: 'Payment did not go through',
  },
};

const TONE = {
  paid: 'good', confirmed: 'good',
  authorized: 'waiting', pending: 'waiting',
  cancelled: 'muted', refunded: 'muted',
  failed: 'bad',
};

export const statusText = (status, lang) => STATUS_TEXT[lang]?.[status] ?? status;

function orderBody(order, lang) {
  const lines = order.lines.map((line) => {
    const when = [line.date ? shortDate(line.date, lang) : '', line.time ?? ''].filter(Boolean).join(' · ');
    return `<li class="cart-line">
      <div class="cart-line__main">
        <p class="cart-line__title">${esc(line.title)}${line.quantity > 1 ? ` ×${line.quantity}` : ''}</p>
        ${line.variant_title ? `<p class="cart-line__variant">${esc(line.variant_title)}</p>` : ''}
        ${when ? `<p class="cart-line__when">${esc(when)}</p>` : ''}
      </div>
      <span class="cart-line__amount">${esc(money(line.amount, { lang, currency: order.currency }))}</span>
    </li>`;
  }).join('');

  const cards = (order.entitlements ?? []).map((card) => `
    <button class="card" type="button" data-card="${esc(card.access_token)}">
      <span class="card__icon">${icon('card', 22)}</span>
      <span class="card__body">
        <span class="card__title">${esc(UI[lang].myCard)}</span>
        <span class="card__summary">${esc(card.holder)} · ${esc(UI[lang].validUntil)} ${esc(shortDate(card.end_date, lang))}</span>
      </span>
      <span class="card__chevron">${icon('chevron', 16)}</span>
    </button>`).join('');

  return `
    <p class="status-pill" data-tone="${esc(TONE[order.status] ?? 'muted')}">${esc(statusText(order.status, lang))}</p>

    ${order.status === 'authorized' ? `<div class="notice notice--attention">
      <span>${icon('clock', 18)}</span>
      <p>${esc(UI[lang].awaitingProviderNote)}</p>
    </div>` : ''}
    ${order.status === 'cancelled' && order.provider?.status === 'declined' ? `<div class="notice">
      <p>${esc(UI[lang].providerDeclinedNote)}${order.provider.note ? ` — ${esc(order.provider.note)}` : ''}</p>
    </div>` : ''}

    <ul class="cart-lines">${lines}</ul>
    <div class="cart-total">
      <span>${esc(order.status === 'authorized' ? UI[lang].authorisedAmount : UI[lang].total)}</span>
      <strong>${esc(money(order.amount, { lang, currency: order.currency }))}</strong>
    </div>

    ${cards ? `<h3 class="checkout-form__heading">${esc(UI[lang].yourCard)}</h3><div class="cards">${cards}</div>` : ''}

    <p class="terms">${esc(UI[lang].orderReference)} ${esc(order.reference)}</p>`;
}

/** Open one order, loading it first. */
export function openOrderSheet(accessToken, { lang, onCard }) {
  rememberOrder(accessToken);

  openCustomSheet({
    title: UI[lang].yourOrder,
    body: `<p class="sheet__lead">${esc(UI[lang].loading)}</p>`,
    lang,
    id: `order:${accessToken}`,
  });

  const wire = (container) => {
    container.addEventListener('click', (event) => {
      const button = event.target.closest('[data-card]');
      if (button) onCard?.(button.dataset.card);
    });
  };

  fetchOrder(accessToken)
    .then((order) => {
      // Only the basket that produced *this* order is emptied, and only once it
      // has actually gone through. Re-opening an old order later leaves a new
      // basket alone.
      if (pendingCheckout() === accessToken && WENT_THROUGH.has(order.status)) {
        clearCart();
        clearPending();
      }
      replaceSheetBody({ title: UI[lang].yourOrder, body: orderBody(order, lang), onMount: wire });
    })
    .catch(() => replaceSheetBody({
      title: UI[lang].yourOrder,
      body: `<p class="sheet__lead">${esc(UI[lang].orderNotFound)}</p>`,
    }));
}

/** The list, for the guide. Empty when this browser has bought nothing. */
export async function purchasesBlock(lang) {
  const tokens = rememberedOrders();
  if (tokens.length === 0) return '';

  const orders = (await Promise.all(tokens.map((token) =>
    fetchOrder(token).then((order) => ({ ...order, token })).catch(() => null)))).filter(Boolean);
  if (orders.length === 0) return '';

  const cards = orders.map((order) => `
    <button class="card" type="button" data-order="${esc(order.token)}">
      <span class="card__icon">${icon('receipt', 22)}</span>
      <span class="card__body">
        <span class="card__title">${esc(order.lines.map((l) => l.title).join(', '))}</span>
        <span class="card__summary">${esc(statusText(order.status, lang))} · ${esc(money(order.amount, { lang, currency: order.currency }))}</span>
      </span>
      <span class="card__chevron">${icon('chevron', 16)}</span>
    </button>`).join('');

  return `<section class="section" aria-labelledby="h-purchases">
    <div class="section__head">
      <span style="color:var(--accent)">${icon('receipt', 20)}</span>
      <h2 id="h-purchases">${esc(UI[lang].myPurchases)}</h2>
    </div>
    <div class="cards">${cards}</div>
  </section>`;
}
