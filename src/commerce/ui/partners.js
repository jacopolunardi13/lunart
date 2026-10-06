/**
 * Partners, as a guest reads them.
 *
 * One renderer for every partner there will ever be. Two venues today and twenty in
 * a year have to come out of the same function, which is why there is nothing here
 * that names Le Firme or Blue Velvet: a partner is a record with benefits, and this
 * file knows how to draw that record.
 *
 * ── What the eye should catch ────────────────────────────────────────────────
 *
 * The benefit, not the venue. A guest standing outside a shop already knows which
 * shop they are standing outside; what they are checking is whether they get the
 * ten per cent. So the headline is the discount, set large in the serif, and the
 * name, the category and the address are the quiet line above it. That inversion is
 * the whole layout.
 *
 * ── Locked is not hidden ─────────────────────────────────────────────────────
 *
 * A guest without the upgrade still sees what the upgrade gets them, because a
 * benefit nobody can discover sells nothing and because hiding it would make the
 * Privilege tile in the shop an abstraction. It is shown dimmed, labelled
 * "Disponibile con LunArt Privilege", and the button underneath is the ordinary
 * product sheet — the same checkout as everywhere else, not a second one.
 *
 * ── The one sentence about showing the card ──────────────────────────────────
 *
 * Said once, under the heading, and never again per benefit. Three venues each
 * repeating "show your card" reads like a terms-and-conditions page; the Pass is
 * the key, and a guest only has to be told that once.
 */

import { esc } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { UI } from '../../i18n.js';
import {
  ACCESS, PARTNERSHIP_STATUS, benefitAccess, eligibilityOf, passContextOf,
} from '../../../commerce/partners.js';

const text = (field, lang) => (field ? (field[lang] ?? field.it ?? '') : '');

/** The adapter lives with the rule it feeds. Re-exported so screens need one import. */
export { passContextOf as passContext } from '../../../commerce/partners.js';

/**
 * Not every surface is asking about a guest.
 *
 * The public guide lists what a LunArt stay includes with nobody logged in and no
 * Pass to assess — there, a partner is information, not an entitlement, and dimming
 * it as "unavailable" would be answering a question no one asked. Passing no Pass
 * says exactly that.
 */
export const INFORMATIONAL = 'informational';

/** What a guest can do with each of a partner's benefits, right now. */
export const accessFor = (view, pass) => {
  const context = passContextOf(pass);
  return (view.benefits ?? []).map((benefit) => ({
    benefit,
    access: pass
      ? benefitAccess(benefit.eligibility ?? eligibilityOf(view), context)
      // The same shape a verdict has, so a caller reading `missing` or `dormant`
      // gets an empty list rather than an exception it never asked for.
      : { state: INFORMATIONAL, missing: [], dormant: [], passState: null },
  }));
};

/** The strongest thing true of a whole partner: available beats locked beats not. */
function partnerState(rows) {
  const states = rows.map((row) => row.access.state);
  if (states.includes(ACCESS.available)) return ACCESS.available;
  if (states.includes(ACCESS.locked)) return ACCESS.locked;
  return states[0] ?? ACCESS.unavailable;
}

/**
 * Whether this guest is missing an entitlement, which is a different question from
 * whether they can use the benefit tonight.
 *
 * `benefitAccess` reports `unavailable` the moment the Pass is not live, because
 * that is the honest answer to "can I use this now" whoever is asking. But it also
 * hands back `missing`, and that is the answer to "is this mine" — which is the one
 * that decides whether a guest is shown a lock and a way to buy. A guest arriving in
 * November who has not upgraded still needs both; a guest arriving in November who
 * has needs neither.
 */
const missingFrom = (rows) => [...new Set(rows.flatMap((row) => row.access.missing))];

/**
 * One benefit.
 *
 * `headline` is the primary line and `subline` the secondary, in the guest's own
 * language. `description` is the full sentence where a partner gave one, and `note`
 * a condition where there is one — both omitted rather than filled with something
 * plausible when a partner did not say.
 */
function benefitRow({ benefit, access }, lang) {
  const headline = text(benefit.headline, lang) || benefit.emphasis || '';
  const subline = text(benefit.subline, lang);
  const description = text(benefit.description, lang);
  const note = text(benefit.note, lang);

  return `<li class="benefit" data-access="${esc(access.state)}" data-kind="${esc(benefit.kind)}">
    <p class="benefit__headline">${esc(headline)}</p>
    ${subline ? `<p class="benefit__subline">${esc(subline)}</p>` : ''}
    ${description ? `<p class="benefit__detail">${esc(description)}</p>` : ''}
    ${note ? `<p class="benefit__note">${esc(note)}</p>` : ''}
  </li>`;
}

/**
 * The official mark, where a business gave us one.
 *
 * A fixed box with `object-fit: contain`, because the marks are not one shape:
 * L'Opera Caffè is a wide flourish at roughly 2.4:1 and Blue Velvet is a portrait
 * lock-up at 0.8:1, and a slot that stretched either of them to fit would be
 * handing somebody else's brand back to them damaged. Nothing is cropped and
 * nothing is distorted; a mark that does not fill the box simply does not.
 *
 * It is `alt=""`. The business name is in text two lines down and always will be —
 * the renderer draws it whether or not a logo exists — so announcing the mark as
 * well would read the venue's name twice to anybody listening instead of looking.
 *
 * The intrinsic size is written into the tag so the row does not jump when the
 * image lands, and a partner with no logo gets no box at all: the text simply
 * starts where it would anyway.
 */
function partnerLogo(view) {
  const logo = view.logo;
  if (!logo?.src) return '';
  return `<span class="partner__logo">
    <img src="${esc(logo.src)}" alt="" decoding="async" loading="lazy"
      ${logo.width ? `width="${esc(logo.width)}"` : ''} ${logo.height ? `height="${esc(logo.height)}"` : ''}>
  </span>`;
}

/** Name, category and where — the identity every partner card leads with. */
function partnerIdentity(view, lang) {
  const where = view.address || text(view.area, lang);
  return `<div class="partner__id">
    ${partnerLogo(view)}
    <div class="partner__who">
      <p class="partner__name">${esc(view.partner)}</p>
      ${where ? `<p class="partner__meta">${esc(where)}</p>` : ''}
    </div>
  </div>`;
}

/** Directions, or the verified map pin where a partner has one. Never a guess. */
function partnerDirections(view, lang) {
  const to = view.directions_url
    ? { href: view.directions_url, label: UI[lang].directions }
    : view.maps
      ? { href: view.maps, label: UI[lang].openMaps }
      : null;
  if (!to) return '';
  return `<a class="partner__directions" href="${esc(to.href)}" target="_blank" rel="noopener">
    ${icon('map', 14)}<span>${esc(to.label)}</span>
  </a>`;
}

/**
 * One partner, with everything it gives.
 *
 * The venue line carries the category and the address because that is what gets a
 * guest to the door, and the only action offered is directions. No telephone, no
 * website, no "book a table": none of those was given for these venues, and a CTA
 * that guesses at one is worse than no CTA at all.
 */
export function partnerCard(view, pass, lang) {
  const rows = accessFor(view, pass);
  if (rows.length === 0) return '';

  const state = partnerState(rows);
  const missing = missingFrom(rows);
  const directions = partnerDirections(view, lang);

  return `<li class="partner" data-access="${esc(state)}"
    data-partner="${esc(view.partner_id)}" data-category="${esc(view.category)}">
    ${partnerIdentity(view, lang)}

    <ul class="partner__benefits">
      ${rows.map((row) => benefitRow(row, lang)).join('')}
    </ul>

    ${missing.length || directions ? `<p class="partner__actions">
      ${missing.length
        ? `<span class="partner__lock">${icon('key', 14)}<span>${esc(UI[lang].privilegeLocked)}</span></span>`
        : ''}
      ${directions}
    </p>` : ''}
  </li>`;
}

/** A list of partners, in register order. Grouping by category comes with the tenth. */
export const partnerList = (views, pass, lang) => `
  <ul class="partners">${views.map((view) => partnerCard(view, pass, lang)).join('')}</ul>`;

/**
 * The network, as one list.
 *
 * Who LunArt works with, in the order LunArt curated: the venues with an agreement
 * first, then one quiet rule, then the ones still being set up. Not two sections —
 * a guest scrolls through one list and the far end of it is simply quieter, the way
 * a restaurant that is closed tonight sits at the foot of a delivery app instead of
 * vanishing. The same card geometry throughout, so nothing reads as broken.
 *
 * It is a catalogue and it authorises nothing. The claimable half is drawn by
 * `privilegeSection` and `stayBenefitsSection` from `cardBenefits()` and
 * `stayBenefits()`, which the activating venues cannot reach — see
 * `benefitPartners()`.
 */
function networkCard(view, lang) {
  const soon = view.partnership_status === PARTNERSHIP_STATUS.activating;
  const directions = partnerDirections(view, lang);
  const category = text(view.category_label, lang);

  return `<li class="partner partner--network" data-partner="${esc(view.partner_id)}"
    data-category="${esc(view.category)}" data-status="${esc(view.partnership_status)}">
    ${partnerIdentity(view, lang)}
    <p class="partner__kind">${esc(category)}</p>
    ${soon ? `<p class="partner__soon">${esc(UI[lang].partnerComingSoon)}</p>` : ''}
    ${directions ? `<p class="partner__actions">${directions}</p>` : ''}
  </li>`;
}

export function networkSection(views, lang) {
  if (!views?.length) return '';

  const live = views.filter((v) => v.partnership_status !== PARTNERSHIP_STATUS.activating);
  const soon = views.filter((v) => v.partnership_status === PARTNERSHIP_STATUS.activating);

  return `
    <p class="pass__label" data-section="network">${esc(UI[lang].partnerNetwork)}</p>
    <p class="pass__lead">${esc(UI[lang].partnerNetworkBlurb)}</p>
    <ul class="partners partners--network">
      ${live.map((view) => networkCard(view, lang)).join('')}
      ${soon.length ? `<li class="partners__turn" data-network-turn aria-hidden="true">
        <span>${esc(UI[lang].partnerActivating)}</span>
      </li>` : ''}
      ${soon.map((view) => networkCard(view, lang)).join('')}
    </ul>`;
}

/**
 * The Privilege section of the Pass.
 *
 * The same section for both guests, because they are looking at the same card: one
 * has the upgrade and one does not, and what changes is the sentence under the
 * heading and whether there is a button at the bottom. Building a separate
 * "upsell block" would be the version where Privilege reads as a different product
 * instead of as this Pass, unlocked.
 *
 * `views` is the published register of card partners, not the Pass's own
 * `privileges` — that list is empty for a guest who has not upgraded, which is
 * exactly the guest who needs to see what is in it.
 */
export function privilegeSection(views, pass, lang) {
  if (!views?.length) return '';

  const context = passContextOf(pass);
  const rows = views.flatMap((view) => accessFor(view, pass));

  /**
   * Two independent questions, and the screen has to answer both.
   *
   *   owns   does this reservation carry the entitlement? Nothing to do with dates.
   *   live   is the Pass active today? Nothing to do with what was bought.
   *
   * Running them together is the bug this replaces: a guest who had bought
   * Privilege for a stay in November was shown the same "these unlock with
   * Privilege" line as a guest who had not, because in October neither of them
   * could use anything. One of them had paid.
   */
  const owns = rows.length > 0 && rows.every((row) => row.access.missing.length === 0);
  const live = context.passState === 'active';
  /** Owned, and not in force today: the card's own dates have not arrived, or passed. */
  const dormant = rows.some((row) => row.access.dormant.length > 0);

  /**
   * Four sentences, because there are four reasons a guest is looking at this.
   *
   * The two "not yet" cases are different and must not be run together. A Pass that
   * has not started is about the stay; a card that has not started inside a stay
   * already under way is about the card — a guest on a 1–6 November booking holding
   * two Privilege days for the 3rd is in Florence, with a live Pass, and being told
   * "while your Pass is active" would be telling them about a condition they have
   * already met.
   */
  const lead = !owns
    ? UI[lang].privilegeBenefitsDiscover
    : !live
      ? UI[lang].privilegeWhenActive
      : dormant
        ? UI[lang].privilegeWhenCardActive
        : UI[lang].privilegeBenefitsNote;

  /**
   * Offered to a guest who does not own it and whose stay still has a future.
   *
   * Before arrival is a perfectly good time to buy — the card is sold inside the
   * stay and `cardStartDates` already offers the days it may begin — so this is not
   * gated on the Pass being live today. It goes away once the stay is over or
   * called off, because there would be nothing left to buy it for, and it is never
   * shown to somebody who already paid.
   */
  const canStillBuy = !owns && ['not-started', 'active'].includes(context.passState);

  return `
    <p class="pass__label" data-section="privilege-benefits">${esc(UI[lang].privilegeBenefits)}</p>
    <p class="pass__lead" data-privilege-lead data-owns="${owns}">${esc(lead)}</p>
    ${partnerList(views, pass, lang)}
    ${canStillBuy
      ? `<button class="action action--wide action--primary" type="button" data-product="privilege-card">
           ${icon('card', 16)}${esc(UI[lang].privilegeGet)}
         </button>`
      : ''}`;
}

/**
 * What the stay includes, listed the same way.
 *
 * Same renderer, different register. The separation that matters is commercial, not
 * visual: Opera Caffè's 30% comes with the stay and must never appear under
 * Privilege, and the two headings are what say so.
 */
export const stayBenefitsSection = (views, pass, lang) => (views?.length
  ? `<p class="pass__label" data-section="stay-benefits">${esc(UI[lang].includedWithStay)}</p>
     ${partnerList(views, pass, lang)}`
  : '');
