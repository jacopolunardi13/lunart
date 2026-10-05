/**
 * The LunArt Pass, as the guest's phone draws it.
 *
 * It should read as a card somebody handed you, not as a status panel. That means
 * the name is large and in the serif, the dates and the room sit under it the way
 * they would be printed, and the state is a quiet word rather than a coloured
 * alarm — a Pass that has not started yet is not a problem, it is a Tuesday.
 *
 * The artwork is a hook, not a hard-coded picture. LunArt already has a printed
 * identity for the breakfast vouchers, and the intention is that this card
 * eventually wears it. Drop a file at `assets/img/pass/lunart-pass.(webp|jpg)` and
 * it becomes the card's background with no code change; until one is there the
 * card draws its own, in the guide's own ink and gold. See `PASS_ARTWORK` below.
 *
 * Privilege is the same card with the gold turned up — a border, a word, and the
 * benefits that were bought. Not a second card, because that is not what happened
 * to the guest: theirs got better.
 */

import { esc } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { UI } from '../../i18n.js';
import { guestPass } from '../../guest.js';

/**
 * The printed artwork, when there is one.
 *
 * A single place to point at a file. The card checks for it at runtime and falls
 * back to its own drawing, so shipping the artwork is a matter of adding the image
 * — no build step, no code edit, no risk of a half-applied change.
 */
export const PASS_ARTWORK = 'assets/img/pass/lunart-pass';

/** Set once the artwork has been found, so it is probed once and not per render. */
let artwork = null;

/**
 * Look for the artwork, once.
 *
 * Deliberately quiet: a missing file is the expected state today, not an error, so
 * it is not logged and nothing waits on it. The card renders either way and simply
 * gets better when the file lands.
 */
export async function loadPassArtwork() {
  if (artwork !== null) return artwork;
  try {
    const response = await fetch(`${PASS_ARTWORK}-700.webp`, { method: 'HEAD' });
    artwork = response.ok ? `${PASS_ARTWORK}-700.webp` : '';
  } catch {
    artwork = '';
  }
  return artwork;
}

const shortDate = (date, lang) => (date
  ? new Intl.DateTimeFormat(lang === 'it' ? 'it-IT' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Rome' })
    .format(new Date(`${date}T12:00:00Z`))
  : '');

/** The dates as a card would print them: "31 ott – 2 nov", one line, no year. */
function stayLine(pass, lang) {
  if (!pass.check_in || !pass.check_out) return '';
  return `${shortDate(pass.check_in, lang)} – ${shortDate(pass.check_out, lang)}`;
}

/**
 * What the state means, in the guest's words.
 *
 * "Expired" is the one that has to be unmistakable, because it is the one that
 * carries a consequence: a breakfast voucher from this stay stops being honoured
 * when the Pass does.
 */
const STATE_TEXT = {
  it: {
    'not-started': 'Attiva dal giorno dell’arrivo',
    active: 'Attiva',
    expired: 'Scaduta',
    cancelled: 'Prenotazione annullata',
    unknown: 'Da confermare',
  },
  en: {
    'not-started': 'Active from the day you arrive',
    active: 'Active',
    expired: 'Expired',
    cancelled: 'Reservation cancelled',
    unknown: 'To be confirmed',
  },
};

/**
 * The Pass block for the home.
 *
 * Returns nothing at all when there is no reservation behind this page: the public
 * guide has no Pass to show, and inventing an empty one would be worse than
 * leaving the space to the content that is real.
 */
export function passBlock(lang) {
  const pass = guestPass();
  if (!pass) return '';

  const privilege = pass.tier === 'privilege';
  const dates = stayLine(pass, lang);
  const state = STATE_TEXT[lang]?.[pass.state] ?? STATE_TEXT.it[pass.state] ?? '';

  const included = (pass.included ?? []).map((benefit) => `
    <li class="pass__benefit">
      <span class="pass__benefit-partner">${esc(benefit.partner)}</span>
      <span class="pass__benefit-what">${esc(benefit.label?.[lang] ?? benefit.label?.it ?? '')}</span>
    </li>`).join('');

  const privileges = (pass.privileges ?? []).map((benefit) => `
    <li class="pass__benefit pass__benefit--privilege">
      <span class="pass__benefit-partner">${esc(benefit.partner)}</span>
      <span class="pass__benefit-what">${esc(benefit.label?.[lang] ?? benefit.label?.it ?? '')}</span>
    </li>`).join('');

  return `<section class="section" aria-labelledby="h-pass">
    <div class="section__head">
      <span style="color:var(--accent)">${icon('card', 20)}</span>
      <h2 id="h-pass">${esc(privilege ? UI[lang].privilegeTitle : UI[lang].passTitle)}</h2>
    </div>

    <article class="pass${privilege ? ' pass--privilege' : ''}" data-pass data-state="${esc(pass.state)}"
      ${artwork ? `style="--pass-artwork:url('${esc(artwork)}')"` : ''}>
      <div class="pass__face">
        <p class="pass__brand">LunArt${privilege ? ` <span class="pass__tier">${esc(UI[lang].privilegeWord)}</span>` : ''}</p>
        <p class="pass__holder">${esc(pass.holder || UI[lang].passTitle)}</p>
        <p class="pass__line">
          ${pass.room ? `${esc(UI[lang].roomLabel)} ${esc(pass.room)}` : ''}${pass.room && dates ? ' · ' : ''}${esc(dates)}
        </p>
        <p class="pass__state" data-pass-state>${esc(state)}</p>
      </div>
    </article>

    ${included ? `<p class="pass__label">${esc(UI[lang].includedWithStay)}</p>
      <ul class="pass__benefits">${included}</ul>` : ''}

    ${privileges ? `<p class="pass__label">${esc(UI[lang].privilegeIncludes)}</p>
      <ul class="pass__benefits">${privileges}</ul>` : ''}

    ${privilege && pass.card
    ? `<button class="action action--wide" type="button" data-card="${esc(pass.card.access_token)}">
        ${icon('card', 16)}${esc(UI[lang].openCard)}
      </button>`
    : ''}

    <p class="pass__note">${esc(privilege ? UI[lang].passNotePrivilege : UI[lang].passNote)}</p>
  </section>`;
}
