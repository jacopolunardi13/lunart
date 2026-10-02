/**
 * Offline support, as an enhancement and nothing more.
 *
 * A guest looking up the Wi-Fi password in a stairwell with no signal should still
 * get it. Nothing about the guide depends on this file: if registration fails, or
 * the browser has no service workers, every page still loads from the network.
 *
 * Bump CACHE when the shell changes; old caches are cleared on activate.
 */

const CACHE = 'lunart-guide-v2.0.0';

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

  // Documents: network first, so a republished guide is picked up straight away,
  // with the cache as the fallback when there is no signal.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit ?? caches.match('index.html'))),
    );
    return;
  }

  // Everything else is content-addressed enough to serve from cache first.
  event.respondWith(
    caches.match(request).then((hit) => hit ?? fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
