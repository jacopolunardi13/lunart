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
import { guestPurchases } from '../../guest.js';

const STORAGE_KEY = 'lunart.orders.v1';
const PENDING_KEY = 'lunart.checkout-pending.v1';

/**
 * Noted when a guest leaves for the payment page.
 *
 * Together with a fingerprint of the basket that produced it, which is the part
 * that matters. A guest who pays for wine, comes back, and then puts a brunch in
 * the basket before opening last night's order must not have the brunch thrown
 * away: the order that committed emptied *its* basket, not whatever is in there
 * now. So the basket is only cleared while it still looks like the one that was
 * paid for.
 */
export function markCheckoutPending(token, fingerprint = '') {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ token, fingerprint }));
  } catch { /* ignore */ }
}

const pendingCheckout = () => {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    // Older clients stored the bare token; read both rather than lose a basket.
    const parsed = raw.startsWith('{') ? JSON.parse(raw) : { token: raw, fingerprint: '' };
    return parsed?.token ? parsed : null;
  } catch {
    return null;
  }
};

const clearPending = () => {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
};

/** States that mean the guest is committed: the basket's work is done. */
const WENT_THROUGH = new Set(['authorized', 'confirmed', 'paid']);
/** And the ones that mean it is over without a sale. The basket stays as it was. */
const FINISHED_WITHOUT = new Set(['cancelled', 'failed', 'refunded']);

/**
 * Settle the basket against the order the guest just went to pay for.
 *
 * Called on every start, not only on the return from Stripe, because the return is
 * the one journey that cannot be relied on: a guest closes the tab on the payment
 * page, pays on another device, or comes back through a bookmark. Whatever the
 * route, the next time this app starts it asks the server what happened to that
 * order and acts on the answer.
 *
 * Fetching the order is also what triggers the server's own reconciliation against
 * Stripe, so this doubles as the nudge that moves a stranded `pending` order to
 * `paid` when the webhook has not arrived.
 */
export async function settleCheckout({ cart }) {
  const pending = pendingCheckout();
  if (!pending) return { settled: false };

  let order;
  try {
    order = await fetchOrder(pending.token);
  } catch {
    // Offline, or the server is having a moment. Keep the marker and try later.
    return { settled: false, reason: 'unreachable' };
  }

  if (WENT_THROUGH.has(order.status)) {
    // Only this basket. A different one belongs to a different intention.
    if (!pending.fingerprint || pending.fingerprint === cart.fingerprint()) cart.clear();
    clearPending();
    return { settled: true, status: order.status, token: pending.token, cleared: true };
  }

  if (FINISHED_WITHOUT.has(order.status)) {
    // Nothing was bought, so nothing is taken away: the guest may want to retry.
    clearPending();
    return { settled: true, status: order.status, token: pending.token, cleared: false };
  }

  return { settled: false, status: order.status, token: pending.token };
}

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
/**
 * Everything this guest has bought.
 *
 * On a personal link the server answers, because the server is the only place that
 * knows: it has the orders filed against this reservation, so a guest who ordered
 * on the laptop and opened the link on their phone sees the same list, and a guest
 * who cleared their browser has lost nothing. What this browser remembers is a
 * cache and a fallback — it is what the public guide has instead, where a sale
 * belongs to a person rather than to a booking.
 *
 * Both paths are merged by access token, so an order that is in the stay *and* in
 * this browser is one row, not two.
 */
async function ordersToShow() {
  const fromStay = guestPurchases().map((order) => ({ ...order, token: order.access_token }));
  const known = new Set(fromStay.map((order) => order.token));

  const extra = (await Promise.all(
    rememberedOrders()
      .filter((token) => !known.has(token))
      .map((token) => fetchOrder(token).then((order) => ({ ...order, token })).catch(() => null)),
  )).filter(Boolean);

  return [...fromStay, ...extra];
}

/**
 * One purchase, as a row.
 *
 * What a guest wants from this list is "did it go through, what was it, when, how
 * much" — in that order, because the first is the one they came to check.
 */
function purchaseRow(order, lang) {
  const when = order.lines
    .map((line) => [line.date ? shortDate(line.date, lang) : '', line.time ?? ''].filter(Boolean).join(' '))
    .filter(Boolean)[0] ?? '';
  const what = order.lines
    .map((line) => (line.quantity > 1 ? `${line.title} ×${line.quantity}` : line.title))
    .join(' · ');

  return `<button class="purchase" type="button" data-order="${esc(order.token)}">
    <span class="purchase__head">
      <span class="purchase__what">${esc(what)}</span>
      <span class="purchase__amount">${esc(money(order.amount, { lang, currency: order.currency }))}</span>
    </span>
    <span class="purchase__meta">
      <span class="status-pill" data-tone="${esc(TONE[order.status] ?? 'muted')}">${esc(statusText(order.status, lang))}</span>
      ${when ? `<span class="purchase__when">${esc(when)}</span>` : ''}
      ${order.reference ? `<span class="purchase__ref mono">${esc(order.reference)}</span>` : ''}
    </span>
  </button>`;
}

export async function purchasesBlock(lang) {
  const orders = await ordersToShow();
  if (orders.length === 0) return '';

  return `<section class="section" aria-labelledby="h-purchases">
    <div class="section__head">
      <span style="color:var(--accent)">${icon('receipt', 20)}</span>
      <h2 id="h-purchases">${esc(UI[lang].myPurchases)}</h2>
    </div>
    <div class="purchases">${orders.map((order) => purchaseRow(order, lang)).join('')}</div>
  </section>`;
}
