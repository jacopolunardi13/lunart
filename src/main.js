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
import { openSearch, closeSearch, isSearchOpen } from './ui/search.js';
import * as concierge from './concierge/ui.js';
import { PHASES, getEntry } from '../data/index.js';

const PHASE_KEY = 'lunart.phase';
const VIEWS = { guide: guideView, florence: florenceView, help: helpView };
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
  if (head in VIEWS) return { view: head, entry: null };
  return { view: 'guide', entry: null };
}

function go(view) {
  if (!(view in VIEWS)) return;
  location.hash = `#/${view}`;
}

function openEntry(entryId) {
  if (!getEntry(entryId)) return;
  location.hash = `#/e/${encodeURIComponent(entryId)}`;
}

function onRoute() {
  const route = parseHash();

  if (route.view !== state.view) {
    state.view = route.view;
    render();
  }

  if (route.entry) {
    const opened = openSheet(route.entry, state.lang, {
      onClose: () => { if (parseHash().entry) history.back(); },
    });
    if (!opened) go(state.view);
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
  const conciergeLabel = $('[data-tab-label-concierge]');
  if (conciergeLabel) conciergeLabel.textContent = UI[state.lang].concierge;
  $('#skip-link').textContent = UI[state.lang].skip;
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

    const copyButton = event.target.closest('[data-copy]');
    if (copyButton) {
      try {
        await navigator.clipboard.writeText(copyButton.dataset.copy);
        copyButton.dataset.copied = 'true';
        copyButton.querySelector('span').textContent = UI[state.lang].copied;
        setTimeout(() => {
          delete copyButton.dataset.copied;
          const span = copyButton.querySelector('span');
          if (span) span.textContent = UI[state.lang].copy;
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

function start() {
  buildChrome();
  state.view = parseHash().view;
  render();
  onRoute();
}

if (document.readyState === 'loading') {
  addEventListener('DOMContentLoaded', start);
} else {
  start();
}
