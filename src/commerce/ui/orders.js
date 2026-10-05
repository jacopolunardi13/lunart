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
import { UI, fill } from '../../i18n.js';
import { openCustomSheet, replaceSheetBody } from '../../ui/sheet.js';
import { money, shortDate, policyText, deadlineText } from './format.js';
import { fetchOrder, cancelOrderLine } from '../api.js';
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

/**
 * One line of an order, with what can still be done about it.
 *
 * The cancel button is drawn only where the server said the line is cancellable,
 * and the deadline printed next to it is the server's own. Nothing here decides
 * either: a browser that got this wrong would offer a button the server refuses, and
 * one that got it wrong the other way would hide something the guest is entitled to.
 * The confirmation is in front of the request, not behind it, because this is the
 * one button in the guide that moves money.
 */
function orderLine(line, index, order, lang) {
  const when = [line.date ? shortDate(line.date, lang) : '', line.time ?? ''].filter(Boolean).join(' · ');
  const state = line.cancellation ?? {};
  const gone = Number(state.cancelled_quantity ?? 0);
  const refunded = Number(state.refunded_amount ?? 0);

  return `<li class="cart-line${gone ? ' cart-line--cancelled' : ''}">
    <div class="cart-line__main">
      <p class="cart-line__title">${esc(line.title)}${line.quantity > 1 ? ` ×${line.quantity}` : ''}</p>
      ${line.variant_title ? `<p class="cart-line__variant">${esc(line.variant_title)}</p>` : ''}
      ${when ? `<p class="cart-line__when">${esc(when)}</p>` : ''}
      ${gone ? `<p class="cart-line__note">${esc(refunded
        ? fill(UI[lang].cancelledRefunded, { amount: money(refunded, { lang, currency: order.currency }) })
        : UI[lang].cancelledLine)}</p>` : ''}
      ${state.cancellable ? `<p class="cart-line__note">${esc(state.deadline
        ? `${UI[lang].cancelFreeUntil} ${deadlineText(state.deadline, lang)}`
        : policyText(state.policy, lang))}</p>` : ''}
      ${!state.cancellable && !gone && state.blocked === 'past-deadline'
        ? `<p class="cart-line__note">${esc(UI[lang].cancelDeadlinePassed)}</p>` : ''}
    </div>
    <span class="cart-line__amount">${esc(money(line.amount, { lang, currency: order.currency }))}</span>
    ${state.cancellable ? `<button class="cart-line__cancel" type="button"
      data-cancel-line="${index}"
      data-cancel-amount="${esc(state.refundable_amount ?? 0)}"
      data-cancel-settlement="${esc(state.settlement ?? 'none')}">${esc(UI[lang].cancelThis)}</button>` : ''}
  </li>`;
}

function orderBody(order, lang) {
  const lines = order.lines.map((line, index) => orderLine(line, index, order, lang)).join('');

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
    ${order.refunded_amount > 0 && order.status !== 'refunded' ? `<div class="cart-total cart-total--muted">
      <span>${esc(UI[lang].partlyRefunded)}</span>
      <strong>${esc(money(order.refunded_amount, { lang, currency: order.currency }))}</strong>
    </div>` : ''}

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
    container.addEventListener('click', async (event) => {
      const card = event.target.closest('[data-card]');
      if (card) { onCard?.(card.dataset.card); return; }

      const cancel = event.target.closest('[data-cancel-line]');
      if (!cancel) return;

      /**
       * Ask first, in the terms the guest will actually experience.
       *
       * "Ti rimborsiamo €49" and "liberiamo l'autorizzazione di €90" are different
       * promises and only one of them involves waiting for a bank, so the question
       * says which one this is. The amount comes from the server's own figure.
       */
      const settlement = cancel.dataset.cancelSettlement;
      const amount = money(Number(cancel.dataset.cancelAmount) || 0, { lang, currency: order.currency });
      const detail = settlement === 'refund' ? fill(UI[lang].cancelConfirmRefund, { amount })
        : settlement === 'release' ? fill(UI[lang].cancelConfirmRelease, { amount })
          : UI[lang].cancelConfirmNothing;
      if (!window.confirm(`${UI[lang].cancelConfirmTitle}\n\n${detail}`)) return;

      cancel.disabled = true;
      try {
        const result = await cancelOrderLine(accessToken, Number(cancel.dataset.cancelLine));
        order = result.order;
        replaceSheetBody({
          title: UI[lang].yourOrder,
          body: `${order.can_cancel || order.status === 'paid'
            ? `<div class="notice"><p>${esc(UI[lang].cancelDonePartial)}</p></div>` : ''}${orderBody(order, lang)}`,
          onMount: wire,
        });
      } catch (error) {
        cancel.disabled = false;
        const reason = error.payload?.error;
        cancel.insertAdjacentHTML('afterend', `<p class="cart-line__note cart-line__note--bad">${esc(
          reason === 'past-deadline' ? UI[lang].cancelDeadlinePassed : UI[lang].cancelFailed,
        )}</p>`);
      }
    });
  };

  let order = null;
  fetchOrder(accessToken)
    .then((loaded) => {
      order = loaded;
      /**
       * The basket is not this screen's business any more.
       *
       * It used to be emptied here, which was both the wrong place and quietly
       * broken: the comparison was against an object and the function it called did
       * not exist, so the branch never ran — and would have thrown if it had.
       * `settleCheckout` does it properly, on every start rather than only when an
       * order sheet happens to be opened, and against a fingerprint of the basket
       * that actually paid. See the top of this file.
       */
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
      <span class="status-pill" data-tone="${esc(TONE[order.status] ?? 'muted')}">${esc(
        order.refunded_amount > 0 && order.status !== 'refunded'
          ? UI[lang].partlyRefunded
          : statusText(order.status, lang),
      )}</span>
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
