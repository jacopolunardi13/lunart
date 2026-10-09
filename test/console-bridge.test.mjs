/**
 * LunArt's side of the shared Staff console (one app for LunArt and Bella Vigna).
 *
 * Everything here is opt-in: with no CONSOLE_* variable set, the Staff API, the
 * Staff app and the notifications behave exactly as before — the first test pins
 * that. With them set, the console gets its own credential (alongside the shared
 * STAFF_TOKEN, so nobody is stopped), every Staff answer names the house, and every
 * staff notification is also sent to the console, signed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createStore } from '../server/store.js';
import { createMockStripe } from '../server/stripe.js';
import { createApp } from '../server/app.js';
import { createPushAdapter, notifyStaff } from '../server/push.js';
import { verifyRelaySignature } from '../server/relay.js';
import { sameSecret } from '../server/http.js';

const SHARED = 'shared-staff-token-lunart';
const SERVICE = 'console-service-token-lunart';
const RELAY = 'relay-secret-lunart';

async function serve(t, overrides = {}) {
  const app = await createApp({
    store: createStore(), stripe: createMockStripe(), cardSigningKey: 'bridge-test',
    mode: 'production', seed: false, allowPlaceholderPrices: true, useDevPrices: false,
    staffToken: SHARED,
    ...overrides,
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const status = (token, path = '/api/staff/dashboard') =>
    fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }).then((r) => r.status);
  return { app, base, status };
}

/** A console that records what it is sent. */
async function fakeConsole(t, { answer = 202 } = {}) {
  const received = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ url: req.url, headers: req.headers, raw: Buffer.concat(chunks).toString('utf8') });
    res.writeHead(answer, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, received };
}

test('with no console configured, nothing changes', async (t) => {
  const { app, base, status } = await serve(t);
  assert.equal(await status(SHARED), 200);
  assert.equal(await status(SERVICE), 401);
  assert.equal(await status(''), 401);
  assert.equal(app.push.relay, null, 'no relay');
  const page = await fetch(`${base}/staff`);
  assert.equal(page.status, 200, 'the Staff app is where it was');
  const health = await fetch(`${base}/api/health`).then((r) => r.json());
  assert.equal(health.integrations.staffConsole.configured, false);
  assert.equal(health.integrations.staffConsole.sharedStaffToken, 'active');
});

test('the console’s own credential works alongside the shared Staff token', async (t) => {
  const { status } = await serve(t, { console: { serviceToken: SERVICE } });
  assert.equal(await status(SERVICE), 200);
  assert.equal(await status(SHARED), 200, 'nobody is stopped while people move over');
  assert.equal(await status('wrong'), 401);
  assert.equal(await status(`${SERVICE}x`), 401);
  assert.equal(await status(SERVICE, '/api/staff/orders'), 200);
});

test('retiring the shared token: it stops, the console keeps working, /staff leads to the console', async (t) => {
  const { base, status } = await serve(t, {
    staffTokenRetired: true,
    console: { serviceToken: SERVICE, url: 'https://staff.example.test' },
  });
  assert.equal(await status(SHARED), 401);
  assert.equal(await status(SERVICE), 200);
  const page = await fetch(`${base}/staff`, { redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), 'https://staff.example.test');
});

test('a retired token with nowhere to send people says so instead of serving the old app', async (t) => {
  const { base } = await serve(t, { staffTokenRetired: true, console: { serviceToken: SERVICE } });
  assert.equal((await fetch(`${base}/staff`)).status, 410);
});

test('every Staff answer names the house, and the dashboard lists its rooms', async (t) => {
  const { base } = await serve(t, { console: { serviceToken: SERVICE } });
  const get = (path) => fetch(`${base}/api/staff${path}`, { headers: { authorization: `Bearer ${SERVICE}` } }).then((r) => r.json());
  for (const path of ['/dashboard', '/orders', '/reservations', '/sync']) {
    assert.deepEqual((await get(path)).property, { id: 'lunart', name: 'LunArt', longName: 'LunArt Firenze' }, path);
  }
  assert.deepEqual((await get('/dashboard')).rooms.map((room) => room.id), ['301', '302', '303', '304', '305', '306']);
});

test('a staff notification also goes to the console, signed with the shared secret', async (t) => {
  const console = await fakeConsole(t);
  const push = createPushAdapter({ console: { relayUrl: console.url, relaySecret: RELAY } });
  const result = await notifyStaff({
    store: createStore(), push, event: 'reservation-new',
    data: { reservationId: 'r1', guest: 'Anna Rossi', room: '303', check_in: '2026-10-12', check_out: '2026-10-14' },
  });
  assert.equal(result.relayed.ok, true);
  assert.equal(console.received.length, 1);
  const [sent] = console.received;
  assert.equal(sent.url, '/console/api/relay/lunart');
  assert.deepEqual(verifyRelaySignature({
    secret: RELAY, timestamp: sent.headers['x-relay-timestamp'], signature: sent.headers['x-relay-signature'], rawBody: sent.raw,
  }), { ok: true });
  assert.equal(verifyRelaySignature({
    secret: 'another', timestamp: sent.headers['x-relay-timestamp'], signature: sent.headers['x-relay-signature'], rawBody: sent.raw,
  }).ok, false);
  const body = JSON.parse(sent.raw);
  assert.equal(body.property, 'lunart');
  assert.equal(body.event, 'reservation-new');
  assert.match(body.id, /^[0-9a-f-]{36}$/);
  assert.match(body.notification.body, /Anna Rossi/);
});

test('a console that is down never fails the order or reservation that triggered the notification', async (t) => {
  const push = createPushAdapter({ console: { relayUrl: 'http://127.0.0.1:9', relaySecret: RELAY } });
  const result = await notifyStaff({ store: createStore(), push, event: 'order-new', data: { orderId: 'o1', title: 'Breakfast' } });
  assert.equal(result.ok, true);
  assert.equal(result.relayed.ok, false);
  assert.ok(push.relay.state().lastError);
  const refused = await fakeConsole(t, { answer: 401 });
  const push2 = createPushAdapter({ console: { relayUrl: refused.url, relaySecret: RELAY } });
  const second = await notifyStaff({ store: createStore(), push: push2, event: 'order-new', data: { orderId: 'o2', title: 'Wine' } });
  assert.equal(second.ok, true);
  assert.equal(second.relayed.ok, false);
});

test('the health check says what is wired, never the secrets', async (t) => {
  const { base } = await serve(t, { console: { serviceToken: SERVICE, relayUrl: 'http://127.0.0.1:9', relaySecret: RELAY } });
  const text = await fetch(`${base}/api/health`).then((r) => r.text());
  const health = JSON.parse(text);
  assert.equal(health.integrations.staffConsole.configured, true);
  assert.equal(health.integrations.staffConsole.relay, true);
  for (const secret of [SERVICE, RELAY, SHARED]) assert.ok(!text.includes(secret));
});

test('secrets are compared whole: empty never matches, length does not leak through an early exit', () => {
  assert.equal(sameSecret('', ''), false);
  assert.equal(sameSecret('a', ''), false);
  assert.equal(sameSecret('abc', 'abc'), true);
  assert.equal(sameSecret('abc', 'abcd'), false);
});
