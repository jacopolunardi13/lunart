/**
 * The code, and the space where it will be.
 *
 * A guest who bought Privilege in October for a stay in November used to open her
 * card and find a paragraph of text where the QR goes. Nothing was wrong — there is
 * no code until the card starts, and there must not be — but the product read as
 * unfinished, and she could not see what she would be holding up at a door.
 *
 * So the slot is always drawn, and what fills it is one of two things that must
 * never be confused:
 *
 *   a live code     issued by the server, rotating, and only ever for a card whose
 *                   state is `active`.
 *   a preview       a real QR symbol encoding something that is deliberately not a
 *                   credential, drawn by the browser, static, and worth nothing.
 *
 * These tests are mostly about the second one not quietly becoming the first. The
 * preview carries no code, is not a URL, and would be refused three times over; it
 * does not become valid when the date arrives, because at that moment the screen
 * throws it away and asks the server for a real one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCard, cardState, currentCode, validateCode, qrPayload, revoke,
} from '../server/card.js';
import { createStore } from '../server/store.js';
import { createApp } from '../server/app.js';
import { createMockStripe } from '../server/stripe.js';
import { previewPayload, activationWaitMs } from '../src/commerce/ui/card-sheet.js';
import { propertyTimeToInstant } from '../commerce/time.js';
import { UI } from '../src/i18n.js';

const KEY = 'a-test-signing-key-which-never-leaves-the-server';
const PERIOD = 60;

/** Starts tomorrow, so it is owned and not yet usable. */
const FUTURE = { startDate: '2026-11-07', days: 2 };
const BEFORE = new Date('2026-11-01T12:00:00Z');
const DURING = new Date('2026-11-07T20:00:00Z');
const AFTER = new Date('2026-11-20T12:00:00Z');

async function stored(over = {}) {
  const store = createStore();
  const card = buildCard({
    orderId: 'order-qr', holderName: 'Irene Rossi', variantId: '2d', signingKey: KEY,
    ...FUTURE, ...over,
  });
  await store.cards.create(card);
  return { store, card };
}

/* ── What the preview is ─────────────────────────────────────────────────── */

test('the preview encodes the reference behind an explicit inactive marker', () => {
  const payload = previewPayload('QD13Z5');
  assert.equal(payload, 'lunart:privilege:inactive:QD13Z5');

  // Nothing secret: the reference is already printed on the face of the card.
  assert.equal(/[0-9a-f]{16,}/i.test(payload), false, 'no token, no id, no key');
  assert.equal(payload.toLowerCase().includes('http'), false, 'and not a link');
});

test('the preview is not a URL, so a phone camera opens nothing', () => {
  const live = qrPayload('https://guide.example', { public_ref: 'QD13Z5' }, 'ABC123');
  assert.ok(live.startsWith('https://'), 'the real one is a validation link');

  const preview = previewPayload('QD13Z5');
  assert.equal(preview.startsWith('http'), false);
  // `lunart:` is not a scheme any browser will follow, which is the point.
  assert.equal(new URL(preview).protocol, 'lunart:');
});

test('the preview carries no code at all', () => {
  const payload = previewPayload('QD13Z5');
  const [, , marker, reference] = payload.split(':');
  assert.equal(marker, 'inactive');
  assert.equal(reference, 'QD13Z5');
  assert.equal(payload.split(':').length, 4, 'four parts, and none of them is a code');
});

/* ── A · a card that has not started ─────────────────────────────────────── */

test('A · the server issues no code before the card starts', async () => {
  const { store, card } = await stored();
  assert.equal(cardState(card, BEFORE), 'not-started');

  const app = await createApp({
    store, stripe: createMockStripe(), seed: false, staffToken: '',
    cardSigningKey: KEY, publicUrl: 'http://127.0.0.1',
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const port = server.address().port;
    const view = await (await fetch(`http://127.0.0.1:${port}/api/card/${card.access_token}`)).json();
    assert.equal(view.state, 'not-started');
    assert.equal(view.qr, null, 'no code');
    assert.equal(view.refreshIn, null, 'and nothing to come back for');
    // And nothing resembling one travels with it either.
    const sent = JSON.stringify(view).toLowerCase();
    for (const leak of ['signing', 'secret', 'window', 'code"']) {
      assert.equal(sent.includes(leak), false, `the card view leaks "${leak}"`);
    }
  } finally {
    server.close();
  }
});

test('A · and the preview would be refused if a venue ever scanned it', async () => {
  const { store, card } = await stored();
  const payload = previewPayload(card.public_ref);

  // Scanned and handed over whole: no code, so it does not even get looked up.
  assert.deepEqual(
    await validateCode({ reference: payload, code: '', store, signingKey: KEY, periodSeconds: PERIOD, now: BEFORE }),
    { valid: false, reason: 'malformed' },
  );

  // Typed into the manual field, which splits a REF-CODE on dashes and spaces.
  const [reference, code] = payload.trim().toUpperCase().split(/[-\s]+/);
  const typed = await validateCode({ reference, code, store, signingKey: KEY, periodSeconds: PERIOD, now: BEFORE });
  assert.equal(typed.valid, false);
  assert.equal(typed.reason, 'malformed', 'one token, so there is no code to check');

  // And the real reference with a real code is still refused, because the rule
  // that was already there has not moved: only an active card validates.
  const real = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now: BEFORE });
  const early = await validateCode({
    reference: card.public_ref, code: real.code, store,
    signingKey: KEY, periodSeconds: PERIOD, now: BEFORE,
  });
  assert.equal(early.valid, false);
  assert.equal(early.reason, 'not-started');
});

test('A · the preview is not a code waiting for a date', async () => {
  const { store, card } = await stored();
  const payload = previewPayload(card.public_ref);
  const [reference, code] = payload.trim().toUpperCase().split(/[-\s]+/);

  // The same string, on the day the card begins. Still nothing.
  const onTheDay = await validateCode({
    reference, code, store, signingKey: KEY, periodSeconds: PERIOD, now: DURING,
  });
  assert.equal(onTheDay.valid, false, 'a preview never ripens into a credential');

  // What does work that day is a code the server issued that day.
  const issued = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now: DURING });
  const scanned = await validateCode({
    reference: card.public_ref, code: issued.code, store,
    signingKey: KEY, periodSeconds: PERIOD, now: DURING,
  });
  assert.equal(scanned.valid, true);
});

/* ── B · the card, once it is running ────────────────────────────────────── */

test('B · an active card gets a real rotating code and the preview is gone', async () => {
  const { store, card } = await stored();
  assert.equal(cardState(card, DURING), 'active');

  const app = await createApp({
    store, stripe: createMockStripe(), seed: false, staffToken: '',
    cardSigningKey: KEY, publicUrl: 'http://127.0.0.1',
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const port = server.address().port;
    const view = await (await fetch(`http://127.0.0.1:${port}/api/card/${card.access_token}`)).json();
    // The stay is in November, so this only answers once the clock is there; what
    // the test can assert now is the shape of the rule, which `cardState` decides.
    assert.equal(view.state, cardState(card));
    assert.equal(view.qr === null, view.state !== 'active');
  } finally {
    server.close();
  }

  // The live payload is a link, and it is nothing like the preview.
  const code = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now: DURING });
  const live = qrPayload('https://guide.example', card, code.code);
  assert.ok(live.includes(`c=${card.public_ref}`) && live.includes(`k=${code.code}`));
  assert.notEqual(live, previewPayload(card.public_ref));
  assert.equal(live.includes('inactive'), false);
});

/* ── C and D · over, and withdrawn ───────────────────────────────────────── */

test('C · a card that is over gets no code, and its preview still cannot validate', async () => {
  const { store, card } = await stored();
  assert.equal(cardState(card, AFTER), 'expired');

  const payload = previewPayload(card.public_ref);
  const [reference, code] = payload.trim().toUpperCase().split(/[-\s]+/);
  const scanned = await validateCode({ reference, code, store, signingKey: KEY, periodSeconds: PERIOD, now: AFTER });
  assert.equal(scanned.valid, false);

  const real = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now: AFTER });
  const late = await validateCode({
    reference: card.public_ref, code: real.code, store, signingKey: KEY, periodSeconds: PERIOD, now: AFTER,
  });
  assert.equal(late.valid, false);
  assert.equal(late.reason, 'expired');
});

test('D · a withdrawn card is refused whatever its screen is showing', async () => {
  const store = createStore();
  const card = await store.cards.create(revoke(buildCard({
    orderId: 'order-qr', holderName: 'Irene Rossi', variantId: '2d', signingKey: KEY, ...FUTURE,
  }), 'test'));

  assert.equal(cardState(card, DURING), 'revoked');
  const real = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now: DURING });
  const scanned = await validateCode({
    reference: card.public_ref, code: real.code, store, signingKey: KEY, periodSeconds: PERIOD, now: DURING,
  });
  assert.equal(scanned.valid, false);
  assert.equal(scanned.reason, 'revoked');
});

/* ── The invariant, stated once ──────────────────────────────────────────── */

test('only an active card ever validates, at any hour of its life', async () => {
  const { store, card } = await stored();

  for (const [label, now] of [['before', BEFORE], ['during', DURING], ['after', AFTER]]) {
    const code = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now });
    const result = await validateCode({
      reference: card.public_ref, code: code.code, store,
      signingKey: KEY, periodSeconds: PERIOD, now,
    });
    assert.equal(result.valid, cardState(card, now) === 'active', label);
  }
});

/* ── E · the switch at midnight ──────────────────────────────────────────── */

/**
 * A guest who opens her card the evening before should not have to close it and
 * open it again at midnight. One wake-up, at the moment the card begins, and only
 * when somebody could plausibly still be looking at it.
 */
test('E · a card about to start schedules one wake-up, and nothing else does', () => {
  const midnight = propertyTimeToInstant('2026-11-07', '00:00').getTime();
  const waiting = { state: 'not-started', start_date: '2026-11-07' };

  const soon = activationWaitMs(waiting, midnight - 6 * 3600_000);
  assert.ok(soon > 6 * 3600_000 && soon < 6.1 * 3600_000, `${soon}`);
  assert.ok(soon > midnight - (midnight - 6 * 3600_000) - 1, 'and lands after the boundary, never on it');

  // Too far off to be a sheet somebody is holding open, and too long for a timer.
  assert.equal(activationWaitMs(waiting, midnight - 13 * 3600_000), null);
  // The browser's clock thinks it has already begun; the server decides, not this.
  assert.equal(activationWaitMs(waiting, midnight + 1000), null);

  // Nothing else waits for anything.
  for (const state of ['active', 'expired', 'revoked']) {
    assert.equal(activationWaitMs({ state, start_date: '2026-11-07' }, midnight - 3600_000), null, state);
  }
  assert.equal(activationWaitMs({ state: 'not-started' }, midnight - 3600_000), null, 'no date, no timer');
  assert.equal(activationWaitMs(null), null);
});

test('E · the boundary is Florence\'s, not the phone\'s', () => {
  // Midnight in Rome, read from the one function that knows where Florence is.
  const midnight = propertyTimeToInstant('2026-11-07', '00:00');
  assert.equal(midnight.toISOString(), '2026-11-06T23:00:00.000Z', 'CET, in November');

  const waiting = { state: 'not-started', start_date: '2026-11-07' };
  const wait = activationWaitMs(waiting, midnight.getTime() - 60_000);
  assert.ok(wait > 60_000 && wait < 63_000, `${wait}`);
});

/* ── The copy the slot carries ───────────────────────────────────────────── */

test('the slot says what it is, in both languages, without technical words', () => {
  for (const lang of ['it', 'en']) {
    const hint = UI[lang].cardQrPreviewHint;
    assert.ok(hint?.trim(), lang);
    assert.ok(UI[lang].cardStartsOn?.trim(), lang);
    assert.ok(UI[lang].cardStateNotStarted?.trim() && UI[lang].cardStateExpired?.trim());
    assert.ok(UI[lang].cardStateRevoked?.trim() && UI[lang].cardNotUsable?.trim());

    for (const word of ['token', 'rotante', 'rotating', 'crittograf', 'cryptograph', 'hmac', 'refresh']) {
      assert.equal(hint.toLowerCase().includes(word), false, `${lang}: "${word}" is not the guest's problem`);
    }
  }
  assert.notEqual(UI.it.cardQrPreviewHint, UI.en.cardQrPreviewHint);
});
