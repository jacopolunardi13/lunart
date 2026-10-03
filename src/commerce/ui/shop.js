/**
 * Experiences & Extras.
 *
 * Shaped like the rest of the guide on purpose: the same cards, the same sheets,
 * the same typography. A guest who has already booked should not feel handed over
 * to a shop — the wine they order is as much part of the stay as the Wi-Fi
 * password, and it reads that way.
 */

import { esc, t } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { UI } from '../../i18n.js';
import { money, priceRange, noticeLabel } from './format.js';
import { COMMERCE_CATEGORIES } from '../../../commerce/schema.js';
import { PRODUCTS } from '../../../commerce/catalog.js';
import { isPurchasable } from '../../../commerce/index.js';
import { catalogueAvailable, catalogueProblem } from '../api.js';

/**
 * The offer that lives inside the guide, before a guest ever opens the shop.
 *
 * Three things, chosen rather than listed, each with what it is and what it costs:
 * a concierge saying "we can also do this", not a menu asking to be browsed. The
 * whole catalogue is one tap further on, and that is where a service nobody has
 * priced yet belongs — a home that offers something unbuyable is a home that wastes
 * the tap.
 */
export function shopTeaser(lang) {
  if (!catalogueAvailable()) return '';
  const featured = PRODUCTS
    .filter((p) => p.active && p.featured && !p.comingSoon && p.status !== 'coming-soon')
    .filter((p) => isPurchasable(p, { allowPlaceholders: true }) || p.purchaseMode === 'request-only')
    .slice(0, 3);
  if (featured.length === 0) return '';

  return `<section class="section" aria-labelledby="h-extras">
    <div class="section__head">
      <span style="color:var(--accent)">${icon('gift', 20)}</span>
      <h2 id="h-extras">${esc(UI[lang].extras)}</h2>
    </div>
    <p class="section__blurb">${esc(UI[lang].extrasHomeBlurb)}</p>
    <div class="offers">
      ${featured.map((product) => offerCard(product, lang)).join('')}
    </div>
    <button class="action action--wide" type="button" data-shop>
      ${esc(UI[lang].seeAllExtras)}${icon('chevron', 16)}
    </button>
  </section>`;
}

/**
 * One offer.
 *
 * Warmer and larger than an entry card, because this is something being offered
 * rather than something being explained — but still the guide's typography, the
 * guide's radius, the guide's accent. A guest who has booked a room should not feel
 * handed over to a shop halfway down their own guide.
 */
function offerCard(product, lang) {
  const range = priceRange(product);
  const purchasable = isPurchasable(product, { allowPlaceholders: true });

  const note = product.purchaseMode === 'request-only'
    ? `<span class="badge">${esc(UI[lang].onRequestBadge)}</span>`
    : range?.anyPlaceholder
      // Never a figure nobody has signed off, shown as though it were final.
      ? `<span class="badge badge--warn">${esc(UI[lang].provisionalPrice)}</span>`
      : '';

  return `<button class="offer" type="button" data-product="${esc(product.id)}">
    <span class="offer__icon">${icon(tileIcon(product), 22)}</span>
    <span class="offer__body">
      <span class="offer__title">${esc(t(product.title, lang))}</span>
      <span class="offer__summary">${esc(t(product.summary, lang))}</span>
    </span>
    <span class="offer__meta">
      ${range && purchasable ? `<span class="offer__price">${esc(fromLabel(range, lang))}</span>` : ''}
      ${note}
    </span>
  </button>`;
}

const tileIcon = (product) => ({
  'privilege-card': 'card',
  'light-breakfast': 'tray', brunch: 'tray', 'sunrise-breakfast': 'cup',
  'wine-in-room': 'wine',
  'transfer-airport': 'car', 'luggage-transfer': 'suitcase',
  'hair-service': 'scissors',
  celebration: 'glass',
  'chianti-experience': 'hills',
}[product.id] ?? 'gift');

function fromLabel(range, lang) {
  const amount = money(range.min, { lang });
  if (range.min === range.max) return amount;
  return lang === 'it' ? `da ${amount}` : `from ${amount}`;
}

/** The shop itself. */
export function shopView(lang) {
  if (!catalogueAvailable()) {
    const problem = catalogueProblem();
    return `<h1 class="visually-hidden">${esc(UI[lang].extras)}</h1>
      <section class="section">
        <div class="section__head">
          <span style="color:var(--accent)">${icon('gift', 20)}</span>
          <h2>${esc(UI[lang].extras)}</h2>
        </div>
        <p class="section__blurb">${esc(UI[lang].shopUnavailable)}</p>
        <div class="actions">
          <button class="action action--primary" type="button" data-entry="contacts">
            ${icon('chat', 16)}${esc(UI[lang].writeToStaff)}
          </button>
        </div>
        ${problem ? `<p class="hint" style="margin-top:10px">${esc(problem.message)}</p>` : ''}
      </section>`;
  }

  const sections = COMMERCE_CATEGORIES.map((category) => {
    const products = PRODUCTS.filter((p) => p.category === category.id && p.active);
    if (products.length === 0) return '';
    return `<section class="section" aria-labelledby="h-shop-${esc(category.id)}">
      <div class="section__head">
        <span style="color:var(--accent)">${icon(category.icon, 20)}</span>
        <h2 id="h-shop-${esc(category.id)}">${esc(t(category.title, lang))}</h2>
      </div>
      <p class="section__blurb">${esc(t(category.blurb, lang))}</p>
      <div class="cards">${products.map((p) => productCard(p, lang)).join('')}</div>
    </section>`;
  }).join('');

  return `<h1 class="visually-hidden">${esc(UI[lang].extras)}</h1>${sections}`;
}

export function productCard(product, lang) {
  const range = priceRange(product);
  const purchasable = isPurchasable(product, { allowPlaceholders: true });

  if (product.comingSoon) {
    return `<div class="card is-coming-soon" aria-disabled="true">
      <span class="card__icon">${icon(tileIcon(product), 22)}</span>
      <span class="card__body">
        <span class="card__title">${esc(t(product.title, lang))}</span>
        <span class="card__meta"><span class="badge">${esc(UI[lang].comingSoonBadge)}</span></span>
      </span>
    </div>`;
  }

  let badge = '';
  if (product.status === 'coming-soon') {
    badge = `<span class="badge">${esc(UI[lang].comingSoonBadge)}</span>`;
  } else if (product.purchaseMode === 'request-only') {
    badge = `<span class="badge">${esc(UI[lang].onRequestBadge)}</span>`;
  } else if (!purchasable) {
    badge = `<span class="badge">${esc(UI[lang].priceToComeBadge)}</span>`;
  } else if (range?.anyPlaceholder) {
    // A guest must never be shown a figure that nobody has signed off as if it
    // were final. The badge is the honest version of "we are still deciding".
    badge = `<span class="badge badge--warn">${esc(UI[lang].provisionalPrice)}</span>`;
  }

  return `<button class="card" type="button" data-product="${esc(product.id)}">
    <span class="card__icon">${icon(tileIcon(product), 22)}</span>
    <span class="card__body">
      <span class="card__title">${esc(t(product.title, lang))}</span>
      <span class="card__summary">${esc(t(product.summary, lang))}</span>
      <span class="card__meta">
        ${range && purchasable ? `<span class="price">${esc(fromLabel(range, lang))}</span>` : ''}
        ${badge}
      </span>
    </span>
    <span class="card__chevron">${icon('chevron', 16)}</span>
  </button>`;
}

export { tileIcon, fromLabel, noticeLabel };
