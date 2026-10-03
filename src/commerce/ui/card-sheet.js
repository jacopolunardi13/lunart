/**
 * "La mia Privilege Card".
 *
 * The screen a guest holds up at a restaurant. It shows the card, a QR the venue
 * scans, and a short code to read out when the camera will not cooperate.
 *
 * The code is fetched, never computed here: the browser has no key and could not
 * make one if it wanted to. It comes with its own expiry, and this screen asks for
 * a fresh one just before the old one lapses, so what is on screen is always
 * current and a screenshot of it stops working within a couple of minutes.
 */

import { esc } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { UI } from '../../i18n.js';
import { openCustomSheet, replaceSheetBody } from '../../ui/sheet.js';
import { longDate } from './format.js';
import { qrSvg } from '../qr.js';
import { fetchCard } from '../api.js';

const STORAGE_KEY = 'lunart.cards.v1';

export function rememberedCards() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((token) => typeof token === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberCard(token) {
  if (!token) return;
  const tokens = rememberedCards().filter((existing) => existing !== token);
  tokens.unshift(token);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens.slice(0, 10))); } catch { /* ignore */ }
}

const STATE_TEXT = {
  it: { active: 'Attiva', 'not-started': 'Non ancora attiva', expired: 'Scaduta', revoked: 'Non più valida' },
  en: { active: 'Active', 'not-started': 'Not active yet', expired: 'Expired', revoked: 'No longer valid' },
};

/** The card itself, drawn rather than photographed — it is a digital object. */
function cardFace(card, lang) {
  return `<div class="privilege-card" data-state="${esc(card.state)}">
    <div class="privilege-card__top">
      <span class="privilege-card__mark">LunArt</span>
      <span class="privilege-card__kind">Privilege Card</span>
    </div>
    <p class="privilege-card__holder">${esc(card.holder)}</p>
    <div class="privilege-card__foot">
      <span>${esc(UI[lang].validUntil)} ${esc(longDate(card.end_date, lang))}</span>
      <span>${esc(UI[lang].upToTwo)}</span>
    </div>
  </div>`;
}

function body(card, lang) {
  const stateLabel = STATE_TEXT[lang]?.[card.state] ?? card.state;

  const live = card.state === 'active' && card.code
    ? `<div class="card-code">
        <div class="card-code__qr" data-qr>${qrSvg(card.qr, { label: UI[lang].qrLabel })}</div>
        <p class="card-code__manual">
          <span class="card-code__label">${esc(UI[lang].manualCode)}</span>
          <strong data-manual>${esc(card.code.manualCode)}</strong>
        </p>
        <p class="card-code__timer">
          ${icon('clock', 14)}
          <span data-countdown>${card.code.secondsRemaining}</span> ${esc(UI[lang].codeRefreshes)}
        </p>
      </div>`
    : `<div class="notice">
        <p>${esc(card.state === 'not-started'
          ? `${UI[lang].cardStartsOn} ${longDate(card.start_date, lang)}`
          : UI[lang].cardNotUsable)}</p>
      </div>`;

  const benefits = (card.benefits ?? []).map((benefit) => `
    <li class="place">
      <span class="place__body">
        <span class="place__name">${esc(benefit.partner)}</span>
        <span class="place__note">${esc(benefit.label[lang] ?? benefit.label.it)}</span>
        ${benefit.conditions ? `<span class="place__area" style="text-transform:none;letter-spacing:0">${esc(benefit.conditions[lang] ?? benefit.conditions.it)}</span>` : ''}
      </span>
    </li>`).join('');

  return `
    ${cardFace(card, lang)}
    <p class="status-pill" data-tone="${card.state === 'active' ? 'good' : 'muted'}">${esc(stateLabel)}</p>
    ${live}
    <p class="terms">${esc(UI[lang].cardTerms)}</p>
    ${benefits ? `<h3 class="checkout-form__heading">${esc(UI[lang].whereItWorks)}</h3><ul>${benefits}</ul>` : ''}
  `;
}

let refreshTimer = null;

function stopRefreshing() {
  clearTimeout(refreshTimer);
  refreshTimer = null;
}

/**
 * Keep the displayed code current.
 *
 * Asks for the next one a second before this one lapses, and counts down in
 * between so it is obvious the card is live rather than a picture of one.
 */
function keepFresh(accessToken, lang, container) {
  const countdown = container.querySelector('[data-countdown]');
  if (!countdown) return;

  let remaining = Number(countdown.textContent) || 0;
  const tick = () => {
    remaining -= 1;
    if (remaining > 0) {
      countdown.textContent = String(remaining);
      refreshTimer = setTimeout(tick, 1000);
      return;
    }
    fetchCard(accessToken)
      .then((card) => {
        if (!document.body.contains(container)) { stopRefreshing(); return; }
        replaceSheetBody({ body: body(card, lang), onMount: (next) => keepFresh(accessToken, lang, next) });
      })
      .catch(() => { refreshTimer = setTimeout(tick, 5000); remaining = 5; });
  };
  refreshTimer = setTimeout(tick, 1000);
}

export function openCardSheet(accessToken, { lang }) {
  rememberCard(accessToken);
  stopRefreshing();

  openCustomSheet({
    title: UI[lang].myCard,
    body: `<p class="sheet__lead">${esc(UI[lang].loading)}</p>`,
    lang,
    id: `card:${accessToken}`,
    onClose: stopRefreshing,
  });

  fetchCard(accessToken)
    .then((card) => replaceSheetBody({
      title: UI[lang].myCard,
      body: body(card, lang),
      onMount: (container) => keepFresh(accessToken, lang, container),
    }))
    .catch(() => replaceSheetBody({
      title: UI[lang].myCard,
      body: `<p class="sheet__lead">${esc(UI[lang].cardNotFound)}</p>`,
    }));
}

/** The shortcut in the guide, for a guest who already holds one. */
export async function cardBlock(lang) {
  const tokens = rememberedCards();
  if (tokens.length === 0) return '';

  const cards = (await Promise.all(tokens.map((token) =>
    fetchCard(token).then((card) => ({ ...card, token })).catch(() => null)))).filter(Boolean);
  if (cards.length === 0) return '';

  return `<section class="section" aria-labelledby="h-mycard">
    <div class="section__head">
      <span style="color:var(--accent)">${icon('card', 20)}</span>
      <h2 id="h-mycard">${esc(UI[lang].myCard)}</h2>
    </div>
    <div class="cards">
      ${cards.map((card) => `
        <button class="card" type="button" data-card="${esc(card.token)}">
          <span class="card__icon">${icon('card', 22)}</span>
          <span class="card__body">
            <span class="card__title">${esc(card.holder)}</span>
            <span class="card__summary">${esc(STATE_TEXT[lang]?.[card.state] ?? card.state)} · ${esc(UI[lang].validUntil)} ${esc(longDate(card.end_date, lang))}</span>
          </span>
          <span class="card__chevron">${icon('chevron', 16)}</span>
        </button>`).join('')}
    </div>
  </section>`;
}

export { stopRefreshing };
