/**
 * Offline support, as an enhancement and nothing more.
 *
 * A guest looking up the Wi-Fi password in a stairwell with no signal should still
 * get it. Nothing about the guide depends on this file: if registration fails, or
 * the browser has no service workers, every page still loads from the network.
 *
 * ── Why the strategy is split three ways ──────────────────────────────────────
 *
 * This file used to serve everything that was not the API from the cache first,
 * on the reasoning that the files only change when the guide is republished. That
 * reasoning has a hole in it, and a guest fell through it: the guide *was*
 * republished, and a phone that had visited before kept running the old one.
 * Nothing was broken — the cache was simply answering, and the network was never
 * asked.
 *
 * The hole is that `src/main.js` and `assets/css/app.css` are not
 * content-addressed. Their names never change, so a cached copy and a deployed
 * copy are indistinguishable by URL, and cache-first means the deployed one is
 * never seen. A build step with hashed filenames would fix it; this project
 * deliberately has no build step, so the service worker carries the distinction
 * instead.
 *
 *   /api/            never cached, at all. Prices and availability are live or
 *                    they are nothing.
 *   documents, JS,   network first. These are the guide itself, and a guest must
 *   CSS, manifest    never be stuck on an old one. The cache answers only when
 *                    the network does not — which is exactly the offline case
 *                    this file exists for.
 *   images, fonts    cache first. A photograph at `…-700.webp` is the same
 *                    photograph forever, and a font changes about never. These
 *                    are the bytes worth keeping and worth serving instantly.
 *
 * The network-first fetch has a short deadline, so a phone on hotel Wi-Fi that is
 * technically connected and practically not still gets the cached guide rather
 * than a spinner.
 *
 * Bump CACHE when the strategy changes; old caches are cleared on activate, which
 * is what retires a browser already holding the stale one.
 */

const CACHE = 'lunart-guide-v3';

/** How long a mutable asset may wait for the network before the cache answers. */
const NETWORK_DEADLINE_MS = 3500;

/** The shell, plus the one photograph that is above the fold. */
const PRECACHE = [
  './',
  'index.html',
  'assets/css/app.css',
  'assets/css/fonts.css',
  'assets/fonts/dm-sans.woff2',
  'assets/fonts/cormorant-garamond.woff2',
  'src/main.js',
  'assets/img/views/arno-ponte-vecchio-700.webp',
  'manifest.webmanifest',
];

/**
 * Is this one of the files that changes when LunArt deploys?
 *
 * By destination where the browser says so, by extension where it does not — a
 * module imported by another module arrives with destination "script", a plain
 * `fetch()` for the same file does not, and both have to be treated the same.
 */
function isMutableAsset(request, url) {
  if (['script', 'style', 'worker', 'manifest'].includes(request.destination)) return true;
  return /\.(js|mjs|css|webmanifest|json)$/i.test(url.pathname);
}

/** And is this one of the files that does not? */
function isImmutableAsset(request, url) {
  if (['image', 'font'].includes(request.destination)) return true;
  return /\.(webp|jpe?g|png|gif|svg|ico|woff2?|ttf|otf)$/i.test(url.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // One bad URL must not fail the whole install, so each is added on its own.
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;  // fonts and maps stay on the network

  /**
   * The API is never cached. Not cache-first, not at all.
   *
   * Prices, what is available, what a slot costs, what an order has come to. A
   * cached copy of any of those is a figure the guest is shown as current when it
   * is not, and the whole point of recalculating every price on the server is
   * that the browser is not the one who decides.
   */
  if (url.pathname.startsWith('/api/')) return;

  // The guide itself, and everything it is made of: always the deployed one.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, { fallback: 'index.html' }));
    return;
  }
  if (isMutableAsset(request, url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Photographs and fonts: the same bytes forever, so answer instantly.
  if (isImmutableAsset(request, url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Anything unclassified is treated as though it could change, which is the
  // safe way round: a stale guide is worse than a slow one.
  event.respondWith(networkFirst(request));
});

/**
 * The network, with the cache as a safety net rather than as an answer.
 *
 * A fresh response replaces what is stored, so the cache is always the last thing
 * that actually worked. The deadline matters as much as the order: a request that
 * hangs is the same to a guest as one that fails, and worse to look at.
 */
function networkFirst(request, { fallback = null } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const answer = (response) => { if (!settled) { settled = true; resolve(response); } };

    const fromCache = () => caches.match(request)
      .then((hit) => hit ?? (fallback ? caches.match(fallback) : undefined));

    const timer = setTimeout(() => {
      fromCache().then((hit) => { if (hit) answer(hit); });
    }, NETWORK_DEADLINE_MS);

    fetch(request)
      .then((response) => {
        clearTimeout(timer);
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        answer(response);
      })
      .catch(() => {
        clearTimeout(timer);
        fromCache().then((hit) => answer(hit ?? Response.error()));
      });
  });
}

/** The cache, with the network filling it the first time. */
function cacheFirst(request) {
  return caches.match(request).then((hit) => hit ?? fetch(request).then((response) => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
    }
    return response;
  }));
}
