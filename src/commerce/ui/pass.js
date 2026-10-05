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
import { openCustomSheet } from '../../ui/sheet.js';
import { stayBenefits } from '../api.js';
import { longDate } from './format.js';

/**
 * The printed artwork, one file per tier.
 *
 * Named rather than probed. There used to be a runtime `HEAD` here that asked the
 * server whether the file existed, and it was worse than useless: this server
 * answers `200 text/html` for any unknown path, so the probe always said yes, the
 * card always set a background it could not load, and every guest's first paint
 * carried a failed image request. A file that is committed does not need to be
 * asked about.
 *
 * The CSS carries the gradient underneath as the real fallback: a background image
 * that will not load silently leaves the layer below it showing, which is a card
 * rather than a broken frame.
 *
 * ── Replacing this with the final artwork ─────────────────────────────────────
 * Drop the file at `assets/img/_src/pass/lunart-pass.jpg` (and
 * `lunart-pass-privilege.jpg`), run `node tools/optimize-images.mjs`, and the card
 * wears it. No code change, no CSS change, no build step.
 */
export const PASS_ARTWORK = {
  standard: 'assets/img/pass/lunart-pass',
  privilege: 'assets/img/pass/lunart-pass-privilege',
};

/**
 * ── Why the path is in the stylesheet and not here ────────────────────────────
 *
 * It was here, as an inline `--pass-artwork` custom property, and it silently drew
 * nothing. A relative `url()` inside a custom property resolves against the
 * stylesheet that consumes it, not against the document — so `assets/img/pass/…`
 * became `/assets/css/assets/img/pass/…`. This server answers `200 text/html` for
 * any unknown path, so the browser received a page instead of an image, reported no
 * error, and painted an empty layer. The card looked generic and nothing anywhere
 * said why.
 *
 * In `app.css` the same relative path resolves correctly in both deployments — the
 * server and GitHub Pages under a subpath — and there is nothing left to get wrong.
 * `.pass` carries the standard plate, `.pass--privilege` overrides it. See the
 * `.pass` block there.
 */

/**
 * Kept so the commerce boot has something to await.
 *
 * It no longer probes anything — the artwork is committed and named — but the
 * export stays rather than rippling a signature change through `boot.js` for a
 * function that now has nothing to do.
 */
export async function loadPassArtwork() {
  return PASS_ARTWORK.standard;
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
/**
 * The state as a word, for the card.
 *
 * The card carries a status; the sentence explaining it belongs in the facts row
 * underneath, where there is a column for it. "Attiva dal giorno dell'arrivo" set at
 * card width wrapped to two lines, which pushed the room and the dates up off the
 * mist and onto the black foot of the LA mark — measured at 1:1, and it looked
 * exactly as bad as that sounds.
 */
const STATE_WORD = {
  it: {
    'not-started': 'Non ancora attiva',
    active: 'Attiva',
    expired: 'Scaduta',
    cancelled: 'Annullata',
    unknown: 'Da confermare',
  },
  en: {
    'not-started': 'Not yet active',
    active: 'Active',
    expired: 'Expired',
    cancelled: 'Cancelled',
    unknown: 'To be confirmed',
  },
};

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
/**
 * The card itself.
 *
 * One function for both the preview on the home and the dedicated view, because a
 * guest who taps a card expects to find the same card bigger — not a different
 * rendering of the same facts. `size` only changes the type scale.
 */
export function passFace(pass, lang, { size = 'preview' } = {}) {
  const privilege = pass.tier === 'privilege';
  const dates = stayLine(pass, lang);
  const state = STATE_WORD[lang]?.[pass.state] ?? STATE_WORD.it[pass.state] ?? '';

  return `<article class="pass${privilege ? ' pass--privilege' : ''}" data-pass
    data-state="${esc(pass.state)}" data-size="${esc(size)}">
    <div class="pass__face">
      ${/**
        * The guest at the top, the state at the bottom, and the painting left alone
        * in between.
        *
        * The voucher's watercolour has its air at the top — a pale, even sky — and
        * its weight in the middle, where the LA mark and the Duomo are. So the name
        * takes the sky on its own, like a nameplate, and the room, the dates and the
        * state go to the mist along the bottom. Nothing sits over the painting.
        *
        * Two earlier arrangements were wrong in instructive ways. Putting everything
        * at the bottom needed a cream wash strong enough to dissolve the lower half
        * of the mark — exactly the thing worth keeping. Putting the name *and* the
        * dates in the sky left the dates crossing the top serif of the L.
        *
        * Neither tier prints the word "LunArt": the mark is already the centre of
        * the composition. A Privilege adds its chip at the foot, and nothing else.
        */''}
      <div class="pass__head">
        <p class="pass__holder">${esc(pass.holder || UI[lang].passTitle)}</p>
      </div>
      <div class="pass__foot">
        <div class="pass__detail">
          <p class="pass__line">
            ${pass.room ? `${esc(UI[lang].roomLabel)} ${esc(pass.room)}` : ''}${pass.room && dates ? ' · ' : ''}${esc(dates)}
          </p>
          <p class="pass__state" data-pass-state>${esc(state)}</p>
        </div>
        ${/**
          * The chip alone, without the word "LunArt" in front of it.
          *
          * The painting says LunArt in the middle of the card; a line at the foot
          * saying it again is the card introducing itself twice. What the foot has
          * to carry is the one thing the standard Pass does not: that this is the
          * upgraded one.
          */''}
        ${privilege ? `<p class="pass__tier">${esc(UI[lang].privilegeWord)}</p>` : ''}
      </div>
    </div>
  </article>`;
}

/** One benefit, as a row. The partner's name leads, because that is what is looked for. */
const benefitRow = (benefit, lang, extra = '') => `
  <li class="pass__benefit${extra}">
    <span class="pass__benefit-partner">${esc(benefit.partner)}</span>
    <span class="pass__benefit-what">${esc(benefit.label?.[lang] ?? benefit.label?.it ?? '')}</span>
    ${benefit.conditions ? `<span class="pass__benefit-when">${esc(benefit.conditions[lang] ?? benefit.conditions.it)}</span>` : ''}
  </li>`;

/**
 * The Pass block for the home.
 *
 * Returns nothing at all when there is no reservation behind this page: the public
 * guide has no Pass to show, and inventing an empty one would be worse than
 * leaving the space to the content that is real.
 *
 * The card is a button. It used to be an inert `<article>` with the benefits listed
 * underneath it, which meant the one thing on the page that looks most like
 * something you tap did nothing at all — and a guest looking for their card found a
 * picture of it. Now the preview shows the card and the first benefits, and opening
 * it is a tap. See `openPassSheet`.
 */
export function passBlock(lang) {
  const pass = guestPass();
  if (!pass) return '';

  const privilege = pass.tier === 'privilege';
  // Two is enough to say what kind of thing is in there; the rest is one tap away.
  const preview = [...(pass.privileges ?? []), ...(pass.included ?? [])].slice(0, 2);

  return `<section class="section" aria-labelledby="h-pass">
    <div class="section__head">
      <span style="color:var(--accent)">${icon('card', 20)}</span>
      <h2 id="h-pass">${esc(privilege ? UI[lang].privilegeTitle : UI[lang].passTitle)}</h2>
    </div>

    <button class="pass-open" type="button" data-open-pass
      aria-label="${esc(UI[lang].openPass)}">
      ${passFace(pass, lang)}
    </button>

    ${preview.length ? `<ul class="pass__benefits">
      ${preview.map((benefit) => benefitRow(benefit, lang)).join('')}
    </ul>` : ''}

    <button class="action action--wide" type="button" data-open-pass>
      ${icon('card', 16)}${esc(UI[lang].openPass)}
    </button>

    <p class="pass__note">${esc(privilege ? UI[lang].passNotePrivilege : UI[lang].passNote)}</p>
  </section>`;
}

/**
 * The Pass, in full.
 *
 * Everything a guest might want to check while standing somewhere: the card, whose
 * it is, which room, which dates, whether it is live, and exactly what it is good
 * for. Benefits are ordered rather than merged — what the Privilege adds comes
 * first for a guest who paid for it, then what every stay includes — because
 * running them together would make a bought benefit indistinguishable from a free
 * one, and the Opera Caffè 30% is free for everybody.
 *
 * Built from `guestPass()`, which arrived with the guest context, so it opens
 * instantly and works with no network. The QR a venue scans lives on the Privilege
 * card's own screen and is one further tap: it is a different job — holding a phone
 * up at a till — and it needs the card's live code, which this view does not.
 */
export function openPassSheet({ lang }) {
  const pass = guestPass();
  if (!pass) return false;

  const privilege = pass.tier === 'privilege';
  const stay = pass.included?.length ? pass.included : stayBenefits();

  const validity = [
    pass.check_in ? longDate(pass.check_in, lang) : '',
    pass.check_out ? longDate(pass.check_out, lang) : '',
  ].filter(Boolean).join(' — ');

  const facts = [
    [UI[lang].passHolder, pass.holder || '—'],
    pass.room ? [UI[lang].roomLabel, pass.room] : null,
    validity ? [UI[lang].passValidity, validity] : null,
    [UI[lang].passState, STATE_TEXT[lang]?.[pass.state] ?? STATE_TEXT.it[pass.state] ?? ''],
  ].filter(Boolean);

  openCustomSheet({
    title: privilege ? UI[lang].privilegeTitle : UI[lang].passTitle,
    lang,
    id: 'pass',
    body: `
      ${passFace(pass, lang, { size: 'full' })}

      <dl class="pass-facts">
        ${facts.map(([label, value]) => `
          <div class="pass-facts__row">
            <dt>${esc(label)}</dt>
            <dd>${esc(value)}</dd>
          </div>`).join('')}
      </dl>

      ${privilege && pass.privileges?.length ? `
        <p class="pass__label">${esc(UI[lang].privilegeIncludes)}</p>
        <ul class="pass__benefits">
          ${pass.privileges.map((benefit) => benefitRow(benefit, lang, ' pass__benefit--privilege')).join('')}
        </ul>` : ''}

      ${stay.length ? `
        <p class="pass__label">${esc(UI[lang].includedWithStay)}</p>
        <ul class="pass__benefits">
          ${stay.map((benefit) => benefitRow(benefit, lang)).join('')}
        </ul>` : ''}

      ${privilege && pass.card
        ? `<button class="action action--wide action--primary" type="button"
             data-card="${esc(pass.card.access_token)}">
            ${icon('card', 16)}${esc(UI[lang].openCard)}
          </button>`
        : ''}

      <p class="terms">${esc(privilege ? UI[lang].passNotePrivilege : UI[lang].passNote)}</p>`,
  });
  return true;
}
