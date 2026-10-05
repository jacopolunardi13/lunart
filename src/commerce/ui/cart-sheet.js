/**
 * The basket, and the one form between it and paying.
 *
 * Checkout asks for the least it can: a name, an email to send the confirmation
 * to, a phone number if something needs delivering or driving. No account, no
 * password, no address — a guest who is already staying here has told us all of
 * that once.
 */

import { esc, t } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { UI } from '../../i18n.js';
import { openCustomSheet, replaceSheetBody, closeSheet } from '../../ui/sheet.js';
import { money, shortDate } from './format.js';
import { errorText, knownError } from './product-sheet.js';
import * as cart from '../cart.js';
import { startCheckout } from '../api.js';
import { rememberOrder, markCheckoutPending } from './orders.js';
import { looksLikeEmail } from '../../../commerce/ordering.js';

function lineRow(entry, lang) {
  const { product, variant, line } = entry;
  const slot = (product.deliverySlots ?? []).find((s) => s.id === line.slotId);
  const when = [
    line.date ? shortDate(line.date, lang) : '',
    slot ? t(slot.label, lang) : line.time ?? '',
    line.room ? `${UI[lang].roomShort} ${line.room}` : '',
  ].filter(Boolean).join(' · ');

  return `<li class="cart-line${entry.ok ? '' : ' cart-line--bad'}">
    <div class="cart-line__main">
      <p class="cart-line__title">${esc(t(product.title, lang))}</p>
      ${variant ? `<p class="cart-line__variant">${esc(t(variant.title, lang))}</p>` : ''}
      ${when ? `<p class="cart-line__when">${esc(when)}</p>` : ''}
      ${entry.errors.length
        ? `<p class="cart-line__error">${esc(errorText(entry.errors[0].code, lang))}</p>` : ''}
    </div>
    <div class="cart-line__side">
      <span class="cart-line__amount">${esc(money(entry.amount || entry.unit * line.quantity, { lang }))}</span>
      <div class="stepper">
        <button type="button" class="stepper__button" data-step="-1" data-index="${entry.index}"
          aria-label="${esc(UI[lang].decrease)}">−</button>
        <span class="stepper__value" aria-live="polite">${line.quantity}</span>
        <button type="button" class="stepper__button" data-step="1" data-index="${entry.index}"
          aria-label="${esc(UI[lang].increase)}">+</button>
      </div>
      <button type="button" class="cart-line__remove" data-remove="${entry.index}">${esc(UI[lang].remove)}</button>
    </div>
  </li>`;
}

function body(lang) {
  const review = cart.review();

  if (review.empty) {
    return `<p class="sheet__lead">${esc(UI[lang].cartEmpty)}</p>
      <div class="actions">
        <button class="action action--primary" type="button" data-shop>${icon('gift', 16)}${esc(UI[lang].seeAllExtras)}</button>
      </div>`;
  }

  return `
    <ul class="cart-lines">${review.lines.map((entry) => lineRow(entry, lang)).join('')}</ul>

    <div class="cart-total">
      <span>${esc(UI[lang].total)}</span>
      <strong>${esc(money(review.total, { lang }))}</strong>
    </div>

    ${review.ok ? '' : `<p class="form-errors form-errors--block">${esc(UI[lang].cartNeedsFixing)}</p>`}

    <form class="checkout-form" novalidate ${review.ok ? '' : 'data-blocked'}>
      <h3 class="checkout-form__heading">${esc(UI[lang].yourDetails)}</h3>

      <label class="field">
        <span class="field__label">${esc(UI[lang].fullName)}</span>
        <input type="text" name="name" required autocomplete="name">
      </label>
      <label class="field">
        <span class="field__label">${esc(UI[lang].email)}</span>
        <input type="email" name="email" required autocomplete="email" inputmode="email">
        <span class="field__hint">${esc(UI[lang].emailHint)}</span>
      </label>
      <label class="field">
        <span class="field__label">${esc(UI[lang].phone)} <span class="field__optional">${esc(UI[lang].optional)}</span></span>
        <input type="tel" name="phone" autocomplete="tel" inputmode="tel">
      </label>
      <label class="field field--inline">
        <span class="field__label">${esc(UI[lang].roomNumber)} <span class="field__optional">${esc(UI[lang].optional)}</span></span>
        <input type="text" name="room" inputmode="numeric" maxlength="6" placeholder="303">
      </label>

      ${review.lines.some((l) => l.product.purchaseMode === 'authorize-then-capture')
        ? `<div class="notice notice--attention">
            <span>${icon('alert', 18)}</span>
            <p>${esc(UI[lang].authorisationNotice)}</p>
          </div>` : ''}

      <div class="actions">
        <button class="action action--primary" type="submit" ${review.ok ? '' : 'disabled'}>
          ${icon('card', 16)}<span>${esc(UI[lang].goToPayment)}</span>
        </button>
      </div>
      <p class="checkout-form__status" data-status role="status"></p>
    </form>`;
}

function mount(container, lang, { onShop }) {
  const rerender = () => replaceSheetBody({ body: body(lang), onMount: (next) => mount(next, lang, { onShop }) });

  container.addEventListener('click', (event) => {
    const step = event.target.closest('[data-step]');
    if (step) {
      const index = Number(step.dataset.index);
      const current = cart.getLines()[index];
      if (current) cart.setQuantity(index, current.quantity + Number(step.dataset.step));
      rerender();
      return;
    }
    const remove = event.target.closest('[data-remove]');
    if (remove) { cart.remove(Number(remove.dataset.remove)); rerender(); return; }
    if (event.target.closest('[data-shop]')) { closeSheet(); onShop?.(); }
  });

  const form = container.querySelector('.checkout-form');
  if (!form) return;
  const status = form.querySelector('[data-status]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const customer = {
      name: String(data.get('name') ?? '').trim(),
      email: String(data.get('email') ?? '').trim(),
      phone: String(data.get('phone') ?? '').trim(),
      room: String(data.get('room') ?? '').trim(),
    };
    if (!customer.name || !customer.email) {
      status.textContent = UI[lang].detailsMissing;
      return;
    }
    // Checked here so the guest hears it immediately, and again on the server so
    // this is a courtesy rather than the rule.
    if (!looksLikeEmail(customer.email)) {
      status.textContent = UI[lang].emailInvalid;
      form.querySelector('[name="email"]')?.focus();
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    status.textContent = UI[lang].sendingToPayment;

    try {
      const result = await startCheckout({ lines: cart.payload(), customer, lang });
      // Remembered before leaving, so the order is findable even if the guest
      // never comes back through the success URL. The basket is kept until the
      // order is known to have gone through: a guest who backs out at the payment
      // page should find it exactly as they left it.
      rememberOrder(result.accessToken);
      markCheckoutPending(result.accessToken, cart.fingerprint());
      location.href = result.checkoutUrl;
    } catch (error) {
      button.disabled = false;
      /**
       * A refusal the guest can act on is shown in their own words.
       *
       * "availability-temporarily-unavailable" in particular has to read as "try
       * again in a minute" rather than as a fault, because that is exactly what it
       * is: the appointment could not be confirmed, so nothing was charged.
       */
      const topLevel = knownError(error.payload?.error, lang);
      const detail = error.payload?.errors?.[0];
      if (topLevel) status.textContent = topLevel;
      else if (detail) status.textContent = `${UI[lang].checkoutRefused} ${errorText(detail.code, lang)}`;
      else status.textContent = `${UI[lang].checkoutFailed} ${error.message}`;
    }
  });
}

export function openCartSheet({ lang, onShop }) {
  return openCustomSheet({
    title: UI[lang].cart,
    body: body(lang),
    lang,
    id: 'cart',
    onMount: (container) => mount(container, lang, { onShop }),
  });
}
