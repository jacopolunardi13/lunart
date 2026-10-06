/**
 * Owning Privilege, and being able to use it.
 *
 * These are two questions and the bug that prompted this file came from answering
 * them with one. A guest had bought Privilege in October for a stay in November.
 * Her purchases listed the paid upgrade; her Pass rendered as a plain Pass, with no
 * way anywhere on the screen to look at the card she had paid for. Both halves of
 * that are now tested here:
 *
 *   tier   pass | privilege          — what this reservation owns.
 *   state  not-started | active |    — whether today is a day it can be used.
 *          expired | cancelled
 *
 * The four combinations are all real and none of them may be inferred from
 * another. In particular a Pass is never demoted to standard because the stay has
 * not started: an upgrade bought in advance is owned the moment it is paid for, and
 * what the dates decide is whether a door will honour it tonight.
 *
 * What does *not* move is the QR. A code is issued only for a card that is active,
 * by the server, and nothing in here asks for one earlier. The screen a guest sees
 * before activation is an information state — the card, its dates, its number, and
 * a sentence saying when the code appears — not an authorisation one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../server/store.js';
import { buildReservation, RESERVATION_STATUS } from '../server/reservations.js';
import {
  passFor, passForReservation, cardsForReservation, PASS_TIER, PASS_STATE, entitlementsOf,
} from '../server/pass.js';
import { buildCard, cardState, revoke } from '../server/card.js';
import { ENTITLEMENTS, cardBenefits, stayBenefits } from '../commerce/partners.js';
import { privilegeSection } from '../src/commerce/ui/partners.js';
import { UI } from '../src/i18n.js';

const KEY = 'k'.repeat(32);

const stay = (overrides = {}) => buildReservation({
  source: 'quovai',
  booking_reference: `PC-${Math.random().toString(36).slice(2, 8)}`,
  first_name: 'Irene',
  last_name: 'Rossi',
  room: '303',
  check_in: '2026-11-07',
  check_out: '2026-11-08',
  adults: 2,
  ...overrides,
});

const card = (overrides = {}) => ({
  ...buildCard({
    orderId: 'order_pc',
    reservationId: 'res_pc',
    holderName: 'Irene Rossi',
    startDate: '2026-11-07',
    days: 2,
    variantId: '2d',
    signingKey: KEY,
  }),
  ...overrides,
});

/** Before the stay, during it, and after it. */
const BEFORE = new Date('2026-10-06T10:00:00Z');
const DURING = new Date('2026-11-07T20:00:00Z');
const AFTER = new Date('2026-11-20T10:00:00Z');

const section = (pass, lang = 'it') => privilegeSection(cardBenefits(), pass, lang);
const count = (html, needle) => html.split(needle).length - 1;
/** Venues in that state, not benefits: `data-access` is on both. */
const venues = (html, access) => count(html, `class="partner" data-access="${access}"`);

/* ── A. A standard Pass, before the stay ─────────────────────────────────── */

test('A · a stay with no upgrade is a standard Pass, with no card to open', () => {
  const pass = passFor(stay(), { now: BEFORE });

  assert.equal(pass.tier, PASS_TIER.pass);
  assert.equal(pass.state, PASS_STATE.notStarted);
  assert.deepEqual(pass.entitlements, []);
  assert.equal(pass.card, null, 'there is no card, so there is nothing to open');
  assert.deepEqual(pass.privileges, []);
});

test('A · and the Privilege benefits are offered, not hidden, before arrival', () => {
  const html = section({ state: 'not-started', entitlements: [] });

  assert.ok(html.includes('Le Firme') && html.includes('Blue Velvet'), 'shown');
  assert.equal(count(html, 'partner__lock'), 2, 'and marked as an upgrade');
  assert.ok(html.includes(UI.it.privilegeBenefitsDiscover));
  /**
   * Buying ahead of the stay is allowed — the card is sold inside the stay and the
   * start dates offered are the stay's own — so the way to get it is on the screen
   * before arrival, not only once the guest is standing in Florence.
   */
  assert.equal(count(html, 'data-product="privilege-card"'), 1);
  assert.ok(html.includes(UI.it.privilegeGet));
});

/* ── B. Privilege already bought, stay still to come ─────────────────────── */

test('B · an upgrade bought ahead of the stay is owned from the moment it is paid', () => {
  const pass = passFor(stay(), { card: card(), now: BEFORE });

  assert.equal(pass.tier, PASS_TIER.privilege, 'owned');
  assert.equal(pass.state, PASS_STATE.notStarted, 'and not usable yet');
  assert.deepEqual(pass.entitlements, [ENTITLEMENTS.privilege]);
  assert.equal(pass.privileges.length, 2, 'the partners it unlocks are named');
});

test('B · the Pass carries the card, with the date it starts and no code', () => {
  const pass = passFor(stay(), { card: card(), now: BEFORE });

  assert.ok(pass.card, 'the card is reachable from the Pass');
  assert.equal(pass.card.state, 'not-started');
  assert.equal(pass.card.start_date, '2026-11-07');
  assert.equal(pass.card.end_date, '2026-11-08');
  assert.ok(pass.card.reference && pass.card.access_token);

  // Nothing resembling a code travels with a Pass, at any state.
  const sent = JSON.stringify(pass.card);
  for (const leak of ['qr', 'code', 'window', 'signing', 'secret']) {
    assert.equal(sent.toLowerCase().includes(leak), false, `the Pass leaks "${leak}"`);
  }
});

test('B · a guest who already paid is never asked to buy it again', () => {
  for (const lang of ['it', 'en']) {
    const html = section({ state: 'not-started', entitlements: [ENTITLEMENTS.privilege] }, lang);

    assert.equal(count(html, 'data-product='), 0, 'no second purchase');
    assert.equal(count(html, 'partner__lock'), 0, 'and nothing reads as not theirs');
    assert.ok(html.includes(UI[lang].privilegeWhenActive),
      'what it says instead is when the benefits start');
    assert.equal(html.includes(UI[lang].privilegeBenefitsDiscover), false);
    assert.equal(venues(html, 'unavailable'), 2, 'owned, and not usable today');
  }
});

/* ── C. Privilege, during the stay ───────────────────────────────────────── */

test('C · during the stay the same card is active and everything is unlocked', () => {
  const pass = passFor(stay(), { card: card(), now: DURING });

  assert.equal(pass.tier, PASS_TIER.privilege);
  assert.equal(pass.state, PASS_STATE.active);
  assert.equal(pass.card.state, 'active');
  assert.equal(pass.live, true);

  const html = section({ state: pass.state, entitlements: pass.entitlements });
  assert.equal(venues(html, 'available'), 2);
  assert.equal(count(html, 'partner__lock'), 0);
  assert.equal(count(html, 'data-product='), 0);
  assert.ok(html.includes(UI.it.privilegeBenefitsNote), 'now it says how to use them');
});

/* ── D. After the stay ───────────────────────────────────────────────────── */

test('D · once the stay is over the Pass expires and the card goes with it', () => {
  const pass = passFor(stay(), { card: card(), now: AFTER });

  assert.equal(pass.tier, PASS_TIER.privilege, 'it was still bought');
  assert.equal(pass.state, PASS_STATE.expired);
  assert.equal(pass.card.state, 'expired');
  assert.equal(pass.live, false);

  const html = section({ state: pass.state, entitlements: pass.entitlements });
  assert.equal(venues(html, 'available'), 0, 'nothing is claimable');
  assert.equal(count(html, 'data-product='), 0,
    'and a stay that is over is not a reason to sell an upgrade for it');
});

test('D · a cancelled booking is not a sales opportunity either', () => {
  const pass = passFor(stay({ status: RESERVATION_STATUS.cancelled }), { now: DURING });
  assert.equal(pass.state, PASS_STATE.cancelled);

  const html = section({ state: pass.state, entitlements: [] });
  assert.equal(count(html, 'data-product='), 0);
  assert.equal(venues(html, 'unavailable'), 2);
});

/* ── E. A card that was withdrawn ────────────────────────────────────────── */

test('E · a revoked card entitles a guest to nothing, and opens nothing', () => {
  const withdrawn = revoke(card(), 'test');
  assert.equal(cardState(withdrawn, DURING), 'revoked');
  assert.deepEqual(entitlementsOf(withdrawn), []);

  const pass = passFor(stay(), { card: withdrawn, now: DURING });
  assert.equal(pass.tier, PASS_TIER.pass, 'withdrawn is withdrawn');
  assert.equal(pass.card, null, 'and there is no card screen to reach');
  assert.deepEqual(pass.privileges, []);
});

test('E · and a revoked card is not even collected for the stay', async () => {
  const store = createStore();
  const reservation = await store.reservations.create(stay());
  await store.cards.create(revoke(card({ reservation_id: reservation.id }), 'test'));

  assert.deepEqual(await cardsForReservation({ store, reservation }), []);
  const pass = await passForReservation({ store, reservation, now: DURING });
  assert.equal(pass.tier, PASS_TIER.pass);
});

/* ── The binding, and the hole it used to leave ──────────────────────────── */

/**
 * The shape of the reported bug.
 *
 * Cards issued before the Pass existed were written with `reservation_id: null`,
 * while the orders that paid for them were bound properly. The result is a stay
 * that can see the receipt and not the entitlement — the purchase is listed, the
 * Pass is standard, and nothing on the screen explains the contradiction.
 */
test('a card bound to no stay is still recognised through the order that paid for it', async () => {
  const store = createStore();
  const reservation = await store.reservations.create(stay());
  const order = await store.orders.create({
    reservation_id: reservation.id,
    status: 'paid',
    lines: [{ product_id: 'privilege-card' }],
  });
  // Exactly the legacy row: the order knows the stay, the card does not.
  const legacy = await store.cards.create(card({ order_id: order.id, reservation_id: null }));

  const pass = await passForReservation({ store, reservation, now: DURING });
  assert.equal(pass.tier, PASS_TIER.privilege, 'the stay owns this card');
  assert.equal(pass.card.reference, legacy.public_ref);

  // And the hole is filled in rather than worked around on every read.
  assert.equal((await store.cards.get(legacy.id)).reservation_id, reservation.id);
});

test('a card belonging to somebody else is never collected', async () => {
  const store = createStore();
  const mine = await store.reservations.create(stay());
  const theirs = await store.reservations.create(stay({ booking_reference: 'OTHER-1' }));
  const order = await store.orders.create({ reservation_id: theirs.id, status: 'paid', lines: [] });
  await store.cards.create(card({ order_id: order.id, reservation_id: null }));

  assert.deepEqual(await cardsForReservation({ store, reservation: mine }), []);
  assert.equal((await passForReservation({ store, reservation: mine, now: DURING })).tier, PASS_TIER.pass);

  // An unattached card with no order behind it belongs to nobody.
  await store.cards.create(card({ order_id: 'order_nowhere', reservation_id: null }));
  assert.deepEqual(await cardsForReservation({ store, reservation: mine }), []);
});

/* ── F. The standard Pass, unchanged ─────────────────────────────────────── */

test('F · the standard Pass still carries the stay and nothing that was not bought', () => {
  for (const now of [BEFORE, DURING, AFTER]) {
    const pass = passFor(stay(), { now });
    assert.equal(pass.tier, PASS_TIER.pass);
    assert.equal(pass.card, null);
    assert.deepEqual(pass.entitlements, []);
    assert.deepEqual(pass.privileges, []);
    assert.ok(pass.included.some((view) => view.partner_id === 'opera-caffe'),
      'and the stay still includes what it always included');
  }
});

test('F · the Opera Caffè benefit never moves to the paid side, at any state', () => {
  for (const now of [BEFORE, DURING, AFTER]) {
    for (const held of [null, card()]) {
      const pass = passFor(stay(), { card: held, now });
      assert.ok(pass.included.some((view) => view.partner_id === 'opera-caffe'));
      assert.equal(pass.privileges.some((view) => view.partner_id === 'opera-caffe'), false);
    }
  }
  assert.ok(stayBenefits().some((view) => view.partner_id === 'opera-caffe'));
});

/* ── The matrix, as a matrix ─────────────────────────────────────────────── */

test('tier and state are independent, and all four combinations are reachable', () => {
  const seen = new Map();
  for (const [when, reservation] of [
    [BEFORE, stay()], [DURING, stay()], [AFTER, stay()],
    [DURING, stay({ status: RESERVATION_STATUS.cancelled })],
  ]) {
    for (const held of [null, card()]) {
      const pass = passFor(reservation, { card: held, now: when });
      seen.set(`${pass.tier}+${pass.state}`, pass);
    }
  }

  for (const key of [
    'pass+not-started', 'privilege+not-started',
    'pass+active', 'privilege+active',
    'pass+expired', 'privilege+expired',
    'pass+cancelled', 'privilege+cancelled',
  ]) {
    assert.ok(seen.has(key), `${key} is not reachable`);
  }

  // The one inference that must never be made.
  assert.equal(seen.get('privilege+not-started').tier, PASS_TIER.privilege,
    'a Pass is not demoted to standard because the stay has not started');
  assert.equal(seen.get('privilege+expired').tier, PASS_TIER.privilege,
    'nor because it is over');
});

test('the card screen is reachable from every Pass that owns one, and no other', () => {
  for (const when of [BEFORE, DURING, AFTER]) {
    assert.ok(passFor(stay(), { card: card(), now: when }).card,
      'an owned card is always openable, whatever the clock says');
    assert.equal(passFor(stay(), { now: when }).card, null);
  }
});
