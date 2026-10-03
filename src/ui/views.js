/**
 * The three top-level views.
 *
 * Each returns an HTML string; `main.js` owns when they are drawn and what
 * happens when they are tapped. No view invents content — every string comes from
 * `data/`, which is also what the Concierge answers from.
 */

import { esc, t, paragraphs } from './dom.js';
import { icon } from './icons.js';
import { UI } from '../i18n.js';
import { entryCard, quickTile, placeRow, slider, facts, actions, picture } from './components.js';

/**
 * Filled in by `src/commerce/boot.js` once the shop has loaded. Until then — and
 * on a copy of the guide with no commerce server behind it — it renders nothing,
 * which is exactly what should happen.
 */
let renderShopTeaser = () => '';
export const setShopTeaser = (fn) => { renderShopTeaser = fn; };
import {
  SECTIONS, PHASES, entries, entriesInSection, getEntry, getPlace,
  QUICK_ACTIONS, property, contacts, emergency, rooms, roomsCommon,
  itineraries, dayTrips, verifyList, unverifiedContacts,
} from '../../data/index.js';

const GUIDE_SECTIONS = ['arrival', 'stay', 'breakfast', 'departure'];

/** Sections, ordered so the one that matches the guest's moment comes first. */
function orderedSections(phase) {
  const weight = (sectionId) => {
    const relevant = entriesInSection(sectionId).filter((e) => e.phase.includes(phase)).length;
    return -relevant;
  };
  return [...GUIDE_SECTIONS].sort((a, b) => weight(a) - weight(b));
}

function greeting(lang) {
  const hour = new Date().getHours();
  if (hour < 12) return lang === 'it' ? 'Buongiorno' : 'Good morning';
  if (hour < 18) return lang === 'it' ? 'Buon pomeriggio' : 'Good afternoon';
  return lang === 'it' ? 'Buonasera' : 'Good evening';
}

function sectionBlock(sectionId, lang, { only } = {}) {
  const meta = SECTIONS.find((s) => s.id === sectionId);
  let list = entriesInSection(sectionId);
  if (only) list = list.filter(only);
  if (list.length === 0) return '';

  return `<section class="section" id="section-${esc(sectionId)}" aria-labelledby="h-${esc(sectionId)}">
    <div class="section__head">
      <span style="color:var(--accent)">${icon(meta.icon, 20)}</span>
      <h2 id="h-${esc(sectionId)}">${esc(t(meta.title, lang))}</h2>
    </div>
    <p class="section__blurb">${esc(t(meta.blurb, lang))}</p>
    <div class="cards">${list.map((e) => entryCard(e, lang)).join('')}</div>
  </section>`;
}

function roomsBlock(lang) {
  const cards = rooms.map((room) => {
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
  }).join('');

  return `<section class="section" aria-labelledby="h-rooms">
    <div class="section__head">
      <span style="color:var(--accent)">${icon('home', 20)}</span>
      <h2 id="h-rooms">${esc(UI[lang].rooms)}</h2>
    </div>
    <p class="section__blurb">${esc(t(roomsCommon, lang))}</p>
    ${cards}
  </section>`;
}

export function guideView(lang, phase) {
  const quick = (QUICK_ACTIONS[phase] ?? []).map(getEntry).filter(Boolean);

  const phaseChips = PHASES.map((p) => `
    <button class="phase-chip" type="button" data-phase="${esc(p.id)}"
      aria-pressed="${p.id === phase}">${esc(t(p.title, lang))}</button>`).join('');

  // Order matters more than it looks: a guest standing in the stairwell wants the
  // door code, not the story of the name. The story is still here — at the end.
  return `
    <section class="hero" aria-labelledby="h-hero">
      <div class="hero__frame">
        ${picture('views/arno-ponte-vecchio',
          lang === 'it' ? 'L’Arno e Ponte Vecchio visti dalle finestre di LunArt'
                        : 'The Arno and Ponte Vecchio seen from the windows of LunArt',
          { sizes: '(min-width: 760px) 720px, 100vw', eager: true })}
        <div class="hero__caption">
          <p class="eyebrow">${esc(t(property.shortTagline, lang))}</p>
          <h1 id="h-hero" class="hero__greeting">${esc(greeting(lang))}</h1>
        </div>
      </div>
    </section>

    <section class="phases" aria-labelledby="h-phase">
      <p class="eyebrow phases__label" id="h-phase">${esc(UI[lang].phaseLabel)}</p>
      <div class="phases__list" role="group" aria-labelledby="h-phase">${phaseChips}</div>
    </section>

    <section class="quick" aria-labelledby="h-quick">
      <p class="eyebrow" id="h-quick">${esc(UI[lang].quickTitle)}</p>
      <div class="quick__grid">${quick.map((e) => quickTile(e, lang)).join('')}</div>
    </section>

    <button class="search-trigger" type="button" data-open-search>
      ${icon('search', 18)}<span>${esc(UI[lang].search)}</span>
    </button>

    <!-- Filled in after the first paint with whatever this guest already holds. -->
    <div data-guest-blocks></div>

    ${renderShopTeaser(lang)}

    ${orderedSections(phase).map((id) => sectionBlock(id, lang)).join('')}
    ${roomsBlock(lang)}

    <section class="about" aria-labelledby="h-about">
      <p class="eyebrow" id="h-about">${esc(UI[lang].about)}</p>
      <p>${esc(t(property.intro, lang))}</p>
    </section>
  `;
}

export function florenceView(lang) {
  const blocks = entriesInSection('florence').map((entry) => {
    let body = '';

    if (entry.places) {
      body = `<ul>${entry.places.map(getPlace).filter(Boolean).map((p) => placeRow(p, lang)).join('')}</ul>`;
    } else if (entry.itineraries) {
      body = itineraries.map((item) => `
        <div class="place">
          <p class="place__name">${esc(t(item.title, lang))}</p>
          <div class="place__note prose">${paragraphs(t(item.body, lang))}</div>
        </div>`).join('');
    } else if (entry.dayTrips) {
      body = dayTrips.map((trip) => `
        <div class="place">
          <p class="place__name">${esc(trip.name)}</p>
          <p class="place__note">${esc(t(trip.how, lang))}</p>
        </div>`).join('');
    }

    return `<section class="section" aria-labelledby="h-${esc(entry.id)}">
      <div class="section__head">
        <span style="color:var(--accent)">${icon(entry.icon, 20)}</span>
        <h2 id="h-${esc(entry.id)}">${esc(t(entry.title, lang))}</h2>
      </div>
      <p class="section__blurb">${esc(t(entry.summary, lang))}</p>
      ${entry.detail ? `<div class="prose" style="margin-bottom:12px">${paragraphs(t(entry.detail, lang))}</div>` : ''}
      ${body}
      ${actions(entry.actions, lang)}
    </section>`;
  }).join('');

  return `<h1 class="visually-hidden">${esc(UI[lang].florence)}</h1>${blocks}`;
}

export function helpView(lang) {
  const people = contacts.map((contact) => {
    const link = contact.whatsapp
      ? `https://wa.me/${contact.phone.replace(/\D/g, '')}`
      : contact.email ? `mailto:${contact.email}` : `tel:${contact.phone}`;
    const label = contact.whatsapp ? UI[lang].writeToStaff
      : contact.email ? UI[lang].emailStaff : UI[lang].callStaff;

    return `<a class="card" href="${esc(link)}" ${contact.whatsapp ? 'target="_blank" rel="noopener"' : ''}>
      <span class="card__icon">${icon(contact.email ? 'mail' : 'chat', 22)}</span>
      <span class="card__body">
        <span class="card__title">${esc(contact.name)}</span>
        <span class="card__summary">${esc(t(contact.role, lang))} · ${esc(contact.display ?? contact.email)}</span>
      </span>
      <span class="card__chevron">${icon('chevron', 16)}</span>
    </a>`;
  }).join('');

  const numbers = emergency.map((item) => {
    const label = esc(t(item.label, lang));
    if (item.number) {
      return `<a class="card" href="tel:${esc(item.number)}">
        <span class="card__icon">${icon('alert', 22)}</span>
        <span class="card__body"><span class="card__title">${label}</span>
          <span class="card__summary">${esc(item.number)}</span></span>
      </a>`;
    }
    if (item.maps) {
      return `<a class="card" href="${esc(item.maps)}" target="_blank" rel="noopener">
        <span class="card__icon">${icon('map', 22)}</span>
        <span class="card__body"><span class="card__title">${label}</span></span>
      </a>`;
    }
    return `<button class="card" type="button" data-entry="${esc(item.entry)}">
      <span class="card__icon">${icon('chat', 22)}</span>
      <span class="card__body"><span class="card__title">${label}</span></span>
    </button>`;
  }).join('');

  return `
    <h1 class="visually-hidden">${esc(UI[lang].help)}</h1>
    <section class="section" aria-labelledby="h-people">
      <div class="section__head">
        <span style="color:var(--accent)">${icon('chat', 20)}</span>
        <h2 id="h-people">${esc(t(getEntry('contacts').title, lang))}</h2>
      </div>
      <p class="section__blurb">${esc(t(getEntry('contacts').summary, lang))}</p>
      <div class="cards">${people}</div>
    </section>

    ${sectionBlock('help', lang, { only: (e) => e.id !== 'contacts' })}

    <section class="section" aria-labelledby="h-emergency">
      <div class="section__head">
        <span style="color:var(--accent)">${icon('lifebuoy', 20)}</span>
        <h2 id="h-emergency">${esc(UI[lang].emergencyTitle)}</h2>
      </div>
      <div class="cards">${numbers}</div>
    </section>
  `;
}

/** Only rendered with ?review=1. Never part of what a guest sees. */
export function reviewView(lang) {
  const items = verifyList().map((item) => `
    <div class="review__item">
      <span class="review__level" data-level="${esc(item.level)}">${esc(item.level)}</span>
      <strong> ${esc(t(item.title, lang))}</strong>
      ${item.field ? ` <em>(${esc(item.field)})</em>` : ''}
      <p style="margin-top:6px;color:var(--ink-strong)">${esc(item.note)}</p>
    </div>`).join('');

  // Details an external draft introduced that LunArt has not confirmed. They are
  // deliberately absent from the guide; this is the only place they appear.
  const held = unverifiedContacts.map((item) => `
    <div class="review__item">
      <span class="review__level" data-level="blocker">non pubblicato</span>
      <strong> ${esc(item.label)}</strong> — <code>${esc(item.value)}</code>
      <p style="margin-top:6px;color:var(--ink-strong)">${esc(item.note)}</p>
    </div>`).join('');

  return `<section class="review">
    <p class="eyebrow">${esc(UI[lang].reviewNote)}</p>
    <h2 style="margin:8px 0 4px">${esc(UI[lang].reviewTitle)}</h2>
    ${items}
    ${held}
  </section>`;
}

export { facts, actions };
