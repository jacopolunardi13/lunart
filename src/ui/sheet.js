/**
 * The detail sheet.
 *
 * Progressive disclosure, one level deep: a card shows the answer, the sheet shows
 * the rest of it. Deliberately a real dialog — labelled, focus-trapped, dismissed
 * by Escape, by the scrim and by the back button, with focus returned to whatever
 * opened it.
 */

import { esc, t, paragraphs, trapFocus, lockScroll } from './dom.js';
import { icon } from './icons.js';
import { UI } from '../i18n.js';
import { facts, actions, placeRow } from './components.js';
import { getEntry, getPlace } from '../../data/index.js';

let root = null;
let scrim = null;
let releaseFocus = null;
let currentId = null;

function ensureElements(onClose) {
  if (root) return;

  scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.hidden = true;
  scrim.addEventListener('click', onClose);

  root = document.createElement('div');
  root.className = 'sheet';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'sheet-title');
  root.hidden = true;

  document.body.append(scrim, root);
}

function body(entry, lang) {
  const places = (entry.places ?? []).map(getPlace).filter(Boolean);
  return `
    <p class="sheet__lead">${esc(t(entry.summary, lang))}</p>
    ${entry.detail ? `<div class="prose">${paragraphs(t(entry.detail, lang))}</div>` : ''}
    ${facts(entry.facts, lang)}
    ${places.length ? `<ul style="margin-top:14px">${places.map((p) => placeRow(p, lang)).join('')}</ul>` : ''}
    ${actions(entry.actions, lang)}
  `;
}

/** Open the sheet on one entry. Returns false if the id is unknown. */
export function openSheet(entryId, lang, { onClose } = {}) {
  const entry = getEntry(entryId);
  if (!entry) return false;

  ensureElements(() => closeSheet(onClose));
  currentId = entryId;

  root.innerHTML = `
    <div class="sheet__grip" aria-hidden="true"></div>
    <div class="sheet__head">
      <h2 class="sheet__title" id="sheet-title">${esc(t(entry.title, lang))}</h2>
      <button class="icon-button" type="button" data-close
        aria-label="${esc(UI[lang].close)}">${icon('close', 20)}</button>
    </div>
    <div class="sheet__body">${body(entry, lang)}</div>`;

  root.hidden = false;
  scrim.hidden = false;
  // Let the browser paint the start state before transitioning to the end state.
  requestAnimationFrame(() => {
    root.dataset.open = 'true';
    scrim.dataset.open = 'true';
  });

  lockScroll(true);
  root.querySelector('[data-close]')?.addEventListener('click', () => closeSheet(onClose));
  releaseFocus = trapFocus(root, { onEscape: () => closeSheet(onClose) });
  root.querySelector('[data-close]')?.focus();
  return true;
}

export function closeSheet(onClose) {
  if (!root || root.hidden) return;

  delete root.dataset.open;
  delete scrim.dataset.open;
  currentId = null;

  const finish = () => {
    root.hidden = true;
    scrim.hidden = true;
    root.innerHTML = '';
  };
  // Match the CSS transition, but never leave the sheet stuck if it never fires.
  root.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 400);

  lockScroll(false);
  releaseFocus?.();
  releaseFocus = null;
  onClose?.();
}

export const openEntryId = () => currentId;
