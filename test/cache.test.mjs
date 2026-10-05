/**
 * The service worker, run for real.
 *
 * This file exists because of a bug a guest found: the guide was redeployed and a
 * phone that had visited before kept running the old one. Nothing had crashed —
 * `sw.js` was serving `src/main.js` from the cache and never asking the network,
 * and because the filename has no content hash in it the stale copy and the new one
 * are indistinguishable by URL.
 *
 * So the strategy is not tested by reading the file. `sw.js` is evaluated in a
 * scope that provides the handful of globals a service worker gets — `self`,
 * `caches`, `fetch`, `location` — and then driven with fetch events, which is the
 * only way to find out what it actually does with one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SW = new URL('../sw.js', import.meta.url);

/** A cache that behaves enough like the real one to answer the questions here. */
function fakeCaches() {
  const stores = new Map();
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      async put(request, response) { store.set(keyOf(request), response); },
      async add(url) { store.set(url, { body: `precached:${url}`, ok: true, type: 'basic' }); },
      async match(request) { return store.get(keyOf(request)); },
    };
  };
  return {
    stores,
    open,
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(request) {
      for (const store of stores.values()) {
        const hit = store.get(keyOf(request));
        if (hit) return hit;
      }
      return undefined;
    },
  };
}

const keyOf = (request) => (typeof request === 'string' ? request : request.url);

/**
 * Load `sw.js` into a scope of our own and hand back the levers.
 *
 * The listeners it registers are kept so a test can fire one; `fetches` records
 * every request that actually reached the network, which is the thing most of these
 * tests are really asserting about.
 */
async function loadWorker({ offline = false, slow = false } = {}) {
  const source = await readFile(SW, 'utf8');
  const listeners = new Map();
  const fetches = [];
  const caches = fakeCaches();

  const self = {
    addEventListener: (type, handler) => listeners.set(type, handler),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };

  const fetchImpl = (request) => {
    fetches.push(keyOf(request));
    if (offline) return Promise.reject(new Error('offline'));
    const response = { body: `network:${keyOf(request)}`, ok: true, type: 'basic', clone: () => ({ ...response }) };
    if (!slow) return Promise.resolve(response);
    // Technically connected, practically not: the hotel Wi-Fi case.
    return new Promise((resolve) => setTimeout(() => resolve(response), 60_000));
  };

  const scope = {
    self,
    caches,
    location: { origin: 'https://lunart.example' },
    fetch: fetchImpl,
    URL,
    Promise,
    setTimeout,
    clearTimeout,
    Response: { error: () => ({ body: 'error', ok: false, type: 'error' }) },
    console,
  };

  const run = new Function(...Object.keys(scope), `${source}\n;return { PRECACHE_LENGTH: PRECACHE.length, CACHE };`);
  const exported = run(...Object.values(scope));

  return { listeners, fetches, caches, exported, self };
}

/** Fire one fetch event and return what the worker answered, or `undefined`. */
async function request(worker, { url, mode = 'no-cors', destination = '', method = 'GET' } = {}) {
  let answer;
  const event = {
    request: { url, mode, destination, method },
    respondWith: (value) => { answer = value; },
  };
  worker.listeners.get('fetch')(event);
  return answer === undefined ? undefined : answer;
}

const URL_OF = {
  page: 'https://lunart.example/g/abc',
  script: 'https://lunart.example/src/main.js',
  style: 'https://lunart.example/assets/css/app.css',
  manifest: 'https://lunart.example/manifest.webmanifest',
  photo: 'https://lunart.example/assets/img/rooms/304-letto-700.webp',
  font: 'https://lunart.example/assets/fonts/dm-sans.woff2',
  api: 'https://lunart.example/api/catalog',
  unknown: 'https://lunart.example/something-new',
  offsite: 'https://fonts.example/x.woff2',
};

/* ── The API is never cached ─────────────────────────────────────────────── */

test('the API is not handled by the service worker at all', async () => {
  const worker = await loadWorker();
  const answer = await request(worker, { url: URL_OF.api, destination: 'empty' });
  assert.equal(answer, undefined, 'not cache-first, not network-first — not touched');
  assert.equal(await worker.caches.match(URL_OF.api), undefined, 'and nothing of it is stored');
});

test('a price the server recalculated is never answered from a cache', async () => {
  const worker = await loadWorker();
  // Plant a stale price, the way an earlier cache-first worker would have.
  const cache = await worker.caches.open('lunart-guide-v3');
  await cache.put(URL_OF.api, { body: 'network:stale-prices', ok: true, type: 'basic' });

  const answer = await request(worker, { url: URL_OF.api, destination: 'empty' });
  assert.equal(answer, undefined, 'the browser goes to the network itself; the worker declines');
  assert.equal(worker.fetches.length, 0, 'the worker did not even proxy it');
});

/* ── The bug: the guide itself must never be stale ───────────────────────── */

test('a redeployed script is served from the network, even with a copy in the cache', async () => {
  const worker = await loadWorker();
  const cache = await worker.caches.open('lunart-guide-v3');
  await cache.put(URL_OF.script, { body: 'network:OLD', ok: true, type: 'basic' });

  const answer = await request(worker, { url: URL_OF.script, destination: 'script' });
  assert.ok(worker.fetches.includes(URL_OF.script), 'the network was asked');
  assert.equal((await answer).body, `network:${URL_OF.script}`, 'and the deployed copy is what the guest gets');
});

test('the same holds for the stylesheet, the manifest and the page itself', async () => {
  for (const [name, destination, mode] of [
    ['style', 'style', 'no-cors'],
    ['manifest', 'manifest', 'no-cors'],
    ['page', 'document', 'navigate'],
  ]) {
    const worker = await loadWorker();
    const cache = await worker.caches.open('lunart-guide-v3');
    await cache.put(URL_OF[name], { body: 'network:OLD', ok: true, type: 'basic' });
    const answer = await request(worker, { url: URL_OF[name], destination, mode });
    assert.equal((await answer).body, `network:${URL_OF[name]}`, name);
  }
});

test('a module fetched without a destination is still treated as mutable', async () => {
  // A plain `fetch()` for a .js file arrives with destination "" — classifying by
  // destination alone would quietly make that one cache-first again.
  const worker = await loadWorker();
  const cache = await worker.caches.open('lunart-guide-v3');
  await cache.put(URL_OF.script, { body: 'network:OLD', ok: true, type: 'basic' });

  const answer = await request(worker, { url: URL_OF.script, destination: '' });
  assert.equal((await answer).body, `network:${URL_OF.script}`);
});

test('anything the worker does not recognise is treated as though it could change', async () => {
  const worker = await loadWorker();
  const cache = await worker.caches.open('lunart-guide-v3');
  await cache.put(URL_OF.unknown, { body: 'network:OLD', ok: true, type: 'basic' });

  const answer = await request(worker, { url: URL_OF.unknown, destination: 'empty' });
  assert.equal((await answer).body, `network:${URL_OF.unknown}`, 'a stale guide is worse than a slow one');
});

/* ── What is worth keeping ───────────────────────────────────────────────── */

test('a photograph already held is answered without touching the network', async () => {
  const worker = await loadWorker();
  const cache = await worker.caches.open('lunart-guide-v3');
  await cache.put(URL_OF.photo, { body: 'network:held', ok: true, type: 'basic' });

  const answer = await request(worker, { url: URL_OF.photo, destination: 'image' });
  assert.equal((await answer).body, 'network:held');
  assert.equal(worker.fetches.length, 0, 'the same photograph forever: no point asking');
});

test('a font is cached first too, and fetched the first time', async () => {
  const worker = await loadWorker();
  const answer = await request(worker, { url: URL_OF.font, destination: 'font' });
  assert.equal((await answer).body, `network:${URL_OF.font}`);
  assert.equal(worker.fetches.length, 1);
});

/* ── Offline, which is what the file is for ──────────────────────────────── */

test('offline, the cached guide still answers', async () => {
  const worker = await loadWorker({ offline: true });
  const cache = await worker.caches.open('lunart-guide-v3');
  await cache.put(URL_OF.script, { body: 'network:held', ok: true, type: 'basic' });

  const answer = await request(worker, { url: URL_OF.script, destination: 'script' });
  assert.equal((await answer).body, 'network:held');
});

test('offline, a personal link falls back to the guide page rather than to nothing', async () => {
  const worker = await loadWorker({ offline: true });
  const cache = await worker.caches.open('lunart-guide-v3');
  await cache.put('index.html', { body: 'network:the-guide', ok: true, type: 'basic' });

  const answer = await request(worker, { url: URL_OF.page, mode: 'navigate', destination: 'document' });
  assert.equal((await answer).body, 'network:the-guide', '/g/<token> is the same app as /');
});

test('a connection that hangs gives way to the cache rather than to a spinner', async () => {
  const worker = await loadWorker({ slow: true });
  const cache = await worker.caches.open('lunart-guide-v3');
  await cache.put(URL_OF.script, { body: 'network:held', ok: true, type: 'basic' });

  const answer = request(worker, { url: URL_OF.script, destination: 'script' });
  const resolved = await Promise.race([
    answer.then((p) => p).then((r) => r),
    new Promise((resolve) => setTimeout(() => resolve('still waiting'), 8000)),
  ]);
  assert.equal(resolved.body, 'network:held', 'the deadline let the cache answer');
});

/* ── Housekeeping ────────────────────────────────────────────────────────── */

test('activating clears every cache but the current one', async () => {
  const worker = await loadWorker();
  await worker.caches.open('lunart-guide-v2.1.0');
  await worker.caches.open('lunart-guide-v3');

  const waits = [];
  worker.listeners.get('activate')({ waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);

  assert.deepEqual(await worker.caches.keys(), ['lunart-guide-v3'],
    'a browser holding the old cache-first store is retired by this');
});

test('the cache name was bumped past the one that served stale scripts', async () => {
  const worker = await loadWorker();
  assert.equal(worker.exported.CACHE, 'lunart-guide-v3');
  assert.ok(worker.exported.PRECACHE_LENGTH > 0);
});

test('a request that is not a GET is left alone', async () => {
  const worker = await loadWorker();
  assert.equal(await request(worker, { url: URL_OF.script, method: 'POST', destination: 'script' }), undefined);
});

test('another origin is left on the network', async () => {
  const worker = await loadWorker();
  assert.equal(await request(worker, { url: URL_OF.offsite, destination: 'font' }), undefined);
});
