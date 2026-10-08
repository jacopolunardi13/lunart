/**
 * The home of a guest who has already booked.
 *
 * The guide holds everything LunArt knows, and the previous home showed all of it
 * in one column: thirty-five entry cards, five room carousels, eleven screens of
 * scrolling. Every fact was right and nothing was findable.
 *
 * So this page is shorter without being smaller. Five sections, each answering one
 * question a guest actually has — what is my stay, what happens while I am here,
 * what else can I ask for, what about Florence, and where is everything else — and
 * the everything else sits behind disclosures that are still in the document. The
 * Concierge, the search and every `#/e/<id>` link reach the same content they
 * always did; a closed `<details>` hides it from the eye, not from the app.
 *
 * On a personal link it goes further: the greeting is theirs, the room shown is the
 * room they are sleeping in, and the question "where are you up to?" is not asked,
 * because the dates already answered it.
 */

import { esc, t } from './dom.js';
import { icon } from './icons.js';
import { UI } from '../i18n.js';
import {
  entryCard, slider, picture, sectionBlock, primaryTile, briefRow, disclosure,
} from './components.js';
import { guest, isPersonal } from '../guest.js';
import {
  PHASES, getEntry, property, rooms, roomsCommon,
} from '../../data/index.js';
import { roomsIn, roomList } from '../../commerce/rooms.js';

/**
 * Filled in by `src/commerce/boot.js` once the shop has loaded. Until then — and
 * on a copy of the guide with no commerce server behind it — it renders nothing,
 * which is exactly what should happen.
 */
let renderShopTeaser = () => '';
export const setShopTeaser = (fn) => { renderShopTeaser = fn; };

/* --- The welcome ----------------------------------------------------------- */

/**
 * The greeting.
 *
 * Time of day and a first name, which is how an Italian concierge greets you and
 * is the one welcome that is always right: "benvenuta" and "benvenuto" differ, a
 * reservation carries no gender, and a name is not evidence of one. Guessing would
 * misgender real guests for the sake of one word.
 */
function greeting(lang) {
  const hour = new Date().getHours();
  const time = hour < 12 ? (lang === 'it' ? 'Buongiorno' : 'Good morning')
    : hour < 18 ? (lang === 'it' ? 'Buon pomeriggio' : 'Good afternoon')
      : (lang === 'it' ? 'Buonasera' : 'Good evening');
  const name = guest()?.first_name;
  return name ? `${time}, ${name}` : time;
}

const MONTH = (date, lang) => new Intl.DateTimeFormat(lang === 'it' ? 'it-IT' : 'en-GB',
  { month: 'long', timeZone: 'Europe/Rome' }).format(new Date(`${date}T12:00:00Z`));
const DAY = (date) => Number(date.slice(8, 10));

/**
 * The stay in as few words as it takes: "31 ottobre – 2 novembre", or
 * "3 – 6 ottobre" when both ends fall in the same month. No year — a guest knows
 * which one they are in — and no booking number, which is not theirs to carry
 * around in a URL.
 */
function stayDates(lang) {
  const context = guest();
  if (!context?.check_in || !context?.check_out) return '';
  const from = context.check_in;
  const to = context.check_out;
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${DAY(from)} – ${DAY(to)} ${MONTH(from, lang)}`;
  }
  return `${DAY(from)} ${MONTH(from, lang)} – ${DAY(to)} ${MONTH(to, lang)}`;
}

/**
 * The personal header.
 *
 * A photograph, a greeting, and one line of fact: the room if we know it and the
 * dates. Compact on purpose — it is the frame around the stay, not the stay — so
 * the four things a guest came for are on the first screen with it.
 */
function welcome(lang) {
  const context = guest();
  const line = [
    guestRoomLine(lang),
    stayDates(lang),
  ].filter(Boolean).join(' · ');

  return `
    <section class="welcome" aria-labelledby="h-hero">
      <div class="welcome__frame${isPersonal() ? ' welcome__frame--compact' : ''}">
        ${picture('views/arno-ponte-vecchio',
    lang === 'it' ? 'L’Arno e Ponte Vecchio visti dalle finestre di LunArt'
      : 'The Arno and Ponte Vecchio seen from the windows of LunArt',
    { sizes: '(min-width: 760px) 720px, 100vw', eager: true })}
        <div class="welcome__caption">
          <p class="eyebrow">${esc(t(property.shortTagline, lang))}</p>
          <h1 id="h-hero" class="welcome__greeting">${esc(greeting(lang))}</h1>
        </div>
      </div>
      ${line || context?.cancelled ? `<div class="stay">
        ${line ? `<p class="stay__line">${esc(line)}</p>` : ''}
        ${context?.cancelled ? `<div class="notice notice--attention">
          <span>${icon('alert', 18)}</span>
          <div>
            <p><strong>${esc(UI[lang].stayCancelled)}</strong></p>
            <p>${esc(UI[lang].stayCancelledBody)}</p>
          </div>
        </div>` : ''}
      </div>` : ''}
    </section>`;
}

/* --- The four primary actions ---------------------------------------------- */

/**
 * The four things reached with one thumb.
 *
 * Fixed in meaning, reordered by the moment: a guest who has not arrived wants the
 * door first, a guest in the room wants the Wi-Fi, a guest leaving wants check-out.
 * Each one opens content that already exists — the arrival slot resolves to the
 * check-in entry before arrival and to the door-and-keys entry once they are
 * inside, because that is the same question asked from two places.
 */
function primaryActions(lang, phase) {
  const SLOTS = {
    arrival:   { label: UI[lang].primaryArrival,   iconId: 'key',      entry: 'checkin' },
    access:    { label: UI[lang].primaryArrival,   iconId: 'key',      entry: 'access' },
    departure: { label: UI[lang].primaryDeparture, iconId: 'suitcase', entry: 'checkout' },
    wifi:      { label: UI[lang].primaryWifi,      iconId: 'wifi',     entry: 'wifi' },
    breakfast: { label: UI[lang].primaryBreakfast, iconId: 'cup',      entry: 'breakfast' },
    help:      { label: UI[lang].primaryHelp,      iconId: 'lifebuoy', goto: 'help' },
  };

  const order = {
    before:  ['arrival', 'wifi', 'breakfast', 'help'],
    staying: ['wifi', 'breakfast', 'access', 'help'],
    leaving: ['departure', 'breakfast', 'wifi', 'help'],
  }[phase] ?? ['arrival', 'wifi', 'breakfast', 'help'];

  return `<section class="quick" aria-labelledby="h-quick">
    <h2 class="visually-hidden" id="h-quick">${esc(UI[lang].quickTitle)}</h2>
    <div class="quick__grid">
      ${order.map((slot) => primaryTile(SLOTS[slot], lang)).join('')}
    </div>
  </section>`;
}

/* --- A. Your stay ---------------------------------------------------------- */

/**
 * Which room, or which rooms, in one phrase.
 *
 * A booking is not always one room: Booking.com sells a group of seven the whole
 * floor, and the guide used to greet them with "Camera 305" because that was the
 * first number in the notification. So the plural is a real case rather than a
 * defensive one — `Camere 302, 303, 304 e 305` — and the singular reads exactly
 * as it always has. Nothing at all when the room is not known yet, which is what
 * a provisional stay from a calendar feed looks like.
 */
function guestRoomLine(lang) {
  const list = roomsIn(guest());
  if (list.length === 0) return '';
  const label = list.length === 1 ? UI[lang].roomLabel : UI[lang].roomsLabel;
  return `${label} ${roomList(list, lang)}`;
}

/**
 * The room this guest is actually sleeping in, or nothing.
 *
 * Deliberately nothing for a booking across several rooms: this picks the record
 * whose photographs and description are shown, and there is no honest way to
 * choose one of four. The header above still names them all, so the group is told
 * which rooms are theirs without the page claiming one of them is *the* room.
 */
const roomOfGuest = () => {
  const list = roomsIn(guest());
  return list.length === 1 ? rooms.find((r) => r.number === list[0]) ?? null : null;
};

/**
 * The guest's own room, and nobody else's.
 *
 * A guest in 303 has no use for a catalogue of five rooms: they have already
 * chosen, they are standing in the answer, and the other four are somebody else's
 * room. So on a personal link this is the only room that appears anywhere — the
 * records for all five stay in `data/rooms.js`, because the guest in 302 needs 302
 * and the guest in 304 needs 304; what changes is which one this guide shows.
 */
function assignedRoom(lang) {
  const room = roomOfGuest();
  if (!room) return '';

  return `<article class="room room--assigned">
    ${slider(room.photos, lang, { label: `${t(room.category, lang)} ${room.number}` })}
    <div class="room__head">
      <h3 class="room__number">${esc(UI[lang].roomLabel)} ${esc(room.number)}</h3>
      <span class="room__badge room__badge--highlight">${esc(t(room.category, lang))}</span>
    </div>
    ${room.view ? `<p class="room__meta">${esc(t(room.view, lang))}</p>` : ''}
    <p class="room__summary">${esc(t(room.summary, lang))}</p>
  </article>`;
}

/** The logistics of the moment: three cards, not a section's worth. */
const STAY_ESSENTIALS = {
  before:  ['checkin', 'access', 'parking'],
  staying: ['access', 'climate', 'amenities'],
  leaving: ['checkout', 'luggage-late', 'taxi'],
};

function yourStay(lang, phase) {
  const essentials = (STAY_ESSENTIALS[phase] ?? STAY_ESSENTIALS.before).map(getEntry).filter(Boolean);
  const room = assignedRoom(lang);
  if (!room && essentials.length === 0) return '';

  return `<section class="section" aria-labelledby="h-your-stay">
    <div class="section__head">
      <span style="color:var(--accent)">${icon('home', 20)}</span>
      <h2 id="h-your-stay">${esc(UI[lang].sectionYourStay)}</h2>
    </div>
    ${room}
    ${room ? `<p class="room__common">${esc(t(roomsCommon, lang))}</p>` : ''}
    <div class="cards${room ? ' cards--after-room' : ''}">${essentials.map((e) => entryCard(e, lang)).join('')}</div>
  </section>`;
}

/* --- B. During the stay ---------------------------------------------------- */

/**
 * The five things that come up while a guest is here.
 *
 * Breakfast and the Opera benefit, the cleaning, the bags, and a person to talk
 * to. One line each: the text was written once, in the entry, and repeating it
 * here would only make the page longer without making it say more.
 */
function duringTheStay(lang, phase) {
  const luggage = phase === 'before' ? 'luggage-early' : 'luggage-late';
  const list = ['breakfast', 'opera-benefit', 'cleaning', luggage, 'contacts']
    .map(getEntry).filter(Boolean);
  if (list.length === 0) return '';

  return `<section class="section" aria-labelledby="h-during">
    <div class="section__head">
      <span style="color:var(--accent)">${icon('clock', 20)}</span>
      <h2 id="h-during">${esc(UI[lang].sectionDuring)}</h2>
    </div>
    <div class="brief">${list.map((e) => briefRow(e, lang)).join('')}</div>
  </section>`;
}

/* --- C. Private return offer ---------------------------------------------- */

const CASH_SPRINT_START = '2026-10-09';
const CASH_SPRINT_END = '2026-10-16';

function cashSprintActive() {
  const today = guest()?.today;
  return Boolean(isPersonal() && today && today >= CASH_SPRINT_START && today <= CASH_SPRINT_END);
}

function returnPassOffer(lang) {
  if (!cashSprintActive()) return '';

  const copy = lang === 'it'
    ? {
        title: 'Torna a Firenze',
        blurb: 'Offerta privata LunArt, disponibile fino al 16 ottobre o esaurimento dei pass.',
        p300: 'Paga €300 · ricevi €360 di credito',
        p500: 'Paga €500 · ricevi €600 di credito',
        p750: 'Paga €750 · ricevi €900 + 2 giorni Privilege',
        note: 'Credito valido 12 mesi per prenotazioni dirette, soggetto a disponibilità, non convertibile in denaro e non cumulabile con altre offerte.',
      }
    : {
        title: 'Come back to Florence',
        blurb: 'A private LunArt offer, available until 16 October or until the passes sell out.',
        p300: 'Pay €300 · receive €360 stay credit',
        p500: 'Pay €500 · receive €600 stay credit',
        p750: 'Pay €750 · receive €900 + 2 Privilege days',
        note: 'Credit valid for 12 months on direct bookings, subject to availability, not redeemable for cash and not combinable with other offers.',
      };

  return `<section class="section" aria-labelledby="h-return-pass">
    <div class="section__head">
      <span style="color:var(--accent)">${icon('card', 20)}</span>
      <h2 id="h-return-pass">${esc(copy.title)}</h2>
    </div>
    <p class="section__blurb">${esc(copy.blurb)}</p>
    <div class="actions">
      <a class="action action--wide" href="https://lunart-production.onrender.com/return-pass.html?tier=300" target="_blank" rel="noopener">${esc(copy.p300)}${icon('chevron', 16)}</a>
      <a class="action action--wide" href="https://lunart-production.onrender.com/return-pass.html?tier=500" target="_blank" rel="noopener">${esc(copy.p500)}${icon('chevron', 16)}</a>
      <a class="action action--wide action--primary" href="https://lunart-production.onrender.com/return-pass.html?tier=750" target="_blank" rel="noopener">${esc(copy.p750)}${icon('chevron', 16)}</a>
    </div>
    <p class="hint" style="margin-top:10px">${esc(copy.note)}</p>
  </section>`;
}

/* --- D. Florence ----------------------------------------------------------- */

/**
 * Florence, as one door rather than as a second guide.
 *
 * The restaurants, the gelato, the itineraries and the day trips are all still
 * there — in their own view, which this opens. They were never the operational
 * half of a stay, and on the home they buried it.
 */
function florenceCard(lang) {
  return `<section class="section" aria-labelledby="h-florence-card">
    <h2 class="visually-hidden" id="h-florence-card">${esc(UI[lang].florence)}</h2>
    <button class="feature" type="button" data-goto="florence">
      <span class="feature__frame">
        ${picture('views/arno-palazzi',
    lang === 'it' ? 'I palazzi sull’Arno al tramonto' : 'The palazzi along the Arno at dusk',
    { sizes: '(min-width: 760px) 720px, 100vw' })}
      </span>
      <span class="feature__caption">
        <span class="feature__title">${esc(UI[lang].discoverFlorence)}</span>
        <span class="feature__note">${esc(UI[lang].discoverFlorenceNote)}</span>
      </span>
      <span class="feature__mark">${icon('chevron', 18)}</span>
    </button>
  </section>`;
}

/* --- E. Everything else ---------------------------------------------------- */

/**
 * The whole knowledge base, one tap away instead of one scroll long.
 *
 * Nothing is dropped: every entry of every section is here, and the five rooms
 * with it. They sit inside disclosures, which keeps the page short without taking
 * the content out of the document — the search finds them, the Concierge answers
 * from them, and a link straight to one still opens it.
 */
function everythingElse(lang) {
  const SECTION_ICONS = { arrival: 'key', stay: 'home', breakfast: 'cup', departure: 'suitcase' };
  const folds = ['arrival', 'stay', 'breakfast', 'departure'].map((id) => disclosure({
    id: `fold-${id}`,
    iconId: SECTION_ICONS[id],
    title: t(sectionTitle(id), lang),
    body: sectionBlock(id, lang, { heading: false }),
  })).join('');

  /**
   * The catalogue of the other rooms, on the public guide only.
   *
   * Somebody deciding where to stay wants to see the five rooms. Somebody who has
   * already booked 303 does not: 301, 302, 304 and 305 are other people's rooms,
   * and a catalogue on their own guide is a shop window where a home should be.
   * Their room is at the top of this page instead, with what every room has.
   */
  const catalogue = isPersonal() ? '' : disclosure({
    id: 'fold-rooms',
    iconId: 'door',
    title: UI[lang].rooms,
    body: `<p class="fold__lead">${esc(t(roomsCommon, lang))}</p>${rooms.map((room) => roomCard(room, lang)).join('')}`,
  });

  return `<section class="section" aria-labelledby="h-more">
    <div class="section__head">
      <span style="color:var(--accent)">${icon('compass', 20)}</span>
      <h2 id="h-more">${esc(UI[lang].sectionMore)}</h2>
    </div>
    <div class="folds">
      ${folds}
      ${catalogue}
    </div>
  </section>`;
}

const sectionTitle = (id) => ({
  arrival:   { it: 'Arrivo e accesso',  en: 'Arrival and access' },
  stay:      { it: 'In camera',         en: 'In the room' },
  breakfast: { it: 'Colazione',         en: 'Breakfast' },
  departure: { it: 'Partenza',          en: 'Departure' },
}[id]);

/** The catalogue entry for one room, as it reads in the secondary list. */
function roomCard(room, lang) {
  const badge = room.comingSoon
    ? `<span class="room__badge">${esc(UI[lang].comingSoon)}</span>`
    : `<span class="room__badge${room.highlight ? ' room__badge--highlight' : ''}">${esc(t(room.category, lang))}</span>`;

  return `<article class="room">
    ${slider(room.photos, lang, { label: `${t(room.category, lang)} ${room.number}` })}
    <div class="room__head">
      <h3 class="room__number">${esc(room.number)}</h3>
      ${badge}
    </div>
    ${room.view ? `<p class="room__meta">${esc(t(room.view, lang))}</p>` : ''}
    <p class="room__summary">${esc(t(room.summary, lang))}</p>
  </article>`;
}

/* --- The page -------------------------------------------------------------- */

export function homeView(lang, phase) {
  /**
   * The phase question, asked only when nobody has answered it.
   *
   * A personal link carries dates, so the guide already knows; asking anyway would
   * be a form where an answer exists. Without a link we genuinely do not know, and
   * a wrong guess hides the one thing the guest came for — so the public guide
   * still asks, and the choice still only reorders.
   */
  const phases = isPersonal() ? '' : `
    <section class="phases" aria-labelledby="h-phase">
      <p class="eyebrow phases__label" id="h-phase">${esc(UI[lang].phaseLabel)}</p>
      <div class="phases__list" role="group" aria-labelledby="h-phase">
        ${PHASES.map((p) => `
          <button class="phase-chip" type="button" data-phase="${esc(p.id)}"
            aria-pressed="${p.id === phase}">${esc(t(p.short, lang))}</button>`).join('')}
      </div>
    </section>`;

  return `
    ${welcome(lang)}
    ${primaryActions(lang, phase)}
    ${phases}

    <!--
      The Pass, and anything this guest has bought.

      Drawn after the first paint, because both come from the server and the guide
      must not wait on either — but given their own place in the page rather than
      appended to the end of another section, which is where they were and where
      nobody found them. The Pass comes with the stay and belongs near the top of
      it; a purchase a guest made two minutes ago is the thing they are most likely
      to have opened the guide to check.
    -->
    <div data-pass-block></div>
    <div data-purchases-block></div>

    ${cashSprintActive() ? renderShopTeaser(lang) : ''}
    ${returnPassOffer(lang)}
    ${yourStay(lang, phase)}
    ${duringTheStay(lang, phase)}
    ${cashSprintActive() ? '' : renderShopTeaser(lang)}
    ${florenceCard(lang)}

    <button class="search-trigger" type="button" data-open-search>
      ${icon('search', 18)}<span>${esc(UI[lang].search)}</span>
    </button>

    ${everythingElse(lang)}

    <section class="about" aria-labelledby="h-about">
      <p class="eyebrow" id="h-about">${esc(UI[lang].about)}</p>
      <p>${esc(t(property.intro, lang))}</p>
    </section>
  `;
}
