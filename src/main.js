/**
 * LunArt — Guest Guide.
 *
 * Holds the small amount of state the app has (language, guest phase, current
 * view), draws a view when it changes, and routes taps. Everything it draws comes
 * from `data/`; everything it answers comes from the same place.
 */

import { $, esc, fill } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { UI, initialLang, saveLang } from './i18n.js';
import { hydrateSliders } from './ui/components.js';
import { guideView, florenceView, helpView, reviewView } from './ui/views.js';
import { openSheet, closeSheet } from './ui/sheet.js';
import { loadCatalogue, catalogueAvailable } from './commerce/api.js';
import { shopView } from './commerce/ui/shop.js';
import { openProductSheet } from './commerce/ui/product-sheet.js';
import { openCartSheet } from './commerce/ui/cart-sheet.js';
import { openOrderSheet, purchasesBlock } from './commerce/ui/orders.js';
import { openCardSheet, cardBlock } from './commerce/ui/card-sheet.js';
import * as cart from './commerce/cart.js';
import { openSearch, closeSearch, isSearchOpen } from './ui/search.js';
import * as concierge from './concierge/ui.js';
import { PHASES, getEntry } from '../data/index.js';

const PHASE_KEY = 'lunart.phase';
const VIEWS = { guide: guideView, florence: florenceView, help: helpView, shop: shopView };
const reviewMode = new URLSearchParams(location.search).get('review') === '1';

const state = {
  lang: initialLang(),
  phase: readPhase(),
  view: 'guide',
};

function readPhase() {
  try {
    const saved = localStorage.getItem(PHASE_KEY);
    if (PHASES.some((p) => p.id === saved)) return saved;
  } catch { /* private browsing */ }
  return 'before';
}

function savePhase(phase) {
  try { localStorage.setItem(PHASE_KEY, phase); } catch { /* nothing to do */ }
}

/* --- Routing --------------------------------------------------------------- */
/** `#/guide` · `#/florence` · `#/help` · `#/e/<entryId>` — entries are linkable. */
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [head, tail] = raw.split('/');
  if (head === 'e' && tail) return { view: state.view, entry: decodeURIComponent(tail) };
  if (head === 'product' && tail) return { view: state.view, product: decodeURIComponent(tail) };
  if (head === 'order' && tail) return { view: state.view, order: decodeURIComponent(tail) };
  if (head === 'card' && tail) return { view: state.view, card: decodeURIComponent(tail) };
  if (head === 'cart') return { view: state.view, cart: true };
  if (head in VIEWS) return { view: head, entry: null };
  return { view: 'guide', entry: null };
}

function go(view) {
  if (!(view in VIEWS)) return;
  location.hash = `#/${view}`;
}

/**
 * True when this session is what put an entry in the URL. A guest who arrived on a
 * deep link has nothing to go back to, so closing the sheet must not walk them off
 * the site; it rewrites the hash in place instead.
 */
let pushedEntry = false;

function openEntry(entryId) {
  if (!getEntry(entryId)) return;
  pushedEntry = true;
  location.hash = `#/e/${encodeURIComponent(entryId)}`;
}

const openProduct = (productId) => { pushedEntry = true; location.hash = `#/product/${encodeURIComponent(productId)}`; };
const openCart    = () => { pushedEntry = true; location.hash = '#/cart'; };
const openOrder   = (token) => { pushedEntry = true; location.hash = `#/order/${encodeURIComponent(token)}`; };
const openCard    = (token) => { pushedEntry = true; location.hash = `#/card/${encodeURIComponent(token)}`; };

/** Any sheet closing comes back here, so the URL and the screen stay in step. */
function dismissSheet() {
  const route = parseHash();
  if (!route.entry && !route.product && !route.order && !route.card && !route.cart) return;
  if (pushedEntry) {
    pushedEntry = false;
    history.back();
  } else {
    history.replaceState(null, '', `#/${state.view}`);
  }
}

function onRoute() {
  const route = parseHash();

  if (route.view !== state.view) {
    state.view = route.view;
    render();
  }

  if (route.entry) {
    if (!openSheet(route.entry, state.lang, { onClose: dismissSheet })) go(state.view);
  } else if (route.product) {
    const opened = openProductSheet(route.product, {
      lang: state.lang,
      onAdded: () => { updateCartBadge(); openCart(); },
    });
    if (!opened) go(state.view);
  } else if (route.cart) {
    openCartSheet({ lang: state.lang, onShop: () => go('shop') });
  } else if (route.order) {
    openOrderSheet(route.order, { lang: state.lang, onCard: openCard });
  } else if (route.card) {
    openCardSheet(route.card, { lang: state.lang });
  } else {
    closeSheet();
  }
}

/* --- Rendering ------------------------------------------------------------- */
function render() {
  const main = $('#main');
  fill(main, VIEWS[state.view](state.lang, state.phase) + (reviewMode ? reviewView(state.lang) : ''));
  hydrateSliders(main);
  main.scrollTop = 0;

  document.documentElement.lang = state.lang;
  $('#lang-toggle').textContent = state.lang === 'it' ? 'EN' : 'IT';
  $('#lang-toggle').setAttribute('aria-label',
    state.lang === 'it' ? 'Switch to English' : 'Passa all’italiano');

  for (const tab of document.querySelectorAll('[data-view]')) {
    const active = tab.dataset.view === state.view;
    tab.setAttribute('aria-current', active ? 'page' : 'false');
    tab.querySelector('[data-tab-label]').textContent = UI[state.lang][tab.dataset.view];
  }
  updateCartBadge();
  fillGuestBlocks();

  const conciergeLabel = $('[data-tab-label-concierge]');
  if (conciergeLabel) conciergeLabel.textContent = UI[state.lang].concierge;
  $('#skip-link').textContent = UI[state.lang].skip;
}

function updateCartBadge() {
  const button = $('#cart-button');
  if (!button) return;
  const total = cart.count();
  button.hidden = total === 0 && !catalogueAvailable();
  const badge = button.querySelector('.cart-button__count');
  badge.textContent = total > 0 ? String(total) : '';
  badge.hidden = total === 0;
  button.setAttribute('aria-label', `${UI[state.lang].cart}${total > 0 ? ` (${total})` : ''}`);
}

/**
 * The card and the purchases a guest already holds. Fetched after the first paint
 * so the guide never waits on the API to draw, and simply absent when there is
 * nothing — or when there is no server behind this copy of the guide.
 */
async function fillGuestBlocks() {
  const slot = $('[data-guest-blocks]');
  if (!slot || !catalogueAvailable()) return;
  const [cards, purchases] = await Promise.all([cardBlock(state.lang), purchasesBlock(state.lang)]);
  if (!document.body.contains(slot)) return;
  slot.innerHTML = cards + purchases;
}

function buildChrome() {
  $('#lang-toggle').addEventListener('click', () => {
    state.lang = state.lang === 'it' ? 'en' : 'it';
    saveLang(state.lang);
    render();
  });

  $('#tabbar').innerHTML = ['guide', 'florence', 'help']
    .map((view) => `<button class="tab" type="button" data-view="${view}">
        ${icon({ guide: 'compass', florence: 'museum', help: 'lifebuoy' }[view], 21)}
        <span data-tab-label></span>
      </button>`)
    .concat(`<button class="tab" type="button" id="open-concierge">
        ${icon('chat', 21)}<span data-tab-label-concierge></span>
      </button>`)
    .join('');

  $('#tabbar').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-view]');
    if (tab) go(tab.dataset.view);
  });

  $('#open-concierge').addEventListener('click', () => {
    concierge.openConcierge({ lang: state.lang, phase: state.phase, onEntry: openEntry });
  });

  // One delegated listener for the whole document rather than inline onclick
  // attributes, which is what the previous page used.
  document.addEventListener('click', async (event) => {
    const entryTrigger = event.target.closest('[data-entry]');
    if (entryTrigger && !entryTrigger.closest('.concierge, .search-panel')) {
      event.preventDefault();
      openEntry(entryTrigger.dataset.entry);
      return;
    }

    const phaseChip = event.target.closest('[data-phase]');
    if (phaseChip) {
      state.phase = phaseChip.dataset.phase;
      savePhase(state.phase);
      render();
      return;
    }

    if (event.target.closest('[data-open-search]')) {
      openSearch({ lang: state.lang, phase: state.phase, onEntry: openEntry });
      return;
    }

    const productTrigger = event.target.closest('[data-product]');
    if (productTrigger) { event.preventDefault(); openProduct(productTrigger.dataset.product); return; }

    const orderTrigger = event.target.closest('[data-order]');
    if (orderTrigger) { event.preventDefault(); openOrder(orderTrigger.dataset.order); return; }

    const cardTrigger = event.target.closest('[data-card]');
    if (cardTrigger) { event.preventDefault(); openCard(cardTrigger.dataset.card); return; }

    if (event.target.closest('[data-shop]')) { go('shop'); return; }
    if (event.target.closest('#cart-button')) { openCart(); return; }

    const copyButton = event.target.closest('[data-copy]');
    if (copyButton) {
      try {
        await navigator.clipboard.writeText(copyButton.dataset.copy);
        const label = copyButton.querySelector('[data-copy-label]');
        const mark = copyButton.querySelector('[data-copy-icon]');
        copyButton.dataset.copied = 'true';
        if (label) label.textContent = UI[state.lang].copied;
        if (mark) mark.innerHTML = icon('check', 14);
        setTimeout(() => {
          delete copyButton.dataset.copied;
          if (label) label.textContent = UI[state.lang].copy;
          if (mark) mark.innerHTML = icon('copy', 14);
        }, 1600);
      } catch { /* clipboard blocked: the value is on screen anyway */ }
    }
  });

  const header = $('#header');
  addEventListener('scroll', () => {
    header.dataset.scrolled = String(window.scrollY > 4);
  }, { passive: true });

  addEventListener('hashchange', onRoute);
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isSearchOpen()) closeSearch();
  });
}

async function start() {
  buildChrome();
  cart.onCartChange(updateCartBadge);

  // Drawn first, then enriched. The guide is useful without the commerce API, so
  // it must never wait on it — a guest looking for the Wi-Fi password should not
  // pay for a shop they did not open.
  state.view = parseHash().view;
  render();
  onRoute();

  await loadCatalogue();
  render();
  onRoute();
}

if (document.readyState === 'loading') {
  addEventListener('DOMContentLoaded', start);
} else {
  start();
}
