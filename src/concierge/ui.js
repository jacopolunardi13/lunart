/**
 * The Concierge, on screen.
 *
 * Answers are composed from knowledge-layer entries, never written here, so the
 * chat and the guide cannot say different things. When the engine declines, the
 * panel says so plainly and offers a person — which is the behaviour we want far
 * more than a confident wrong answer.
 */

import { esc, t, paragraphs, trapFocus, lockScroll } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { UI } from '../i18n.js';
import { facts, actions } from '../ui/components.js';
import { ask } from './engine.js';
import { INTENTS } from './intents.js';
import { getEntry, contacts } from '../../data/index.js';

let panel = null;
let log = null;
let input = null;
let chips = null;
let releaseFocus = null;
let memory = null;
let context = { lang: 'it', phase: 'staying', onEntry: null };

const intentTitle = (intentId, lang) => {
  const intent = INTENTS.find((i) => i.id === intentId);
  const entry = intent && getEntry(intent.entry);
  return entry ? t(entry.title, lang) : intentId;
};

function guestBubble(text) {
  return `<div class="bubble bubble--guest">${esc(text)}</div>`;
}

function answerBubble(entry, lang) {
  return `<div class="bubble bubble--concierge">
    <p class="bubble__title">${esc(t(entry.title, lang))}</p>
    <p>${esc(t(entry.summary, lang))}</p>
    ${entry.detail ? `<div class="prose" style="margin-top:8px">${paragraphs(t(entry.detail, lang))}</div>` : ''}
    ${facts(entry.facts, lang)}
    ${actions(entry.actions, lang)}
  </div>`;
}

function plainBubble(html) {
  return `<div class="bubble bubble--concierge">${html}</div>`;
}

function say(html) {
  log.insertAdjacentHTML('beforeend', html);
  log.scrollTop = log.scrollHeight;
}

/** Suggestion chips below the log, replaced on every turn. */
function offer(intentIds, lang) {
  chips.innerHTML = intentIds
    .map((id) => `<button class="chip" type="button" data-intent="${esc(id)}">${esc(intentTitle(id, lang))}</button>`)
    .join('');
  // Chips change the height of the log, so settle the scroll after they land.
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
}

function handoff(lang) {
  const primary = contacts.find((c) => c.primary) ?? contacts[0];
  return `<p>${esc(UI[lang].conciergeUnknown)}</p>
    <div class="actions">
      <a class="action action--primary" href="https://wa.me/${primary.phone.replace(/\D/g, '')}"
        target="_blank" rel="noopener">${icon('chat', 16)}${esc(primary.name)}</a>
    </div>`;
}

function respond(query) {
  const { lang, phase } = context;
  const result = ask(query, { phase, memory });

  if (result.kind === 'answer') {
    const entry = getEntry(result.entryId);
    memory = { intentId: result.intentId };
    say(answerBubble(entry, lang));
    offer(result.alternatives.map((a) => a.intentId).slice(0, 3), lang);
    return;
  }

  if (result.kind === 'choice') {
    memory = null;
    const options = result.options
      .map((o) => `<button class="chip" type="button" data-intent="${esc(o.intentId)}">${esc(intentTitle(o.intentId, lang))}</button>`)
      .join('');
    say(plainBubble(`<p>${esc(UI[lang].conciergeChoice)}</p>
      <div class="actions" style="margin-top:10px">${options}</div>`));
    chips.innerHTML = '';
    return;
  }

  memory = null;
  say(plainBubble(handoff(lang)));
  offer(result.suggestions, lang);
}

/** Answer as though the guest had asked for this intent directly. */
function answerIntent(intentId) {
  const intent = INTENTS.find((i) => i.id === intentId);
  if (!intent) return;
  const entry = getEntry(intent.entryByPhase?.[context.phase] ?? intent.entry);
  if (!entry) return;
  memory = { intentId };
  say(guestBubble(t(entry.title, context.lang)));
  say(answerBubble(entry, context.lang));
  offer([], context.lang);
}

function build() {
  panel = document.createElement('div');
  panel.className = 'concierge';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'concierge-title');
  panel.hidden = true;
  document.body.append(panel);
}

function render() {
  const { lang } = context;
  panel.innerHTML = `
    <div class="concierge__head">
      <div>
        <p class="concierge__title serif" id="concierge-title">${esc(UI[lang].concierge)}</p>
        <p class="concierge__sub">${esc(UI[lang].conciergeSub)}</p>
      </div>
      <button class="icon-button" type="button" data-close
        aria-label="${esc(UI[lang].close)}">${icon('close', 20)}</button>
    </div>
    <div class="concierge__log" id="concierge-log" role="log" aria-live="polite" aria-atomic="false"></div>
    <div class="chips" id="concierge-chips"></div>
    <form class="composer" autocomplete="off">
      <label class="visually-hidden" for="concierge-input">${esc(UI[lang].concierge)}</label>
      <input id="concierge-input" type="text" placeholder="${esc(UI[lang].conciergePlaceholder)}"
        enterkeyhint="send">
      <button type="submit" aria-label="${esc(UI[lang].send)}">${icon('send', 18)}</button>
    </form>`;

  log = panel.querySelector('#concierge-log');
  chips = panel.querySelector('#concierge-chips');
  input = panel.querySelector('#concierge-input');

  panel.querySelector('[data-close]').addEventListener('click', close);
  panel.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    say(guestBubble(query));
    input.value = '';
    respond(query);
  });

  panel.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-intent]');
    if (chip) { answerIntent(chip.dataset.intent); return; }
    const link = event.target.closest('[data-entry]');
    if (link) { context.onEntry?.(link.dataset.entry); }
  });
}

export function openConcierge({ lang, phase, onEntry }) {
  context = { lang, phase, onEntry };
  if (!panel) build();
  render();

  say(plainBubble(`<p>${esc(UI[lang].conciergeOpening)}</p>`));
  offer((ask('', { phase }).suggestions ?? []).slice(0, 4), lang);

  panel.hidden = false;
  requestAnimationFrame(() => { panel.dataset.open = 'true'; });
  if (window.matchMedia('(max-width: 899px)').matches) lockScroll(true);
  releaseFocus = trapFocus(panel, { onEscape: close });
  input.focus();
}

export function close() {
  if (!panel || panel.hidden) return;
  delete panel.dataset.open;
  const finish = () => { panel.hidden = true; panel.innerHTML = ''; };
  panel.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 400);
  if (window.matchMedia('(max-width: 899px)').matches) lockScroll(false);
  releaseFocus?.();
  releaseFocus = null;
  memory = null;
}

export const isOpen = () => Boolean(panel && !panel.hidden);
