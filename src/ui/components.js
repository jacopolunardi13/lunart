/**
 * Reusable fragments. Every one of them reads from the knowledge layer and adds
 * no facts of its own.
 */

import { esc, t, paragraphs } from './dom.js';
import { icon } from './icons.js';
import { UI } from '../i18n.js';
import { SECTIONS, entriesInSection } from '../../data/index.js';

/** Source photographs are 3:2; the attributes reserve the space before it loads. */
const PHOTO_W = 1024;
const PHOTO_H = 683;

/**
 * A responsive picture. WebP for everyone who can take it, one JPEG for everyone
 * else, and never the full-size file on a phone — which is the whole reason the
 * photographs came out of the HTML.
 */
export function picture(src, alt, { sizes = '100vw', eager = false } = {}) {
  const base = `assets/img/${src}`;
  return `<picture>
    <source type="image/webp" sizes="${esc(sizes)}"
      srcset="${base}-400.webp 400w, ${base}-700.webp 700w, ${base}-1024.webp 1024w">
    <img src="${base}-800.jpg" alt="${esc(alt)}"
      width="${PHOTO_W}" height="${PHOTO_H}"
      loading="${eager ? 'eager' : 'lazy'}" decoding="async"
      ${eager ? 'fetchpriority="high"' : ''}>
  </picture>`;
}

export function facts(list, lang) {
  if (!list?.length) return '';
  const rows = list.map((fact) => {
    const value = esc(t(fact.value, lang));
    const copy = fact.copy
      ? `<button class="fact__copy" type="button" data-copy="${value}">
           <span data-copy-icon>${icon('copy', 14)}</span><span data-copy-label>${esc(UI[lang].copy)}</span>
         </button>`
      : '';
    return `<div class="fact">
      <span class="fact__label">${esc(t(fact.label, lang))}</span>
      <span class="fact__row">
        <span class="fact__value${fact.mono ? ' fact__value--mono' : ''}">${value}</span>${copy}
      </span>
    </div>`;
  }).join('');
  return `<div class="facts">${rows}</div>`;
}

/** Turn one action descriptor into the right kind of control. */
export function action(item, lang, { primary = false } = {}) {
  const label = esc(t(item.label, lang));
  const cls = `action${primary ? ' action--primary' : ''}`;

  switch (item.kind) {
    case 'tel':
      return `<a class="${cls}" href="tel:${esc(item.value)}">${icon('phone', 16)}${label}</a>`;
    case 'whatsapp':
      return `<a class="${cls}" href="https://wa.me/${esc(item.value.replace(/\D/g, ''))}"
         target="_blank" rel="noopener">${icon('chat', 16)}${label}</a>`;
    case 'mailto':
      return `<a class="${cls}" href="mailto:${esc(item.value)}">${icon('mail', 16)}${label}</a>`;
    case 'map':
      return `<a class="${cls}" href="${esc(item.value)}" target="_blank" rel="noopener">
         ${icon('map', 16)}${label}</a>`;
    case 'url':
      return `<a class="${cls}" href="${esc(item.value)}" target="_blank" rel="noopener">
         ${icon('external', 16)}${label}</a>`;
    case 'entry':
      return `<button class="${cls}" type="button" data-entry="${esc(item.value)}">
         ${icon('chevron', 16)}${label}</button>`;
    case 'product':
      return `<button class="${cls}" type="button" data-product="${esc(item.value)}">
         ${icon('gift', 16)}${label}</button>`;
    default:
      return '';
  }
}

export function actions(list, lang) {
  if (!list?.length) return '';
  return `<div class="actions">${list.map((a, i) => action(a, lang, { primary: i === 0 })).join('')}</div>`;
}

/** One entry, as a tappable card. The summary is the answer, not a teaser. */
export function entryCard(entry, lang) {
  return `<button class="card" type="button" data-entry="${esc(entry.id)}">
    <span class="card__icon">${icon(entry.icon, 22)}</span>
    <span class="card__body">
      <span class="card__title">${esc(t(entry.title, lang))}</span>
      <span class="card__summary">${esc(t(entry.summary, lang))}</span>
    </span>
    <span class="card__chevron">${icon('chevron', 16)}</span>
  </button>`;
}

export function quickTile(entry, lang) {
  return `<button class="quick__item" type="button" data-entry="${esc(entry.id)}">
    ${icon(entry.icon, 24)}
    <span class="quick__title">${esc(t(entry.title, lang))}</span>
  </button>`;
}

/**
 * One recommendation.
 *
 * The whole row opens Maps, rather than carrying a separate button: a guest
 * reading this wants to know where the place is, and six restaurants each with
 * their own button turned the page into a column of buttons.
 */
export function placeRow(place, lang) {
  const site = place.url
    ? `<a class="place__site" href="${esc(place.url)}" target="_blank" rel="noopener">
         ${icon('external', 14)}${esc(UI[lang].website)}</a>`
    : '';

  return `<li>
    <a class="place" href="${esc(place.maps)}" target="_blank" rel="noopener">
      <span class="place__body">
        <span class="place__name">${esc(place.name)}</span>
        <span class="place__area">${esc(t(place.area, lang))}</span>
        <span class="place__note">${esc(t(place.note, lang))}</span>
      </span>
      <span class="place__go" aria-hidden="true">${icon('map', 18)}</span>
      <span class="visually-hidden">${esc(UI[lang].openMaps)}</span>
    </a>
    ${site}
  </li>`;
}

/**
 * A scroll-snap carousel.
 *
 * The browser owns the scroll position and the dots follow it, rather than the
 * page keeping its own index. The previous slider tracked an index by hand and
 * used the same argument for "go next" and for "go to slide 1", so the second dot
 * advanced the slide instead of selecting it, and the dots drifted out of step
 * with the photographs as soon as you wrapped around.
 */
export function slider(photos, lang, { label = '' } = {}) {
  if (!photos?.length) return '';
  if (photos.length === 1) {
    return picture(photos[0].src, t(photos[0].alt, lang), { sizes: '(min-width: 600px) 620px, 100vw' });
  }

  const slides = photos.map((photo, i) => `
    <div class="slider__slide" role="group" aria-roledescription="slide"
         aria-label="${esc(UI[lang].slideOf.replace('{n}', i + 1).replace('{total}', photos.length))}">
      ${picture(photo.src, t(photo.alt, lang), { sizes: '(min-width: 600px) 620px, 100vw' })}
    </div>`).join('');

  const dots = photos.map((_, i) => `
    <button class="slider__dot" type="button" data-slide="${i}"
      aria-current="${i === 0 ? 'true' : 'false'}"
      aria-label="${esc(UI[lang].slideOf.replace('{n}', i + 1).replace('{total}', photos.length))}"></button>`).join('');

  return `<div class="slider" data-slider ${label ? `aria-label="${esc(label)}"` : ''} role="region"
       aria-roledescription="carousel">
    <div class="slider__track" data-track tabindex="0">${slides}</div>
    <div class="slider__dots">${dots}</div>
  </div>`;
}

/** Wire up every slider inside a root element. Safe to call again after a re-render. */
export function hydrateSliders(root) {
  for (const slider of root.querySelectorAll('[data-slider]')) {
    const track = slider.querySelector('[data-track]');
    const dots = [...slider.querySelectorAll('[data-slide]')];
    if (!track || dots.length === 0) continue;

    const sync = () => {
      // Ask the DOM where it actually is instead of remembering where we put it.
      const index = Math.round(track.scrollLeft / track.clientWidth);
      dots.forEach((dot, i) => dot.setAttribute('aria-current', String(i === index)));
    };

    let frame = 0;
    track.addEventListener('scroll', () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    }, { passive: true });

    dots.forEach((dot, i) => {
      dot.addEventListener('click', () => {
        track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
      });
    });

    sync();
  }
}

/**
 * One whole section of the knowledge layer, as a titled list of cards.
 *
 * Used by the Help view and, inside a disclosure, by the home — which is why it
 * lives here rather than in either of them.
 */
export function sectionBlock(sectionId, lang, { only, heading = true } = {}) {
  const meta = SECTIONS.find((s) => s.id === sectionId);
  let list = entriesInSection(sectionId);
  if (only) list = list.filter(only);
  if (list.length === 0) return '';

  const cards = `<div class="cards">${list.map((e) => entryCard(e, lang)).join('')}</div>`;
  if (!heading) return cards;

  return `<section class="section" id="section-${esc(sectionId)}" aria-labelledby="h-${esc(sectionId)}">
    <div class="section__head">
      <span style="color:var(--accent)">${icon(meta.icon, 20)}</span>
      <h2 id="h-${esc(sectionId)}">${esc(t(meta.title, lang))}</h2>
    </div>
    <p class="section__blurb">${esc(t(meta.blurb, lang))}</p>
    ${cards}
  </section>`;
}

/**
 * A primary action: one of the four things a guest reaches for without reading.
 *
 * The label is interface chrome rather than an entry title, because an entry is
 * titled to be read in a list ("Check-in e arrivo") and this is read in a glance
 * ("Arrivo"). The destination is always existing content — no fact is restated
 * here.
 */
export function primaryTile({ label, iconId, entry, goto }, lang) {
  const target = entry ? `data-entry="${esc(entry)}"` : `data-goto="${esc(goto)}"`;
  return `<button class="quick__item" type="button" data-primary ${target}>
    ${icon(iconId, 24)}
    <span class="quick__title">${esc(label)}</span>
  </button>`;
}

/**
 * A one-line row: icon, title, chevron. No summary.
 *
 * The card carries the answer in its summary, which is right in a list a guest is
 * reading to decide. In the during-the-stay block they have already decided — they
 * want the five things that matter, close together — so the text stays in the
 * sheet where it was written once.
 */
export function briefRow(entry, lang) {
  return `<button class="brief__row" type="button" data-entry="${esc(entry.id)}">
    <span class="brief__icon">${icon(entry.icon, 19)}</span>
    <span class="brief__title">${esc(t(entry.title, lang))}</span>
    <span class="brief__chevron">${icon('chevron', 15)}</span>
  </button>`;
}

/**
 * A disclosure: a heading that opens.
 *
 * Native `<details>`, so it needs no JavaScript, answers to the keyboard and the
 * screen reader on its own, and keeps working on the static copy of the guide. The
 * contents are in the document either way — which is what makes this shortening
 * the page rather than removing anything from it: search, the Concierge and every
 * `#/e/<id>` link reach inside a closed one exactly as before.
 */
export function disclosure({ id, title, note = '', iconId = null, body, open = false }) {
  if (!body) return '';
  return `<details class="fold" id="${esc(id)}"${open ? ' open' : ''}>
    <summary class="fold__summary">
      ${iconId ? `<span class="fold__icon">${icon(iconId, 19)}</span>` : ''}
      <span class="fold__title">${esc(title)}</span>
      ${note ? `<span class="fold__note">${esc(note)}</span>` : ''}
      <span class="fold__mark">${icon('chevron', 16)}</span>
    </summary>
    <div class="fold__body">${body}</div>
  </details>`;
}

export { paragraphs };
