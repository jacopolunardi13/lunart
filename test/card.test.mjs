/**
 * The Privilege Card.
 *
 * The point of these is that holding the screen is not the same as holding the
 * card. A code works for a minute, works once, and only while the card behind it
 * is good — so a screenshot, a forwarded photo, or a card that has since been
 * revoked all fail, and they fail on the server, where the phone has no say.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCard, cardState, currentCode, validateCode, publicView, holderView,
  revoke, qrPayload, codeFor, windowFor, MAX_CARD_PEOPLE, CARD_STATUS,
} from '../server/card.js';
import { createStore } from '../server/store.js';
import { propertyTimeToInstant } from '../commerce/time.js';

const KEY = 'a-test-signing-key-which-never-leaves-the-server';
const PERIOD = 60;

async function freshCard(over = {}) {
  const store = createStore();
  const card = buildCard({
    orderId: 'order-1', holderName: 'Jacopo Lunardi',
    startDate: '2026-10-05', days: 5, variantId: '5d', signingKey: KEY, ...over,
  });
  await store.cards.create(card);
  return { store, card };
}

const during = new Date('2026-10-07T12:00:00Z');

/* ── Dates and limits ────────────────────────────────────────────────────── */

test('a card runs from the chosen day to the end of the last one', async () => {
  const { card } = await freshCard();
  assert.equal(card.start_date, '2026-10-05');
  assert.equal(card.end_date, '2026-10-09');
  assert.equal(card.starts_at, propertyTimeToInstant('2026-10-05', '00:00').toISOString());
  // Midnight at the end of the 9th in Florence, which is 22:00 UTC in summer time.
  assert.equal(card.expires_at, '2026-10-09T22:00:00.000Z');
});

test('each length lands where it should', async () => {
  for (const [days, end] of [[2, '2026-10-06'], [5, '2026-10-09'], [8, '2026-10-12']]) {
    const { card } = await freshCard({ days });
    assert.equal(card.end_date, end, `${days} days`);
  }
});

test('a card is for two people and is not transferable', async () => {
  const { card } = await freshCard();
  assert.equal(card.max_people, MAX_CARD_PEOPLE);
  assert.equal(card.max_people, 2);
  assert.equal(card.transferable, false);
  assert.equal(publicView(card).max_people, 2);
  assert.equal(publicView(card).transferable, false);
  assert.equal(holderView(card).transferable, false);
});

test('a card refuses to exist without a real start date or length', () => {
  assert.throws(() => buildCard({ startDate: 'tomorrow', days: 5, signingKey: KEY }), /valid start date/);
  assert.throws(() => buildCard({ startDate: '2026-10-05', days: 0, signingKey: KEY }), /whole number of days/);
});

test('its state follows the clock', async () => {
  const { card } = await freshCard();
  assert.equal(cardState(card, new Date('2026-10-04T12:00:00Z')), 'not-started');
  assert.equal(cardState(card, during), 'active');
  assert.equal(cardState(card, new Date('2026-10-09T21:59:00Z')), 'active', 'still good on the last evening');
  assert.equal(cardState(card, new Date('2026-10-09T22:00:01Z')), 'expired');
});

/* ── Secrets ─────────────────────────────────────────────────────────────── */

test('nothing secret is stored on the card itself', async () => {
  const { card } = await freshCard();
  const serialised = JSON.stringify(card);
  assert.ok(!serialised.includes(KEY), 'the signing key must never be written down with the card');
  assert.equal(card.secret, undefined);
  assert.equal(card.card_secret, undefined);
});

test('two cards never share a code, even issued in the same instant', async () => {
  const a = buildCard({ orderId: 'o', holderName: 'A', startDate: '2026-10-05', days: 2, signingKey: KEY });
  const b = buildCard({ orderId: 'o', holderName: 'B', startDate: '2026-10-05', days: 2, signingKey: KEY });
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.public_ref, b.public_ref);
  const window = windowFor(during.getTime(), PERIOD);
  assert.notEqual(codeFor({ signingKey: KEY, cardId: a.id, window }), codeFor({ signingKey: KEY, cardId: b.id, window }));
});

test('a different signing key gives a different code', async () => {
  const { card } = await freshCard();
  const window = windowFor(during.getTime(), PERIOD);
  assert.notEqual(
    codeFor({ signingKey: KEY, cardId: card.id, window }),
    codeFor({ signingKey: 'another-key', cardId: card.id, window }),
  );
});

/* ── The rotating code ───────────────────────────────────────────────────── */

test('the code changes with the window and carries nothing readable', async () => {
  const { card } = await freshCard();
  const first = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now: during });
  const later = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now: new Date(during.getTime() + 120_000) });

  assert.notEqual(first.code, later.code);
  assert.match(first.code, /^[0-9A-HJKMNP-TV-Z]{6}$/);
  assert.ok(!first.code.includes(card.holder_name));
  assert.ok(!first.code.includes(card.id));
  assert.ok(!first.code.includes(card.end_date.replace(/-/g, '')));
  assert.ok(first.secondsRemaining > 0 && first.secondsRemaining <= PERIOD);
  assert.equal(first.manualCode, `${card.public_ref}-${first.code}`);
});

test('the QR points a camera at the validation page and nothing else', async () => {
  const { card } = await freshCard();
  const code = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now: during });
  const url = new URL(qrPayload('https://guide.lunart.example', card, code.code));
  assert.equal(url.pathname, '/validate-card');
  assert.equal(url.searchParams.get('c'), card.public_ref);
  assert.equal(url.searchParams.get('k'), code.code);
  assert.equal(url.searchParams.get('holder'), null, 'no name travels in the QR');
});

/* ── Validation ──────────────────────────────────────────────────────────── */

test('a current code validates, and says who is holding it', async () => {
  const { store, card } = await freshCard();
  const { code } = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now: during });
  const result = await validateCode({ reference: card.public_ref, code, store, signingKey: KEY, periodSeconds: PERIOD, now: during });

  assert.equal(result.valid, true);
  assert.equal(result.card.holder, 'Jacopo Lunardi');
  assert.equal(result.card.max_people, 2);
  assert.equal(result.card.valid_until, '2026-10-09');
  assert.ok(result.benefits.length > 0, 'a venue is told what to give');
  assert.equal(result.card.id, undefined, 'the venue never sees the card id');
});

test('the reference is case- and space-insensitive, as read off a screen', async () => {
  const { store, card } = await freshCard();
  const { code } = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now: during });
  const result = await validateCode({
    reference: `  ${card.public_ref.toLowerCase()} `, code: code.toLowerCase(),
    store, signingKey: KEY, periodSeconds: PERIOD, now: during,
  });
  assert.equal(result.valid, true);
});

test('a card is usable as often as it is shown — nothing is consumed or counted', async () => {
  // The card is a membership, not a voucher book. Two venues in an evening, a
  // double tap, a reloaded page: the same answer every time.
  const { store, card } = await freshCard();
  const { code } = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now: during });

  for (let scan = 1; scan <= 5; scan++) {
    const result = await validateCode({ reference: card.public_ref, code, store, signingKey: KEY, periodSeconds: PERIOD, now: during });
    assert.equal(result.valid, true, `scan ${scan} should still be valid`);
    assert.equal(result.reason, undefined);
  }

  // And nothing about usage is recorded anywhere on the card.
  const stored = await store.cards.get(card.id);
  for (const key of ['uses', 'used', 'usage_count', 'redemptions', 'last_used_at', 'benefit_used']) {
    assert.equal(key in stored, false, `the card should not track "${key}"`);
  }
});

test('the store keeps no record of a card being used', async () => {
  const { store, card } = await freshCard();
  const { code } = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now: during });
  await validateCode({ reference: card.public_ref, code, store, signingKey: KEY, periodSeconds: PERIOD, now: during });
  const snapshot = await store.snapshot();
  assert.equal(snapshot.usedCodes, undefined, 'there is no consumed-code ledger any more');
});

test('an old code stops working, with a little grace for typing', async () => {
  const { store, card } = await freshCard();
  const window = windowFor(during.getTime(), PERIOD);
  const previous = codeFor({ signingKey: KEY, cardId: card.id, window: window - 1 });
  const ancient = codeFor({ signingKey: KEY, cardId: card.id, window: window - 30 });

  const stillOk = await validateCode({ reference: card.public_ref, code: previous, store, signingKey: KEY, periodSeconds: PERIOD, grace: 1, now: during });
  assert.equal(stillOk.valid, true, 'the window just gone is accepted');

  const tooOld = await validateCode({ reference: card.public_ref, code: ancient, store, signingKey: KEY, periodSeconds: PERIOD, grace: 1, now: during });
  assert.equal(tooOld.valid, false);
  assert.equal(tooOld.reason, 'invalid-code');
});

test('a code from the future does not work either', async () => {
  const { store, card } = await freshCard();
  const window = windowFor(during.getTime(), PERIOD);
  const next = codeFor({ signingKey: KEY, cardId: card.id, window: window + 5 });
  const result = await validateCode({ reference: card.public_ref, code: next, store, signingKey: KEY, periodSeconds: PERIOD, now: during });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid-code');
});

test('a guessed code does not work', async () => {
  const { store, card } = await freshCard();
  for (const guess of ['000000', 'ABCDEF', '', 'ZZZZZZZZ']) {
    const result = await validateCode({ reference: card.public_ref, code: guess, store, signingKey: KEY, periodSeconds: PERIOD, now: during });
    assert.equal(result.valid, false, `"${guess}" should not pass`);
  }
});

test('an expired card fails whatever its phone is showing', async () => {
  const { store, card } = await freshCard();
  const after = new Date('2026-10-20T12:00:00Z');
  const { code } = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now: after });
  const result = await validateCode({ reference: card.public_ref, code, store, signingKey: KEY, periodSeconds: PERIOD, now: after });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'expired');
});

test('a card that has not started yet fails too', async () => {
  const { store, card } = await freshCard();
  const before = new Date('2026-10-01T12:00:00Z');
  const { code } = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now: before });
  const result = await validateCode({ reference: card.public_ref, code, store, signingKey: KEY, periodSeconds: PERIOD, now: before });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'not-started');
});

test('a revoked card stops working immediately', async () => {
  const { store, card } = await freshCard();
  const { code } = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now: during });

  await store.cards.update(card.id, revoke(card, 'chargeback'));
  const result = await validateCode({ reference: card.public_ref, code, store, signingKey: KEY, periodSeconds: PERIOD, now: during });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'revoked');
  const stored = await store.cards.get(card.id);
  assert.equal(stored.status, CARD_STATUS.revoked);
  assert.equal(stored.revoked_reason, 'chargeback');
  assert.ok(stored.revoked_at);
});

test('an unknown reference tells a prober nothing useful', async () => {
  const { store } = await freshCard();
  const result = await validateCode({ reference: 'ZZZZZZ', code: 'ABC123', store, signingKey: KEY, periodSeconds: PERIOD, now: during });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'not-found');
  assert.equal(result.card, undefined, 'nothing about any card is returned');
});

test('a malformed request is refused before anything is looked up', async () => {
  const { store } = await freshCard();
  for (const [reference, code] of [[null, null], ['', 'ABC123'], ['ABC123', '']]) {
    const result = await validateCode({ reference, code, store, signingKey: KEY, periodSeconds: PERIOD, now: during });
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'malformed');
  }
});

/* ── What each side is shown ─────────────────────────────────────────────── */

test('the holder sees their card, the venue sees only what it needs', async () => {
  const { card } = await freshCard();

  const venue = publicView(card);
  assert.deepEqual(Object.keys(venue).sort(),
    ['expires_at', 'holder', 'initials', 'max_people', 'reference', 'status', 'transferable', 'valid_from', 'valid_until'].sort());
  assert.equal(venue.initials, 'JL');
  assert.equal(venue.order_id, undefined);
  assert.equal(venue.access_token, undefined);

  const holder = holderView(card, during);
  assert.equal(holder.state, 'active');
  assert.equal(holder.days, 5);
  assert.ok(Array.isArray(holder.benefits));
  assert.equal(holder.access_token, undefined, 'even the holder view carries no token');
});

/* ── What a venue is told ────────────────────────────────────────────────── */

test('a venue asking from its own page is told its own benefit', async () => {
  const { store, card } = await freshCard();
  const { code } = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now: during });

  const scoped = await validateCode({
    reference: card.public_ref, code, store, signingKey: KEY, periodSeconds: PERIOD,
    now: during, partnerId: 'opera-caffe',
  });
  assert.equal(scoped.valid, true);
  assert.equal(scoped.partner.partner, 'Opera Caffè');
  assert.equal(scoped.partner.label.it, '30% sul menù al tavolo');
  assert.equal(scoped.benefits.length, 1, 'one benefit, not a list to choose from');
});

test('a venue asking from the shared page is shown every benefit', async () => {
  const { store, card } = await freshCard();
  const { code } = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now: during });
  const result = await validateCode({ reference: card.public_ref, code, store, signingKey: KEY, periodSeconds: PERIOD, now: during });
  assert.equal(result.partner, null);
  assert.ok(result.benefits.length >= 1);
});

test('an unknown or inactive partner does not turn a valid card red', async () => {
  const { store, card } = await freshCard();
  const { code } = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now: during });
  for (const partnerId of ['example-bar', 'does-not-exist']) {
    const result = await validateCode({
      reference: card.public_ref, code, store, signingKey: KEY, periodSeconds: PERIOD, now: during, partnerId,
    });
    assert.equal(result.valid, true, `${partnerId} should still validate the card`);
    assert.equal(result.partner, null, `${partnerId} should offer no benefit`);
  }
});

test('a venue never learns anything it does not need', async () => {
  const { store, card } = await freshCard();
  const { code } = currentCode(card, { signingKey: KEY, periodSeconds: PERIOD, now: during });
  const result = await validateCode({
    reference: card.public_ref, code, store, signingKey: KEY, periodSeconds: PERIOD, now: during, partnerId: 'opera-caffe',
  });
  const serialised = JSON.stringify(result);
  for (const forbidden of [card.id, card.access_token, card.order_id, KEY, 'notes']) {
    assert.ok(!serialised.includes(forbidden), `the scan result leaks ${forbidden}`);
  }
});
