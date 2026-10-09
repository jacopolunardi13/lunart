/**
 * Signed events from a property to the Staff console.
 *
 * The property side of `server/console/notify.js`: when the Core would push a
 * notification to staff phones, it also posts the event to the console, which
 * decides which people's phones it reaches. Signed with HMAC-SHA256 over
 * `<timestamp>.<raw body>` using CONSOLE_RELAY_SECRET, a secret shared with the
 * console only. Never awaited for longer than a few seconds and never allowed to
 * fail the request that caused it: an order is taken whether or not the console
 * is up.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const RELAY_WINDOW_SECONDS = 300;

export function signRelay(secret, timestamp, rawBody) {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

export function verifyRelaySignature({ secret, timestamp, signature, rawBody, now = Date.now() }) {
  if (!secret || !timestamp || !signature) return { ok: false, reason: 'unsigned' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > RELAY_WINDOW_SECONDS) return { ok: false, reason: 'stale' };
  const expected = Buffer.from(signRelay(secret, timestamp, rawBody));
  const given = Buffer.from(String(signature));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'bad-signature' };
  return { ok: true };
}

export function createRelay({ url, secret, propertyId, fetchImpl = fetch, timeoutMs = 4000 }) {
  if (!url || !secret) return null;
  const endpoint = `${url.replace(/\/+$/, '')}/console/api/relay/${encodeURIComponent(propertyId)}`;
  const state = { sent: 0, failed: 0, lastError: null };
  return {
    endpoint,
    state: () => ({ ...state }),
    async send(notification) {
      const rawBody = JSON.stringify({ id: randomUUID(), property: propertyId, event: notification.event, notification });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-relay-timestamp': timestamp,
            'x-relay-signature': signRelay(secret, timestamp, rawBody),
          },
          body: rawBody,
          redirect: 'error',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`console answered ${response.status}`);
        state.sent += 1;
        return { ok: true, status: response.status };
      } catch (error) {
        state.failed += 1;
        state.lastError = error.name === 'AbortError' ? 'timeout' : error.message;
        return { ok: false, error: state.lastError };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
