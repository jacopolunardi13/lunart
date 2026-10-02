/** Small helpers shared by every view. */

/** Escape text that will be interpolated into HTML. Used for anything a guest typed. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Pick the active language out of a {it, en} object, or pass a plain string through. */
export function t(value, lang) {
  if (value == null) return '';
  return typeof value === 'string' ? value : (value[lang] ?? value.it ?? '');
}

/** Turn "\n\n"-separated copy into paragraphs. */
export function paragraphs(text) {
  return String(text)
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Replace an element's content and return it, so callers can chain. */
export function fill(element, html) {
  element.innerHTML = html;
  return element;
}

/**
 * Keep Tab inside a container while it is open, and restore focus when it closes.
 * Returns the teardown function.
 */
export function trapFocus(container, { onEscape } = {}) {
  const previous = document.activeElement;
  const selector = 'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])';

  function onKeydown(event) {
    if (event.key === 'Escape') { onEscape?.(); return; }
    if (event.key !== 'Tab') return;

    const focusable = [...container.querySelectorAll(selector)].filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  container.addEventListener('keydown', onKeydown);
  return () => {
    container.removeEventListener('keydown', onKeydown);
    if (previous instanceof HTMLElement) previous.focus();
  };
}

/** Lock body scroll while an overlay is open, without losing the scroll position. */
let lockCount = 0;
let savedScroll = 0;
export function lockScroll(locked) {
  if (locked) {
    if (lockCount === 0) {
      savedScroll = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${savedScroll}px`;
      document.body.style.width = '100%';
    }
    lockCount++;
  } else {
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, savedScroll);
    }
  }
}
