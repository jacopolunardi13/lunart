/**
 * Reusable fragments. Every one of them reads from the knowledge layer and adds
 * no facts of its own.
 */

import { esc, t, paragraphs } from './dom.js';
import { icon } from './icons.js';
import { UI } from '../i18n.js';

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
           ${icon('copy', 14)}<span>${esc(UI[lang].copy)}</span>
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

export function placeRow(place, lang) {
  const links = [
    `<a class="action" href="${esc(place.maps)}" target="_blank" rel="noopener">
       ${icon('map', 16)}${esc(UI[lang].openMaps)}</a>`,
    place.url
      ? `<a class="action" href="${esc(place.url)}" target="_blank" rel="noopener">
           ${icon('external', 16)}${esc(UI[lang].website)}</a>`
      : '',
  ].join('');

  return `<li class="place">
    <p class="place__name">${esc(place.name)}</p>
    <p class="place__area">${esc(t(place.area, lang))}</p>
    <p class="place__note">${esc(t(place.note, lang))}</p>
    <div class="place__links">${links}</div>
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

export { paragraphs };
