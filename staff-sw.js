/**
 * The Staff app's service worker.
 *
 * Two jobs, and neither of them is caching API responses. A stale order queue is
 * worse than no order queue: a member of staff acting on a cached list confirms
 * something twice or misses something new. So everything under `/api/` goes to the
 * network, always, and only the shell is cached — enough that the app opens on a
 * bad hotel connection and says it cannot reach the server, rather than showing
 * nothing at all.
 *
 * The other job is notifications: showing one, and taking the tap back into the app.
 */

const CACHE = 'lunart-staff-v1';
const SHELL = [
  '/staff',
  '/assets/css/staff.css',
  '/assets/css/fonts.css',
  '/src/staff/app.js',
  '/assets/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;
  // Never serve operational data from a cache.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached ?? caches.match('/staff'))),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch { payload = { title: 'LunArt Staff', body: event.data?.text() ?? '' }; }

  event.waitUntil(self.registration.showNotification(payload.title ?? 'LunArt Staff', {
    body: payload.body ?? '',
    tag: payload.tag ?? 'lunart',
    renotify: true,
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    data: { url: payload.url ?? '/staff' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? '/staff';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const open = clients.find((client) => client.url.includes('/staff'));
    if (open) return open.focus();
    return self.clients.openWindow(target);
  }));
});
