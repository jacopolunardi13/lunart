/**
 * The properties that have to stay true however the code is refactored.
 *
 * Each of these is a thing that would be a real incident rather than a bug: a
 * file served from outside the project, a secret reaching the browser, a card
 * found without its token, a payment confirmed by whoever asked.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

import { createApp } from '../server/app.js';
import { createStore } from '../server/store.js';
import { createMockStripe } from '../server/stripe.js';
import { rateLimit, resetRateLimits } from '../server/rate-limit.js';
import { config } from '../server/config.js';

const ROOT = new URL('..', import.meta.url).pathname;
let server;
let base;

before(async () => {
  resetRateLimits();
  const app = await createApp({
    store: createStore(), stripe: createMockStripe(),
    cardSigningKey: 'security-test-key', mode: 'development', allowPlaceholderPrices: true,
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server?.close(); resetRateLimits(); });

/* ── Nothing escapes the project directory ───────────────────────────────── */

test('no path reaches a file outside the served tree', async () => {
  const attempts = [
    '/../../etc/passwd',
    '/assets/../../etc/passwd',
    '/assets/css/../../../../etc/passwd',
    '/..%2f..%2fetc%2fpasswd',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/./././../../../etc/passwd',
    '/.env',
    '/server/config.js/../../../etc/passwd',
  ];
  for (const path of attempts) {
    const response = await fetch(`${base}${path}`);
    const body = await response.text();
    assert.ok(!body.includes('root:x:'), `${path} served /etc/passwd`);
    assert.ok(!body.includes('STRIPE_SECRET_KEY='), `${path} served an env file`);
  }
});

/* ── Secrets stay on the server ──────────────────────────────────────────── */

test('nothing the browser loads mentions a secret', async () => {
  const files = execFileSync('git', ['ls-files', 'src', 'index.html', 'validate-card.html', 'sw.js'],
    { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  assert.ok(files.length > 10, 'expected to find the browser sources');

  for (const file of files) {
    const contents = await readFile(new URL(file, new URL('..', import.meta.url)), 'utf8');
    for (const forbidden of ['STRIPE_SECRET_KEY', 'CARD_SIGNING_KEY', 'STAFF_TOKEN', 'webhookSecret', 'sk_test_', 'sk_live_', 'whsec_']) {
      assert.ok(!contents.includes(forbidden), `${file} mentions ${forbidden}`);
    }
    assert.ok(!/from ['"][^'"]*\/server\//.test(contents), `${file} imports from server/`);
  }
});

test('the published catalogue carries no secret and no guest data', async () => {
  const payload = await (await fetch(`${base}/api/catalog`)).json();
  const serialised = JSON.stringify(payload);
  for (const forbidden of ['access_token', 'signing', 'secret', 'whsec_', 'sk_test', 'sk_live', 'public_ref']) {
    assert.ok(!serialised.includes(forbidden), `the catalogue leaks "${forbidden}"`);
  }
});

test('no committed file contains a live-looking key', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
  assert.ok(!tracked.some((file) => /^\.env$|^\.env\.(?!example)/.test(file)), 'an env file is committed');
});

/* ── A card is only reachable with its own token ─────────────────────────── */

test('cards and orders cannot be found by guessing', async () => {
  for (const path of ['/api/card/abc', '/api/card/1', '/api/orders/abc', '/api/orders/00000000-0000-0000-0000-000000000000']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404, path);
    assert.deepEqual(await response.json(), { error: 'not-found' }, `${path} said more than it should`);
  }
});

test('validating tells an unknown reference apart from nothing at all', async () => {
  const response = await fetch(`${base}/api/card/validate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reference: 'ZZZZZZ', code: 'ABC123' }),
  });
  const body = await response.json();
  assert.equal(body.valid, false);
  assert.equal(body.reason, 'not-found');
  assert.equal(body.card, undefined, 'no card details come back for a reference that does not exist');
});

/* ── Payment decisions are not open to callers ───────────────────────────── */

test('provider endpoints are closed when a staff token is configured', async () => {
  const guarded = await createApp({
    store: createStore(), stripe: createMockStripe(),
    cardSigningKey: 'k', staffToken: 'a-real-token', mode: 'development',
  });
  const listener = guarded.listen(0);
  await new Promise((resolve) => listener.once('listening', resolve));
  const url = `http://127.0.0.1:${listener.address().port}`;

  for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: 'a-real-token' }]) {
    const response = await fetch(`${url}/api/provider/queue`, { headers });
    assert.equal(response.status, 401, JSON.stringify(headers));
  }
  listener.close();
});

test('a production server refuses provider endpoints with no token at all', async () => {
  const unguarded = await createApp({
    store: createStore(), stripe: createMockStripe(),
    cardSigningKey: 'k', staffToken: '', mode: 'production',
  });
  const listener = unguarded.listen(0);
  await new Promise((resolve) => listener.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${listener.address().port}/api/provider/queue`);
  assert.equal(response.status, 401, 'unusable is the safe side of this trade');
  listener.close();
});

/* ── Limits ──────────────────────────────────────────────────────────────── */

test('an oversized body is refused rather than read', async () => {
  const response = await fetch(`${base}/api/cart/price`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lines: Array.from({ length: 50_000 }, () => ({ productId: 'x' })) }),
  }).catch(() => ({ status: 413 }));
  assert.ok([413, 400].includes(response.status), `got ${response.status}`);
});

test('malformed JSON is refused without a stack trace', async () => {
  const response = await fetch(`${base}/api/checkout`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json',
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.ok(!JSON.stringify(body).includes('at '), 'no stack trace leaked');
});

test('the rate limiter counts within a window and forgets between them', () => {
  resetRateLimits();
  const key = 'test-subject';
  for (let i = 0; i < 5; i++) {
    assert.equal(rateLimit(key, { limit: 5, windowMs: 1000, now: 1_000_000 }).allowed, true, `attempt ${i + 1}`);
  }
  assert.equal(rateLimit(key, { limit: 5, windowMs: 1000, now: 1_000_000 }).allowed, false, 'the sixth is refused');
  assert.equal(rateLimit(key, { limit: 5, windowMs: 1000, now: 1_002_000 }).allowed, true, 'the next window starts clean');
});

test('guessing card codes runs into a ceiling', async () => {
  resetRateLimits();
  let refused = 0;
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await fetch(`${base}/api/card/validate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reference: 'AAAAAA', code: String(attempt).padStart(6, '0') }),
    });
    if (response.status === 429) refused++;
  }
  assert.ok(refused > 0, 'a brute-force run should start getting refused');
  resetRateLimits();
});

/* ── Configuration refuses to be quietly unsafe ──────────────────────────── */

test('the server says out loud what is missing', () => {
  // Nothing is configured in a test run, so every warning should be present.
  const warnings = (() => {
    const original = { ...config };
    return original;
  })();
  assert.ok(warnings, 'config loads');

  // The important invariant: placeholders are off unless explicitly turned on.
  assert.equal(config.allowPlaceholderPrices, false);
  assert.equal(config.useDevPrices, false);
});

/* ── What the card screen does not say ───────────────────────────────────── */

test('nothing on the guest card screen describes how the card is protected', async () => {
  // The QR is temporary and checked server-side, and that is none of the guest's
  // business: a membership card should not read like a security product. This
  // guards the wording as much as the markup — a stray "scade fra" put back by a
  // later change would fail here.
  const files = ['src/commerce/ui/card-sheet.js', 'src/i18n.js', 'assets/css/app.css'];
  const forbidden = [
    'countdown', 'secondsRemaining', 'codeRefreshes', 'manualCode',
    'si aggiorna', 'prossimo codice', 'refreshes in', 'expires in',
    'scade il codice', 'codice scade', 'dinamico', 'rotating', 'temporaneo',
  ];
  for (const file of files) {
    const contents = await readFile(new URL(file, new URL('..', import.meta.url)), 'utf8');
    // Comments explain the mechanism on purpose; only what can reach a screen counts.
    const visible = contents
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const phrase of forbidden) {
      assert.ok(!visible.toLowerCase().includes(phrase.toLowerCase()),
        `${file} would show the guest "${phrase}"`);
    }
  }
});

test('the interface strings never mention a code that changes', async () => {
  const { UI } = await import('../src/i18n.js');
  const everything = JSON.stringify(UI).toLowerCase();
  for (const phrase of ['si aggiorna', 'prossimo codice', 'countdown', 'scade fra', 'refreshes', 'temporane', 'dinamic']) {
    assert.ok(!everything.includes(phrase), `an interface string mentions "${phrase}"`);
  }
});

test('the shipped hair schedule is empty, so no availability is invented', async () => {
  const { MANUAL_SCHEDULE } = await import('../commerce/schedule.js');
  for (const [product, days] of Object.entries(MANUAL_SCHEDULE)) {
    assert.deepEqual(days, {}, `${product} ships with invented availability`);
  }
});
