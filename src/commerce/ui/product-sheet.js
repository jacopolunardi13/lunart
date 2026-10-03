/**
 * One product, and the choices it needs before it can go in the basket.
 *
 * The form rebuilds its own summary as choices change, so a guest sees the price
 * and the deadline move when they pick a different bottle or a different evening
 * rather than finding out at checkout. The deadline is real: it comes from the
 * same `cutoffFor` the server uses to refuse the order.
 */

import { esc, t, paragraphs } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { UI } from '../../i18n.js';
import { openCustomSheet } from '../../ui/sheet.js';
import { money, longDate, noticeLabel, priceRange } from './format.js';
import { getProduct, getVariant, skuFor, cutoffFor, leadMinutesFor, validateLine } from '../../../commerce/ordering.js';
import { resolvePrice } from '../../../commerce/prices.js';
import { propertyDate, addDays } from '../../../commerce/time.js';
import { availableDays, fetchSlots } from '../api.js';
import { WINE_KINDS } from '../../../commerce/wine.js';
import * as cart from '../cart.js';

const ERROR_TEXT = {
  it: {
    'variant-required': 'Scegli un’opzione.',
    'quantity-out-of-range': 'Quantità non valida.',
    'date-required': 'Scegli una data.',
    'date-in-past': 'Quella data è già passata.',
    'slot-required': 'Scegli una fascia oraria.',
    'time-required': 'Indica un orario.',
    'room-required': 'Dicci il numero della camera.',
    'option-required': 'Manca una scelta.',
    'option-invalid': 'Quella scelta non è disponibile.',
    'field-required': 'Campo obbligatorio.',
    'field-out-of-range': 'Valore fuori intervallo.',
    'past-cutoff': 'Troppo tardi per questa data: scegline una successiva.',
    'slot-unavailable': 'Quell’orario non è libero. Scegline un altro.',
    'price-not-set': 'Non è ancora acquistabile.',
    'price-not-confirmed': 'Prezzo non ancora confermato.',
    'not-on-sale': 'Non è ancora acquistabile.',
    'request-only': 'Si organizza parlando con noi.',
    'product-inactive': 'Non disponibile.',
    'unknown-product': 'Prodotto sconosciuto.',
  },
  en: {
    'variant-required': 'Pick an option.',
    'quantity-out-of-range': 'That quantity is not available.',
    'date-required': 'Choose a date.',
    'date-in-past': 'That date has gone.',
    'slot-required': 'Choose a time window.',
    'time-required': 'Give a time.',
    'room-required': 'Tell us your room number.',
    'option-required': 'Something still needs choosing.',
    'option-invalid': 'That choice is not available.',
    'field-required': 'This is needed.',
    'field-out-of-range': 'Out of range.',
    'past-cutoff': 'Too late for that date — pick a later one.',
    'slot-unavailable': 'That time is not free. Pick another.',
    'price-not-set': 'Not on sale yet.',
    'price-not-confirmed': 'Price not confirmed yet.',
    'not-on-sale': 'Not on sale yet.',
    'request-only': 'Arranged by talking to us.',
    'product-inactive': 'Not available.',
    'unknown-product': 'Unknown product.',
  },
};

const errorText = (code, lang) => ERROR_TEXT[lang]?.[code] ?? ERROR_TEXT.it[code] ?? code;

function variantPicker(product, lang, selected) {
  if (!product.variants?.length) return '';

  // Wine has eleven variants in four colours; a flat list of radio buttons would
  // be a wall. Everything else has two or three and reads better as chips.
  if (product.id === 'wine-in-room') {
    const groups = {};
    for (const variant of product.variants) {
      (groups[variant.meta?.kind ?? 'other'] ??= []).push(variant);
    }
    const options = Object.entries(groups).map(([kind, variants]) => `
      <optgroup label="${esc(t(WINE_KINDS[kind] ?? { it: kind, en: kind }, lang))}">
        ${variants.map((v) => {
          const price = resolvePrice(skuFor(product, v));
          return `<option value="${esc(v.id)}" ${v.id === selected ? 'selected' : ''}>
            ${esc(t(v.title, lang))} — ${esc(money(price.amount, { lang }))}</option>`;
        }).join('')}
      </optgroup>`).join('');
    return `<label class="field">
      <span class="field__label">${esc(UI[lang].chooseBottle)}</span>
      <select name="variantId" required>${options}</select>
    </label>`;
  }

  return `<fieldset class="field">
    <legend class="field__label">${esc(UI[lang].chooseOption)}</legend>
    <div class="chips chips--inline">
      ${product.variants.map((variant) => {
        const price = resolvePrice(skuFor(product, variant));
        const sellable = typeof price.amount === 'number' && price.amount > 0;
        return `<label class="chip chip--choice${sellable ? '' : ' chip--unavailable'}">
          <input type="radio" name="variantId" value="${esc(variant.id)}"
            ${variant.id === selected ? 'checked' : ''} ${sellable ? '' : 'disabled'}>
          <span>${esc(t(variant.title, lang))}${sellable
            ? ` · ${esc(money(price.amount, { lang }))}`
            : ` · ${esc(UI[lang].onRequestBadge)}`}</span>
        </label>`;
      }).join('')}
    </div>
  </fieldset>`;
}

/**
 * The earliest date still orderable.
 *
 * For anything with an evening-before cut-off that is tomorrow once tonight's
 * deadline has passed, so the date field cannot offer a day the server will refuse.
 */
function earliestDate(product, variant) {
  const today = propertyDate();
  if (product.cutoff?.kind !== 'eveningBefore') return today;
  const { deadline } = cutoffFor(product, variant, { date: today });
  return deadline && new Date() > deadline ? addDays(today, 1) : today;
}

function fieldsFor(product, lang, values = {}) {
  return (product.requiresFields ?? []).map((field) => {
    const common = `name="field:${esc(field.id)}" ${field.required ? 'required' : ''}`;
    const value = esc(values[field.id] ?? '');
    const control = field.type === 'textarea'
      ? `<textarea ${common} rows="2">${value}</textarea>`
      : field.type === 'number'
        ? `<input type="number" ${common} value="${value}" min="${field.min ?? 0}" max="${field.max ?? 99}" inputmode="numeric">`
        : `<input type="${field.type === 'tel' ? 'tel' : 'text'}" ${common} value="${value}"
             ${field.type === 'tel' ? 'inputmode="tel"' : ''}>`;
    return `<label class="field">
      <span class="field__label">${esc(t(field.label, lang))}${field.required ? '' : ` <span class="field__optional">${esc(UI[lang].optional)}</span>`}</span>
      ${control}
      ${field.hint ? `<span class="field__hint">${esc(t(field.hint, lang))}</span>` : ''}
    </label>`;
  }).join('');
}

function body(product, lang) {
  const purchasable = product.status !== 'coming-soon' && product.purchaseMode !== 'request-only';
  const range = priceRange(product);
  const firstVariant = product.variants?.[0]?.id ?? null;
  const includes = product.includes?.[lang] ?? product.includes?.it;

  /**
   * A product sold against somebody's calendar offers a choice of their free days
   * rather than an open date field, so a guest cannot pick a day that will be
   * refused. With nothing in the calendar the field says so and the form cannot
   * be submitted — which is the right answer when nobody has told us when the
   * professional works.
   */
  const byAppointment = product.availabilityMode === 'timeslots';
  const days = byAppointment ? availableDays(product.id) : [];

  const notPurchasable = `
    <div class="notice">
      <p>${esc(product.status === 'coming-soon' ? UI[lang].comingSoonBody : UI[lang].onRequestBody)}</p>
    </div>
    <div class="actions">
      <button class="action action--primary" type="button" data-entry="contacts">
        ${icon('chat', 16)}${esc(UI[lang].writeToStaff)}
      </button>
    </div>`;

  return `
    <p class="sheet__lead">${esc(t(product.summary, lang))}</p>
    <div class="prose">${paragraphs(t(product.description, lang))}</div>

    ${includes ? `<ul class="includes">${includes.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}

    ${product.notice ? `<div class="notice notice--attention">
      <span>${icon('alert', 18)}</span><p>${esc(t(product.notice, lang))}</p>
    </div>` : ''}

    ${purchasable ? `
      <form class="product-form" novalidate>
        ${variantPicker(product, lang, firstVariant)}

        ${product.requiresDate ? (byAppointment
          ? `<label class="field">
              <span class="field__label">${esc(t(product.dateLabel ?? { it: 'Giorno', en: 'Day' }, lang))}</span>
              <select name="date" required ${days.length ? '' : 'disabled'}>
                <option value="">${esc(days.length ? UI[lang].choose : UI[lang].noAppointments)}</option>
                ${days.map((day) => `<option value="${esc(day)}">${esc(longDate(day, lang))}</option>`).join('')}
              </select>
            </label>`
          : `<label class="field">
              <span class="field__label">${esc(t(product.dateLabel ?? { it: 'Giorno', en: 'Day' }, lang))}</span>
              <input type="date" name="date" required min="${esc(earliestDate(product, product.variants?.[0] ?? null))}">
            </label>`) : ''}

        ${product.deliverySlots?.length ? `<label class="field">
          <span class="field__label">${esc(UI[lang].deliveryWindow)}</span>
          <select name="slotId" required>
            <option value="">${esc(UI[lang].choose)}</option>
            ${product.deliverySlots.map((slot) => `<option value="${esc(slot.id)}">${esc(t(slot.label, lang))}</option>`).join('')}
          </select>
        </label>` : product.requiresTime ? (byAppointment
          ? `<label class="field">
              <span class="field__label">${esc(t(product.timeLabel ?? { it: 'Ora', en: 'Time' }, lang))}</span>
              <select name="time" required disabled data-slots>
                <option value="">${esc(UI[lang].pickDayFirst)}</option>
              </select>
            </label>`
          : `<label class="field">
              <span class="field__label">${esc(t(product.timeLabel ?? { it: 'Ora', en: 'Time' }, lang))}</span>
              <input type="time" name="time" required>
            </label>`) : ''}

        ${(product.options ?? []).map((option) => `<label class="field">
          <span class="field__label">${esc(t(option.label, lang))}${option.required ? '' : ` <span class="field__optional">${esc(UI[lang].optional)}</span>`}</span>
          <select name="option:${esc(option.id)}" ${option.required ? 'required' : ''}>
            ${option.required ? `<option value="">${esc(UI[lang].choose)}</option>` : ''}
            ${option.choices.map((choice) => `<option value="${esc(choice.id)}">${esc(t(choice.label, lang))}</option>`).join('')}
          </select>
        </label>`).join('')}

        ${product.requiresRoom ? `<label class="field">
          <span class="field__label">${esc(UI[lang].roomNumber)}</span>
          <input type="text" name="room" required inputmode="numeric" placeholder="303" maxlength="6">
        </label>` : ''}

        ${fieldsFor(product, lang)}

        ${(product.quantity?.max ?? 1) > 1 ? `<label class="field field--inline">
          <span class="field__label">${esc(t(product.quantity.label ?? { it: 'Quantità', en: 'Quantity' }, lang))}</span>
          <input type="number" name="quantity" value="1" min="${product.quantity.min}" max="${product.quantity.max}" inputmode="numeric">
        </label>` : '<input type="hidden" name="quantity" value="1">'}

        <div class="product-form__summary" data-summary aria-live="polite"></div>

        <div class="actions">
          <button class="action action--primary" type="submit" data-add>
            ${icon('gift', 16)}<span data-add-label>${esc(UI[lang].addToCart)}</span>
          </button>
        </div>
      </form>` : notPurchasable}

    ${product.terms ? `<p class="terms">${esc(t(product.terms, lang))}</p>` : ''}
    ${range?.anyPlaceholder && purchasable
      ? `<p class="terms terms--warn">${esc(UI[lang].provisionalPriceNote)}</p>` : ''}
  `;
}

/** Read the form into a cart line. */
function readForm(form) {
  const data = new FormData(form);
  const options = {};
  const fields = {};
  for (const [key, value] of data.entries()) {
    if (key.startsWith('option:')) { if (value) options[key.slice(7)] = String(value); }
    else if (key.startsWith('field:')) { if (value) fields[key.slice(6)] = String(value); }
  }
  return {
    productId: form.dataset.productId,
    variantId: data.get('variantId') || null,
    quantity: Number(data.get('quantity') ?? 1),
    date: data.get('date') || null,
    slotId: data.get('slotId') || null,
    time: data.get('time') || null,
    room: data.get('room') || null,
    options,
    fields,
  };
}

export function openProductSheet(productId, { lang, onAdded }) {
  const product = getProduct(productId);
  if (!product) return false;

  return openCustomSheet({
    title: t(product.title, lang),
    body: body(product, lang),
    lang,
    id: `product:${productId}`,
    onMount(container) {
      const form = container.querySelector('.product-form');
      if (!form) return;
      form.dataset.productId = product.id;

      const summary = form.querySelector('[data-summary]');
      const submit = form.querySelector('[data-add]');

      const refresh = () => {
        const line = readForm(form);
        const variant = getVariant(product, line.variantId);
        const checked = validateLine(line, { allowPlaceholders: true });

        // Only complain about things the guest has actually filled in, so the form
        // does not shout before it has been used.
        const touched = (field) => {
          if (field === 'date') return Boolean(line.date);
          if (field === 'slotId') return Boolean(line.slotId);
          if (field === 'room') return Boolean(line.room);
          return true;
        };
        const complaints = checked.errors.filter((e) => touched(e.field));

        const unit = checked.unit;
        const total = unit * Math.max(1, line.quantity);
        const notice = leadMinutesFor(product, variant);
        const { deadline } = cutoffFor(product, variant, line);

        summary.innerHTML = `
          ${unit ? `<div class="summary-row">
            <span>${esc(UI[lang].total)}</span><strong>${esc(money(total, { lang }))}</strong>
          </div>` : ''}
          ${notice && product.cutoff?.kind === 'leadMinutes'
            ? `<p class="hint">${icon('clock', 14)} ${esc(noticeLabel(notice, lang))}</p>` : ''}
          ${deadline && line.date
            ? `<p class="hint">${esc(UI[lang].orderBy)} ${esc(deadlineLabel(deadline, lang))}</p>` : ''}
          ${complaints.length
            ? `<ul class="form-errors">${complaints.map((e) => `<li>${esc(errorText(e.code, lang))}</li>`).join('')}</ul>` : ''}
        `;
        submit.disabled = !checked.ok;
      };

      const slotSelect = form.querySelector('[data-slots]');
      if (slotSelect) {
        const dateField = form.querySelector('[name="date"]');
        dateField.addEventListener('change', async () => {
          const chosen = dateField.value;
          slotSelect.disabled = true;
          slotSelect.innerHTML = `<option value="">${esc(UI[lang].loading)}</option>`;
          refresh();
          if (!chosen) {
            slotSelect.innerHTML = `<option value="">${esc(UI[lang].pickDayFirst)}</option>`;
            return;
          }
          try {
            const { slots } = await fetchSlots(product.id, chosen);
            slotSelect.innerHTML = slots.length
              ? `<option value="">${esc(UI[lang].choose)}</option>${slots.map((slot) =>
                  `<option value="${esc(slot.time)}">${esc(slot.time)}</option>`).join('')}`
              : `<option value="">${esc(UI[lang].noTimesThatDay)}</option>`;
            slotSelect.disabled = slots.length === 0;
          } catch {
            slotSelect.innerHTML = `<option value="">${esc(UI[lang].noTimesThatDay)}</option>`;
          }
          refresh();
        });
      }

      form.addEventListener('input', refresh);
      form.addEventListener('change', refresh);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const line = readForm(form);
        if (!validateLine(line, { allowPlaceholders: true }).ok) { refresh(); return; }
        cart.add(line);
        onAdded?.(line, product);
      });
      refresh();
    },
  });
}

function deadlineLabel(deadline, lang) {
  const date = new Date(deadline);
  const day = new Intl.DateTimeFormat(lang === 'it' ? 'it-IT' : 'en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Rome',
  }).format(date);
  const time = new Intl.DateTimeFormat(lang === 'it' ? 'it-IT' : 'en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome',
  }).format(date);
  return `${day}, ${time}`;
}

export { errorText, longDate };
