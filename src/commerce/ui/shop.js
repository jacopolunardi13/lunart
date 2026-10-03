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

/** The strip that lives inside the guide, before a guest ever opens the shop. */
export function shopTeaser(lang) {
  if (!catalogueAvailable()) return '';
  const featured = PRODUCTS.filter((p) => p.active && p.featured).slice(0, 4);
  if (featured.length === 0) return '';

  return `<section class="section" aria-labelledby="h-extras">
    <div class="section__head">
      <span style="color:var(--accent)">${icon('gift', 20)}</span>
      <h2 id="h-extras">${esc(UI[lang].extras)}</h2>
    </div>
    <p class="section__blurb">${esc(UI[lang].extrasBlurb)}</p>
    <div class="quick__grid">
      ${featured.map((product) => productTile(product, lang)).join('')}
    </div>
    <div class="actions" style="margin-top:12px">
      <button class="action" type="button" data-shop>${icon('chevron', 16)}${esc(UI[lang].seeAllExtras)}</button>
    </div>
  </section>`;
}

function productTile(product, lang) {
  const range = priceRange(product);
  return `<button class="quick__item" type="button" data-product="${esc(product.id)}">
    ${icon(tileIcon(product), 24)}
    <span class="quick__title">${esc(t(product.title, lang))}</span>
    ${range ? `<span class="price-tag">${esc(fromLabel(range, lang))}</span>` : ''}
  </button>`;
}

const tileIcon = (product) => ({
  'privilege-card': 'card', 'light-breakfast': 'tray', brunch: 'tray',
  'wine-in-room': 'wine', 'transfer-airport': 'car',
  'celebration-setup': 'glass', 'chianti-experience': 'hills',
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
