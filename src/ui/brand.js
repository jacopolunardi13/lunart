/**
 * The LunArt mark in the header.
 *
 * LunArt's identity is typographic — the wordmark set in Cormorant, black on warm
 * white — so the text in `index.html` is a real rendering of it rather than a
 * placeholder, and it stays until there is a file that does the job better.
 *
 * When that file arrives it goes in at `assets/img/brand/lunart-wordmark.svg` and
 * this swaps it in. See the README in that folder for what the file has to be.
 *
 * ── Why it is loaded this way ─────────────────────────────────────────────────
 *
 * Not an `<img>` in the markup with an `onerror`: that puts a broken image in the
 * header of every guest's first paint until the handler runs, and this server
 * answers `200 text/html` for any unknown path, so "missing" does not even look
 * like a 404 — it looks like a page arriving where an image was expected.
 *
 * So the image is loaded off-document first and only put in the header once it has
 * actually decoded. A file that is absent, or that is secretly an HTML page, never
 * reaches the DOM and the text is simply left alone. Nothing waits on it: the
 * header is already correct before this runs, and only improves if it succeeds.
 */

export const BRAND_WORDMARK = 'assets/img/brand/lunart-wordmark.svg';

/**
 * Swap the typographic wordmark for the artwork, if the artwork is there.
 *
 * Returns whether it happened, which is what the tests assert on. Safe to call
 * when the element is absent — the Staff app and the partner pages share this
 * module's folder but not its header.
 */
export function loadBrandMark(
  { element = document.getElementById('header-mark'), src = BRAND_WORDMARK } = {},
) {
  if (!element) return Promise.resolve(false);

  return new Promise((resolve) => {
    const probe = new Image();
    probe.addEventListener('load', () => {
      // A decoded image of no size is a file that technically loaded and shows
      // nothing — worse than the text, so it is refused like a missing one.
      if (!probe.naturalWidth) { resolve(false); return; }

      const mark = document.createElement('img');
      mark.className = 'header__logo';
      mark.src = src;
      mark.alt = 'LunArt';
      mark.decoding = 'async';
      element.replaceChildren(mark);
      element.dataset.logo = 'true';
      resolve(true);
    });
    probe.addEventListener('error', () => resolve(false));
    probe.src = src;
  });
}
