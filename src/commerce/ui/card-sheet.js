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
import { UI, fill } from '../../i18n.js';
import { openCustomSheet, replaceSheetBody } from '../../ui/sheet.js';
import { longDate, shortDate } from './format.js';
import { propertyTimeToInstant } from '../../../commerce/time.js';
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
export function cardBenefitsBlock(card, lang) {
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

  /**
   * One line, when the venues below are not usable today.
   *
   * Without it the partner cards read as an offer: "10% di sconto" set large in
   * the serif says "use me" however carefully the QR above it is sealed. The seal
   * is about the code; this is about the benefits, and a guest should not have to
   * join those two facts up herself.
   *
   * Nothing is added when the card is live. The code is on the screen and the hint
   * under it already says to show it; a third sentence would be the repetition this
   * file keeps being trimmed of.
   */
  const when = live
    ? ''
    : card.state === 'not-started'
      ? fill(UI[lang].cardBenefitsFrom, { date: longDate(card.start_date, lang) })
      : fill(UI[lang].cardBenefitsEnded, { date: longDate(card.end_date, lang) });

  return `<details class="privileges" open>
    <summary class="privileges__summary">
      <span>${esc(UI[lang].viewPrivileges)}</span>
      ${icon('chevron', 16)}
    </summary>
    ${when ? `<p class="privileges__when" data-benefits-when>${esc(when)}</p>` : ''}
    ${partnerList(views, pass, lang)}
  </details>`;
}

/**
 * What a card that cannot be honoured draws in the place of its code.
 *
 * A real QR symbol, encoding something that is deliberately not a credential: the
 * card's public reference — already printed under it, and not secret — behind a
 * marker that says it is inactive. It is there so the guest recognises the thing
 * they will be holding up in November, not so anybody can scan it.
 *
 * Three independent reasons it cannot authorise anything, which is the point of
 * listing them rather than relying on one:
 *
 *   1. It carries no code. `validateCode` refuses an empty code as `malformed`
 *      before it has looked anything up.
 *   2. It is not a URL. The live QR is a validation link, so a phone camera opens
 *      the venue page; this opens nothing, because `lunart:` is not a scheme any
 *      browser will follow.
 *   3. Even with the right reference and a correct code, the server refuses a card
 *      whose state is not `active` — which is the rule that was already there and
 *      has not been touched.
 *
 * It never becomes valid. On activation the screen fetches a freshly issued code
 * and replaces this; the preview is not a code waiting for a date.
 */
export const previewPayload = (reference) =>
  `lunart:privilege:inactive:${String(reference ?? '').trim().toUpperCase()}`;

/**
 * The code, or the space where it will be.
 *
 * Before this, a card that was not yet active showed a paragraph of text where the
 * QR goes, and the product read as unfinished — a guest who had paid could not see
 * what she had bought. Now the slot is always there and always the same size: the
 * card, the frame, the symbol. What changes is whether the symbol is live, and that
 * is said across it in words rather than left to be inferred.
 */
function qrArea(card, lang) {
  if (card.state === 'active' && card.qr) {
    return `<div class="card-qr" data-state="active">
      <div class="card-qr__frame" data-qr>${qrSvg(card.qr, { label: UI[lang].qrLabel })}</div>
      <p class="card-qr__hint">${esc(UI[lang].showAtVenue)}</p>
    </div>`;
  }

  const starting = card.state === 'not-started';

  return `<div class="card-qr card-qr--preview" data-state="${esc(card.state)}">
    ${/**
      * The symbol itself is `aria-hidden`: announcing "the QR of your Privilege
      * Card" would be announcing something that does not work. The seal and the
      * lines under it are the text, and they say what is true.
      */''}
    <div class="card-qr__frame" data-qr-preview>
      ${qrSvg(previewPayload(card.reference))}
      <span class="card-qr__seal">${esc(cardStateText(card.state, lang) || card.state)}</span>
    </div>
    ${starting
      ? `<p class="card-qr__hint">${esc(UI[lang].cardQrPreviewHint)}</p>
         <p class="card-qr__when">${esc(UI[lang].cardStartsOn)} ${esc(longDate(card.start_date, lang))}.</p>`
      : `<p class="card-qr__hint">${esc(UI[lang].cardNotUsable)}</p>`}
  </div>`;
}

function body(card, lang) {
  /**
   * The state is said once, where it belongs.
   *
   * A live card wears it as a pill under the card, because its code carries no
   * mark. A card that is not live wears it as a seal across the code, which is
   * both the stronger signal and the one in the right place — and printing
   * "Non ancora attiva" twice inside two hundred pixels said it no better.
   */
  const live = card.state === 'active' && card.qr;

  return `
    ${cardFace(card, lang)}

    ${live
      ? `<p class="status-pill" data-tone="good">${esc(cardStateText(card.state, lang) || card.state)}</p>`
      : ''}

    ${qrArea(card, lang)}

    ${cardBenefitsBlock(card, lang)}

    <p class="terms">${esc(UI[lang].cardTerms)}</p>
  `;
}

let refreshTimer = null;

export function stopRefreshing() {
  clearTimeout(refreshTimer);
  refreshTimer = null;
}

/** Half a day. Beyond that it is not a sheet somebody is holding open. */
const ACTIVATION_WATCH_MS = 12 * 60 * 60 * 1000;

/**
 * Keep the code current, invisibly.
 *
 * Only the QR image is replaced, and only when the one on screen is about to stop
 * working. Nothing else re-renders, nothing moves, and nothing counts down — a
 * guest holding the card up at a bar sees the same screen throughout.
 *
 * It attaches to `[data-qr]`, which only a live code has. The preview drawn for a
 * card that is not active carries `[data-qr-preview]` instead, so this loop cannot
 * find it and a card that cannot be used costs no requests at all — the thing it
 * would be asking for does not exist yet.
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
          replaceSheetBody({ body: body(card, lang), onMount: (next) => mount(card, accessToken, lang, next) });
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

/**
 * How long to wait before asking again, or null for "do not wait at all".
 *
 * Separated out because it is the whole rule, and a rule that depends on the clock
 * is worth being able to test without one.
 *
 *   not a waiting card    nothing to wait for.
 *   already past          by this browser's clock. The server says otherwise and
 *                         the server decides; reopening the sheet will ask again.
 *   further than half     not a sheet somebody is holding open, and a timer that
 *   a day off             long is not reliable anyway.
 *
 * The moment comes from `propertyTimeToInstant`, the same function the server uses
 * to decide what day it is in Florence, so the browser is not guessing at a
 * boundary the server will disagree with. Two seconds are added so the request
 * lands after it, never on it.
 */
export function activationWaitMs(card, now = Date.now()) {
  if (card?.state !== 'not-started' || !card.start_date) return null;
  const starts = propertyTimeToInstant(card.start_date, '00:00');
  if (!starts) return null;

  const wait = starts.getTime() - now;
  if (wait <= 0 || wait > ACTIVATION_WATCH_MS) return null;
  return wait + 2000;
}

/**
 * Wait for the card to start, once, and then ask for a real code.
 *
 * A guest who opens the card the evening before her stay should not have to close
 * and reopen it at midnight. This is one `setTimeout` for the moment the card
 * begins — not a poll: nothing is sent until that moment arrives, and if the sheet
 * has been closed by then nothing is sent at all.
 */
function awaitActivation(card, accessToken, lang, container) {
  const frame = container.querySelector('[data-qr-preview]');
  if (!frame) return;

  const wait = activationWaitMs(card);
  if (wait === null) return;

  refreshTimer = setTimeout(async () => {
    if (!document.body.contains(frame)) { stopRefreshing(); return; }
    try {
      const fresh = await fetchCard(accessToken);
      if (!document.body.contains(frame)) { stopRefreshing(); return; }
      replaceSheetBody({ body: body(fresh, lang), onMount: (next) => mount(fresh, accessToken, lang, next) });
    } catch {
      // Offline at midnight. The preview is still correct; reopening will fetch.
    }
  }, wait);
}

/**
 * Start whichever clock this card needs, and only that one.
 *
 * An active card rotates its code; a card waiting to start waits once; a card that
 * is over or withdrawn does neither. One timer slot between them, so `stopRefreshing`
 * closes whatever was running.
 */
function mount(card, accessToken, lang, container) {
  container.dataset.nextRefresh = String(card.refreshIn ?? 30);
  keepCurrent(accessToken, lang, container);
  awaitActivation(card, accessToken, lang, container);
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
      onMount: (container) => mount(card, accessToken, lang, container),
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
