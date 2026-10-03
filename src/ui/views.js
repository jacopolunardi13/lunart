/**
 * The views that are not the home.
 *
 * Florence, Help and the review screen. Each returns an HTML string; `main.js`
 * owns when they are drawn and what happens when they are tapped. No view invents
 * content — every string comes from `data/`, which is also what the Concierge
 * answers from. The home lives in `home.js`, which has enough composition of its
 * own to be read on its own.
 */

import { esc, t, paragraphs } from './dom.js';
import { icon } from './icons.js';
import { UI } from '../i18n.js';
import { placeRow, facts, actions, sectionBlock } from './components.js';
import {
  getEntry, getPlace, entriesInSection, contacts, emergency,
  itineraries, dayTrips, verifyList, unverifiedContacts,
} from '../../data/index.js';

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
  /**
   * One contact, one channel.
   *
   * Which field holds the number decides what the card does, so a WhatsApp line
   * cannot be dialled and a telephone cannot be messaged: `whatsapp` opens
   * WhatsApp, `phone` opens the dialler, `email` opens mail. The card also says
   * which it is, because a number on a screen looks like a number you can call.
   */
  const people = contacts.map((contact) => {
    const channel = contact.whatsapp
      ? { href: `https://wa.me/${contact.whatsapp.replace(/\D/g, '')}`, label: UI[lang].writeToStaff, icon: 'chat', external: true }
      : contact.phone
        ? { href: `tel:${contact.phone}`, label: UI[lang].callStaff, icon: 'phone', external: false }
        : { href: `mailto:${contact.email}`, label: UI[lang].emailStaff, icon: 'mail', external: false };

    return `<a class="card" href="${esc(channel.href)}" ${channel.external ? 'target="_blank" rel="noopener"' : ''}>
      <span class="card__icon">${icon(channel.icon, 22)}</span>
      <span class="card__body">
        <span class="card__title">${esc(contact.name)}</span>
        <span class="card__summary">${esc(t(contact.role, lang))} · ${esc(contact.display ?? contact.email)}</span>
        <span class="card__meta"><span class="badge">${esc(channel.label)}</span></span>
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
