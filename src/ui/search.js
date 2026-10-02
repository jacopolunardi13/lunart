/**
 * Full-screen search.
 *
 * It calls the same retrieval engine the Concierge uses, so a word that finds an
 * answer in the chat finds the same card here.
 */

import { esc, trapFocus, lockScroll } from './dom.js';
import { icon } from './icons.js';
import { UI } from '../i18n.js';
import { entryCard } from './components.js';
import { search } from '../concierge/engine.js';
import { entries, getEntry } from '../../data/index.js';

let panel = null;
let releaseFocus = null;

export function openSearch({ lang, phase, onEntry }) {
  panel = document.createElement('div');
  panel.className = 'search-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', UI[lang].searchTitle);
  panel.innerHTML = `
    <div class="search-panel__head">
      <button class="icon-button" type="button" data-close
        aria-label="${esc(UI[lang].close)}">${icon('close', 20)}</button>
      <label class="visually-hidden" for="search-input">${esc(UI[lang].searchTitle)}</label>
      <input id="search-input" type="search" placeholder="${esc(UI[lang].search)}"
        enterkeyhint="search" autocomplete="off">
    </div>
    <div class="search-panel__results" id="search-results" aria-live="polite"></div>`;

  document.body.append(panel);
  lockScroll(true);

  const input = panel.querySelector('#search-input');
  const results = panel.querySelector('#search-results');

  const draw = () => {
    const query = input.value.trim();
    if (query.length < 2) {
      results.innerHTML = `<div class="cards">${entries.slice(0, 8).map((e) => entryCard(e, lang)).join('')}</div>`;
      return;
    }
    const ids = search(query, entries, { phase, lang }).slice(0, 12);
    results.innerHTML = ids.length
      ? `<div class="cards">${ids.map(getEntry).filter(Boolean).map((e) => entryCard(e, lang)).join('')}</div>`
      : `<p class="search-panel__empty">${esc(UI[lang].noResults)}</p>`;
  };

  input.addEventListener('input', draw);
  panel.querySelector('[data-close]').addEventListener('click', closeSearch);
  panel.addEventListener('click', (event) => {
    const card = event.target.closest('[data-entry]');
    if (!card) return;
    closeSearch();
    onEntry(card.dataset.entry);
  });
  panel.addEventListener('submit', (event) => event.preventDefault());

  draw();
  releaseFocus = trapFocus(panel, { onEscape: closeSearch });
  input.focus();
}

export function closeSearch() {
  if (!panel) return;
  panel.remove();
  panel = null;
  lockScroll(false);
  releaseFocus?.();
  releaseFocus = null;
}

export const isSearchOpen = () => Boolean(panel);
