/**
 * "La mia Privilege Card".
 *
 * The screen a guest holds up at a restaurant. It shows the card, the QR the
 * venue scans, and the privileges that come with it.
 *
 * The QR behind it is temporary and validated server-side — but none of that is
 * the guest's business, and showing it would make a membership card feel like a
 * security product. So there is no countdown, no "refreshes in", no expiry, no
 * mention of tokens. The code is replaced quietly in the background, swapping
 * only the image so nothing on screen moves. To the guest it is simply the QR of
 * their card.
 */

import { esc } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { UI } from '../../i18n.js';
import { openCustomSheet, replaceSheetBody } from '../../ui/sheet.js';
import { longDate, shortDate } from './format.js';
import { PASS_MARK, cardStateText } from './pass.js';
import { qrSvg } from '../qr.js';
import { fetchCard, stayBenefits, cardBenefits } from '../api.js';
import { partnerList } from './partners.js';

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

/**
 * The card's state in words comes from `pass.js`, which is the only copy.
 *
 * There used to be a private map here. The Pass now has to say the same four words
 * — it carries `pass.card.state` so it can tell a guest when their card starts — and
 * two copies of a vocabulary is how one screen ends up saying "Non ancora attiva"
 * while another says something slightly different about the same card.
 */

/**
 * The face of the Privilege Card, in the same family as the Pass.
 *
 * This used to be a dark card with a typographic mark drawn in CSS — a second,
 * unrelated design for what is, to a guest, the same tessera they already have. It
 * now wears the voucher's watercolour like the Pass does, with the same dark ink on
 * the same pale ground and the same gold edge, so the card they open at a restaurant
 * is recognisably the card on their home screen.
 *
 * The data it carries is its own: this one is a card with a holder, a validity and a
 * number a venue can read back, and that is why it is a separate component rather
 * than the Pass with different words in it.
 */
function cardFace(card, lang) {
  // Short dates on the face. The long form belongs under the card, where there is a
  // column for it; at card width it truncated mid-word into an ellipsis.
  const dates = `${shortDate(card.start_date, lang)} – ${shortDate(card.end_date, lang)}`;
  return `<div class="privilege-card" data-state="${esc(card.state)}">
    <div class="privilege-card__head">
      <div class="privilege-card__who">
        <p class="privilege-card__holder">${esc(card.holder)}</p>
        <p class="privilege-card__guests">${esc(UI[lang].validForTwo)}</p>
      </div>
      <img class="pass__mark" src="${esc(PASS_MARK)}" alt="LunArt" decoding="async" width="40" height="24">
    </div>
    <div class="privilege-card__foot">
      <div class="privilege-card__detail">
        <span class="privilege-card__dates">${esc(dates)}</span>
        <span class="privilege-card__number">${esc(UI[lang].cardNumber)} ${esc(card.reference)}</span>
      </div>
      <span class="privilege-card__kind">${esc(UI[lang].privilegeWord)}</span>
    </div>
  </div>`;
}

/**
 * The card's own lifecycle, in the vocabulary eligibility speaks.
 *
 * A card is not a Pass — it has its own start date, its own end date and its own
 * revocation — but the question a benefit asks is the same one: is this live. The
 * map is explicit rather than implied so that a card state nobody has thought about
 * resolves to `unknown` and locks, instead of defaulting open.
 */
const CARD_AS_PASS = {
  active: 'active',
  'not-started': 'not-started',
  expired: 'expired',
  revoked: 'cancelled',
};

/**
 * What this card gets its holder.
 *
 * Holding the card is the entitlement — the order that issued it is what bought
 * Privilege — so the only open question on this screen is whether the card is live
 * today, and the benefits dim with it rather than being listed as usable on a card
 * that would be turned away.
 */
function privileges(card, lang) {
  const views = card.benefits ?? [];
  if (views.length === 0) return '';

  const live = card.state === 'active';
  const pass = {
    state: CARD_AS_PASS[card.state] ?? 'unknown',
    entitlements: ['privilege'],
    // On this screen the card's state is the entitlement's state: there is nothing
    // else it could be. Said rather than left to a default.
    live_entitlements: live ? ['privilege'] : [],
  };

  return `<details class="privileges" open>
    <summary class="privileges__summary">
      <span>${esc(UI[lang].viewPrivileges)}</span>
      ${icon('chevron', 16)}
    </summary>
    ${partnerList(views, pass, lang)}
  </details>`;
}

function body(card, lang) {
  const usable = card.state === 'active' && card.qr;

  return `
    ${cardFace(card, lang)}

    <p class="status-pill" data-tone="${card.state === 'active' ? 'good' : 'muted'}">
      ${esc(cardStateText(card.state, lang) || card.state)}
    </p>

    ${usable
      ? `<div class="card-qr">
           <div class="card-qr__frame" data-qr>${qrSvg(card.qr, { label: UI[lang].qrLabel })}</div>
           <p class="card-qr__hint">${esc(UI[lang].showAtVenue)}</p>
         </div>`
      : `<div class="notice">
           ${/**
             * A card that cannot be honoured yet, explained rather than left blank.
             *
             * The guest owns this card; what they do not have is a code, because a
             * code that works before the card does would be a code that works. So
             * the screen says the date it starts and that the QR arrives with it —
             * an information state, not an authorisation one. Nothing here asks the
             * server for a code, and the server would refuse if it did.
             */''}
           ${card.state === 'not-started'
             ? `<span class="notice__lines">
                  <span>${esc(UI[lang].cardStartsOn)} ${esc(longDate(card.start_date, lang))}.</span>
                  <span>${esc(UI[lang].cardQrFromActivation)}</span>
                </span>`
             : `<span>${esc(UI[lang].cardNotUsable)}</span>`}
         </div>`}

    ${privileges(card, lang)}

    <p class="terms">${esc(UI[lang].cardTerms)}</p>
  `;
}

let refreshTimer = null;

export function stopRefreshing() {
  clearTimeout(refreshTimer);
  refreshTimer = null;
}

/**
 * Keep the code current, invisibly.
 *
 * Only the QR image is replaced, and only when the one on screen is about to stop
 * working. Nothing else re-renders, nothing moves, and nothing counts down — a
 * guest holding the card up at a bar sees the same screen throughout.
 */
function keepCurrent(accessToken, lang, container) {
  stopRefreshing();
  const frame = container.querySelector('[data-qr]');
  if (!frame) return;

  const schedule = (seconds) => {
    refreshTimer = setTimeout(async () => {
      if (!document.body.contains(frame)) { stopRefreshing(); return; }
      try {
        const card = await fetchCard(accessToken);
        if (!document.body.contains(frame)) { stopRefreshing(); return; }
        if (card.state !== 'active' || !card.qr) {
          // It lapsed or was withdrawn while open: redraw properly rather than
          // leaving a QR on screen that would be turned away at the door.
          replaceSheetBody({ body: body(card, lang), onMount: (next) => keepCurrent(accessToken, lang, next) });
          return;
        }
        frame.innerHTML = qrSvg(card.qr, { label: UI[lang].qrLabel });
        schedule(card.refreshIn);
      } catch {
        schedule(10);   // offline for a moment; the code on screen is still good
      }
    }, Math.max(2, seconds) * 1000);
  };

  schedule(container.dataset.nextRefresh ? Number(container.dataset.nextRefresh) : 30);
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
      onMount: (container) => {
        container.dataset.nextRefresh = String(card.refreshIn ?? 30);
        keepCurrent(accessToken, lang, container);
      },
    }))
    .catch(() => replaceSheetBody({
      title: UI[lang].myCard,
      body: `<p class="sheet__lead">${esc(UI[lang].cardNotFound)}</p>`,
    }));
}

/**
 * What comes with the stay, listed in the guide rather than on the card.
 *
 * This is the distinction that matters commercially: the Opera Caffè 30% is part of
 * staying at LunArt, for everyone on the reservation, and nobody should be sold a
 * card to get it. The card's own privileges are on the card.
 */
export function stayBenefitsBlock(lang) {
  const included = stayBenefits();
  if (included.length === 0) return '';

  /**
   * No Pass is passed in, deliberately.
   *
   * This block is on the public guide, where there is no reservation to assess.
   * What a LunArt stay includes is information here, not an entitlement, and
   * greying it out as "not available" would be answering a question nobody asked.
   */
  return `<section class="section" aria-labelledby="h-included">
    <div class="section__head">
      <span style="color:var(--accent)">${icon('gift', 20)}</span>
      <h2 id="h-included">${esc(UI[lang].includedWithStay)}</h2>
    </div>
    <p class="section__blurb">${esc(UI[lang].includedWithStayBlurb)}</p>
    ${partnerList(included, null, lang)}
  </section>`;
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
            <span class="card__summary">${esc(cardStateText(card.state, lang) || card.state)} · ${esc(UI[lang].validUntil)} ${esc(longDate(card.end_date, lang))}</span>
          </span>
          <span class="card__chevron">${icon('chevron', 16)}</span>
        </button>`).join('')}
    </div>
  </section>`;
}
