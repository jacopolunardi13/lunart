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
import { stayBenefits, cardBenefits } from '../api.js';
import { privilegeSection, stayBenefitsSection } from './partners.js';
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
/**
 * The mark drawn on the card.
 *
 * The same file the header uses — LunArt's own lock-up, traced from the artwork they
 * supplied. Referenced from here rather than hard-coded in the markup so the card and
 * the header can never end up wearing two different marks.
 */
export const PASS_MARK = 'assets/img/brand/lunart-wordmark.svg';

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
        * in between, with the mark top-right.
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
        * The mark is on the card because the painting does not contain one. When the
        * card wore the breakfast voucher this was the opposite: the LA lock-up was
        * the centre of that composition, so printing "LunArt" again was the card
        * introducing itself twice. "Il movimento e la stratificazione di Firenze" is
        * an abstract — deliberately not a view, not a monument, not a signature — so
        * without the mark the card is a beautiful rectangle with a stranger's name
        * on it. It goes top-right, opposite the name, small.
        */''}
      <div class="pass__head">
        <p class="pass__holder">${esc(pass.holder || UI[lang].passTitle)}</p>
        <img class="pass__mark" src="${esc(PASS_MARK)}" alt="LunArt" decoding="async" width="40" height="24">
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

/**
 * One line of the preview on the home: what you get, and where.
 *
 * The benefit leads and the venue follows, which is the reverse of how this used to
 * read. A guest scanning their own home screen is not checking which restaurants
 * LunArt works with; they are checking what they have. The full list, with the
 * addresses and the directions, is one tap away in the sheet.
 */
const previewRow = (view, lang, extra = '') => {
  const benefit = view.benefits?.[0];
  if (!benefit) return '';
  const what = benefit.headline?.[lang] ?? benefit.headline?.it ?? benefit.emphasis ?? '';
  return `
  <li class="pass__benefit${extra}">
    <span class="pass__benefit-what">${esc(what)}</span>
    <span class="pass__benefit-partner">${esc(view.partner)}</span>
  </li>`;
};

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
  /**
   * Two rows, one of each kind where the guest has both.
   *
   * Two is enough to say what sort of thing is in there and the rest is one tap
   * away — but two Privilege venues in a row would say the Pass is a partner list,
   * and with twenty partners it would never again mention the breakfast. So the
   * glimpse takes the first thing the upgrade added and then what the stay
   * includes, which is the honest summary of a Pass that has both.
   */
  const bought = pass.privileges ?? [];
  const included = pass.included ?? [];
  // Marked, so a benefit that was paid for never reads as one that comes free.
  const preview = (bought.length
    ? [{ view: bought[0], paid: true }, ...included.map((view) => ({ view, paid: false }))]
    : included.map((view) => ({ view, paid: false }))).slice(0, 2);

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
      ${preview.map(({ view, paid }) => previewRow(view, lang, paid ? ' pass__benefit--privilege' : '')).join('')}
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

  /**
   * The Privilege partners, from the published register rather than from the Pass.
   *
   * `pass.privileges` is deliberately empty for a guest who has not upgraded — the
   * server will not tell a standard Pass that it has privileges — but that is the
   * guest who most needs to see what the upgrade is. So the list comes from the
   * catalogue, and `benefitAccess` decides for each benefit whether this particular
   * Pass can use it, lock it, or neither.
   */
  const privilegePartners = pass.privileges?.length ? pass.privileges : cardBenefits();

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

      ${/**
        * Order by what this guest owns.
        *
        * A guest who bought Privilege opens their Pass to use it, so it comes
        * first. A guest who has not opens it to use the stay, so what the stay
        * includes comes first and the Privilege section sits under it as something
        * to discover — not as a pitch standing between them and their breakfast.
        */''}
      ${privilege
        ? `${privilegeSection(privilegePartners, pass, lang)}
           ${stayBenefitsSection(stay, pass, lang)}`
        : `${stayBenefitsSection(stay, pass, lang)}
           ${privilegeSection(privilegePartners, pass, lang)}`}

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
