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
import {
  ENTITLEMENTS, INTERNAL_PARTNER_FIELDS, PARTNERS, cardBenefits, stayBenefits,
  partnerView, activePartners, publicPartner, publicPartners,
} from '../commerce/partners.js';
import { privilegeSection, stayBenefitsSection, partnerCard } from '../src/commerce/ui/partners.js';
import { passNote, passPreview } from '../src/commerce/ui/pass.js';
import { cardBenefitsBlock } from '../src/commerce/ui/card-sheet.js';
import { fill } from '../src/i18n.js';
import { longDate } from '../src/commerce/ui/format.js';
import { esc } from '../src/ui/dom.js';
import { readFile } from 'node:fs/promises';
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
/** A Pass-shaped context built by hand, stating ownership and liveness explicitly. */
const held = (state, { live = true } = {}) => ({
  state,
  entitlements: [ENTITLEMENTS.privilege],
  live_entitlements: live ? [ENTITLEMENTS.privilege] : [],
});
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

  /**
   * Nothing resembling a code travels with a Pass, at any state.
   *
   * By the keys, not by searching the text. The first version of this grepped the
   * serialised card for "qr", "code", "secret" and friends — and `access_token` is
   * a random base64url string, so about three runs in a hundred it contained one
   * of those by pure chance and the suite failed for no reason. A fixed key list is
   * stricter anyway: a field nobody thought about fails it too.
   */
  assert.deepEqual(Object.keys(pass.card).sort(),
    ['access_token', 'end_date', 'reference', 'start_date', 'state']);
  for (const key of Object.keys(pass.card)) {
    assert.equal(/qr|code|window|signing|secret/i.test(key), false, `the Pass carries "${key}"`);
  }
});

test('B · a guest who already paid is never asked to buy it again', () => {
  for (const lang of ['it', 'en']) {
    const html = section(held('not-started', { live: false }), lang);

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

  const html = section(pass);
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

  const html = section(pass);
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

/* ── A stay longer than the Privilege bought for it ──────────────────────── */

/**
 * The case that is easy to get wrong, and was.
 *
 * Privilege is sold by the day — two, five or eight — and a stay can be longer than
 * the card bought for it. Book 1–6 November, buy two days starting on the 3rd, and
 * one booking contains three different answers:
 *
 *   1–2 Nov   stay under way, Privilege owned, card not started. Not usable.
 *   3–4 Nov   card running. Usable.
 *   5–6 Nov   stay still under way, card over. Not usable again.
 *
 * Before this, eligibility asked only whether the Pass was live and whether the
 * entitlement was owned, so all six days read as usable. The guest would have been
 * sent to Le Firme on the 1st and turned away — and the venue would have been right
 * to turn them away, because `validateCode` has always checked the card's own state
 * at the door. The screen was the thing that was lying.
 */
const LONG_STAY = () => stay({ check_in: '2026-11-01', check_out: '2026-11-06' });
const TWO_DAYS = () => card({ ...buildCard({
  orderId: 'order_short', reservationId: 'res_pc', holderName: 'Irene Rossi',
  startDate: '2026-11-03', days: 2, variantId: '2d', signingKey: KEY,
}) });

const at = (iso) => new Date(`${iso}T20:00:00Z`);

test('A · a live stay whose Privilege has not started yet owns it and cannot use it', () => {
  const pass = passFor(LONG_STAY(), { card: TWO_DAYS(), now: at('2026-11-01') });

  // Ownership, untouched: the gold card, the card screen, no second sale.
  assert.equal(pass.tier, PASS_TIER.privilege);
  assert.equal(pass.state, PASS_STATE.active, 'the stay itself is under way');
  assert.deepEqual(pass.entitlements, [ENTITLEMENTS.privilege]);
  assert.ok(pass.card, 'and the card she paid for is still reachable');
  assert.equal(pass.card.state, 'not-started');

  // Usability, correctly withheld.
  assert.deepEqual(pass.live_entitlements, [], 'nothing is in force today');
  const html = section(pass);
  assert.equal(venues(html, 'available'), 0, 'no partner benefit may read as usable');
  assert.equal(venues(html, 'unavailable'), 2);
  assert.equal(count(html, 'partner__lock'), 0, 'owned, so never marked as an upgrade');
  assert.equal(count(html, 'data-product='), 0, 'and never offered again');
});

test('A · and is told about the card, not about the stay it is already inside', () => {
  const pass = passFor(LONG_STAY(), { card: TWO_DAYS(), now: at('2026-11-01') });
  const html = section(pass);

  assert.ok(html.includes(UI.it.privilegeWhenCardActive), html.slice(0, 0));
  assert.equal(html.includes(UI.it.privilegeWhenActive), false,
    'she is in Florence with a live Pass: that condition is already met');
  assert.equal(html.includes(UI.it.privilegeBenefitsNote), false);
});

test('B · on the days the card runs, everything is usable', () => {
  for (const day of ['2026-11-03', '2026-11-04']) {
    const pass = passFor(LONG_STAY(), { card: TWO_DAYS(), now: at(day) });
    assert.equal(pass.card.state, 'active', day);
    assert.deepEqual(pass.live_entitlements, [ENTITLEMENTS.privilege], day);

    const html = section(pass);
    assert.equal(venues(html, 'available'), 2, day);
    assert.ok(html.includes(UI.it.privilegeBenefitsNote), day);
    assert.equal(count(html, 'data-product='), 0, day);
  }
});

test('C · once the card is over the stay goes on and the benefits do not', () => {
  for (const day of ['2026-11-05', '2026-11-06']) {
    const pass = passFor(LONG_STAY(), { card: TWO_DAYS(), now: at(day) });

    assert.equal(pass.state, PASS_STATE.active, `${day}: the stay is still running`);
    assert.equal(pass.card.state, 'expired');
    assert.equal(pass.tier, PASS_TIER.privilege, 'it was still bought');
    assert.deepEqual(pass.entitlements, [ENTITLEMENTS.privilege], 'and is still owned');
    assert.deepEqual(pass.live_entitlements, [], 'and is over');

    const html = section(pass);
    assert.equal(venues(html, 'available'), 0, `${day}: nothing may read as usable`);
    assert.equal(count(html, 'data-product='), 0,
      'a card that has run its course is not a reason to sell another');
    assert.ok(html.includes(UI.it.privilegeWhenCardActive), day);
  }
});

test('D · a standard guest on the same stay is unaffected: locked, and buyable', () => {
  const pass = passFor(LONG_STAY(), { now: at('2026-11-01') });

  assert.equal(pass.tier, PASS_TIER.pass);
  assert.deepEqual(pass.entitlements, []);
  assert.deepEqual(pass.live_entitlements, []);

  const html = section(pass);
  assert.equal(count(html, 'partner__lock'), 2, 'marked as an upgrade');
  assert.equal(count(html, 'data-product="privilege-card"'), 1, 'and still buyable');
  assert.ok(html.includes(UI.it.privilegeBenefitsDiscover));
});

test('E · before the stay begins an owned card is owned and dormant', () => {
  const pass = passFor(LONG_STAY(), { card: TWO_DAYS(), now: at('2026-10-20') });

  assert.equal(pass.state, PASS_STATE.notStarted);
  assert.equal(pass.tier, PASS_TIER.privilege);
  assert.deepEqual(pass.entitlements, [ENTITLEMENTS.privilege]);
  assert.deepEqual(pass.live_entitlements, []);
  assert.ok(pass.card, 'and still openable');

  const html = section(pass);
  assert.equal(venues(html, 'unavailable'), 2);
  assert.equal(count(html, 'data-product='), 0);
  assert.ok(html.includes(UI.it.privilegeWhenActive),
    'here the stay is what has not started, and that is what it says');
});

test('what the stay includes is never gated on the card running', () => {
  // Opera Caffè asks for no entitlement, so it cannot be dormant. A guest whose
  // Privilege ran out on the 4th still gets their breakfast on the 6th.
  for (const day of ['2026-11-01', '2026-11-03', '2026-11-06']) {
    const pass = passFor(LONG_STAY(), { card: TWO_DAYS(), now: at(day) });
    const html = stayBenefitsSection(stayBenefits(), pass, 'it');
    assert.ok(html.includes('class="partner" data-access="available"'), day);
  }
});

test('the three states are ownership, the stay, and the card — and all three are published', () => {
  const pass = passFor(LONG_STAY(), { card: TWO_DAYS(), now: at('2026-11-01') });

  assert.equal(pass.tier, PASS_TIER.privilege, 'ownership');
  assert.equal(pass.state, PASS_STATE.active, 'the stay');
  assert.equal(pass.card.state, 'not-started', 'the card');

  // The pair a screen needs, always both present on a Pass the server built.
  assert.ok(Array.isArray(pass.entitlements) && Array.isArray(pass.live_entitlements),
    'a Pass states ownership and liveness, so no screen has to infer one from the other');
});

/* ── Owned is not usable, and the words have to say so ───────────────────── */

/**
 * The line on the home screen used to say the Privilege benefits were unlocked to
 * anybody holding a card, which for a guest who bought the upgrade weeks early was
 * flatly untrue — she had paid, and the one sentence on her home screen told her
 * she could walk into a club that would turn her away.
 */
test('the home says what is true of this card, not of the tier', () => {
  const before = passFor(LONG_STAY(), { card: TWO_DAYS(), now: at('2026-11-01') });
  const during = passFor(LONG_STAY(), { card: TWO_DAYS(), now: at('2026-11-03') });
  const after = passFor(LONG_STAY(), { card: TWO_DAYS(), now: at('2026-11-05') });
  const plain = passFor(LONG_STAY(), { now: at('2026-11-01') });

  for (const lang of ['it', 'en']) {
    assert.equal(passNote(before, lang),
      fill(UI[lang].passNotePrivilegeSoon, { date: longDate('2026-11-03', lang) }));
    assert.ok(passNote(before, lang).includes(longDate('2026-11-03', lang)),
      'with the card\'s own start date, not the stay\'s');
    assert.equal(passNote(before, lang).includes(UI[lang].passNotePrivilege), false,
      'and never "unlocked" before anything is');

    assert.equal(passNote(during, lang), UI[lang].passNotePrivilege, 'unlocked once it is');
    assert.equal(passNote(after, lang),
      fill(UI[lang].passNotePrivilegeOver, { date: longDate('2026-11-04', lang) }));
    assert.equal(passNote(plain, lang), UI[lang].passNote, 'and a standard Pass is untouched');
  }
});

/**
 * Inside the card, the same problem one level down: the QR was sealed and the
 * venues under it were not, so "10% di sconto" set large in the serif read as an
 * offer a guest could take up that evening.
 */
test('the card says when its benefits start, and stops saying it once they have', () => {
  const dormant = { state: 'not-started', start_date: '2026-11-03', end_date: '2026-11-04', benefits: cardBenefits() };
  const live = { ...dormant, state: 'active' };
  const over = { ...dormant, state: 'expired' };

  for (const lang of ['it', 'en']) {
    const soon = cardBenefitsBlock(dormant, lang);
    assert.ok(soon.includes(esc(fill(UI[lang].cardBenefitsFrom, { date: longDate('2026-11-03', lang) }))), lang);
    assert.equal(venues(soon, 'unavailable'), 2, 'and the venues are visibly not usable');
    assert.equal(count(soon, 'partner__lock'), 0, 'but never locked: they are hers');
    assert.equal(count(soon, 'data-product='), 0, 'and never sold to her twice');

    const running = cardBenefitsBlock(live, lang);
    assert.equal(count(running, 'data-benefits-when'), 0, 'nothing extra once the code is on screen');
    assert.equal(venues(running, 'available'), 2);

    const ended = cardBenefitsBlock(over, lang);
    assert.ok(ended.includes(esc(fill(UI[lang].cardBenefitsEnded, { date: longDate('2026-11-04', lang) }))), lang);
    assert.equal(venues(ended, 'unavailable'), 2, 'kept, as a record, and plainly over');
  }
});

/**
 * The two rows on the home, which had the same contradiction one screen up: the
 * paid benefit in full gold, two lines above a sentence saying it is not available
 * until Thursday.
 */
test('the paid row on the home dims with the card, and the stay row never does', () => {
  const rows = (now) => passPreview(passFor(LONG_STAY(), { card: TWO_DAYS(), now }));

  for (const [label, now] of [['before', at('2026-11-01')], ['after', at('2026-11-05')]]) {
    const [paid, stay] = rows(now);
    assert.equal(paid.view.partner_id, 'le-firme', `${label}: what she bought leads`);
    assert.ok(paid.className.includes('pass__benefit--privilege'), `${label}: still marked as paid`);
    assert.ok(paid.className.includes('pass__benefit--dormant'), `${label}: and dimmed`);

    assert.equal(stay.view.partner_id, 'opera-caffe');
    assert.equal(stay.className, '', `${label}: the stay's own benefit is untouched by the card`);
  }

  const [live, stay] = rows(at('2026-11-03'));
  assert.ok(live.className.includes('pass__benefit--privilege'));
  assert.equal(live.className.includes('dormant'), false, 'full strength once the card runs');
  assert.equal(stay.className, '');
});

test('a standard Pass previews only what the stay includes, at full strength', () => {
  const rows = passPreview(passFor(LONG_STAY(), { now: at('2026-11-01') }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].view.partner_id, 'opera-caffe');
  assert.equal(rows[0].className, '', 'nothing to dim, and nothing to lock');
});

test('the dormant row is a softened gold rule, not a removed one', async () => {
  const css = await readFile(new URL('../assets/css/app.css', import.meta.url), 'utf8');

  assert.match(css, /\.pass__benefit--dormant \{ border-left-color: var\(--accent-soft\); \}/,
    'the gold identity stays, softened');
  assert.match(css, /\.pass__benefit--dormant \.pass__benefit-what \{ color: var\(--ink-soft\); \}/,
    'and the words read as the dormant venues inside the card do');
  // The layout is the border and the padding, and neither moves between states.
  assert.equal(/\.pass__benefit--dormant[^}]*(padding|margin|display)/.test(css), false,
    'only the colours change, so nothing shifts when the card starts');
});

/* ── Internal notes stay internal ────────────────────────────────────────── */

/**
 * Which of Blue Velvet's two doors is open tonight is LunArt's problem and the
 * club's. It was on the guest's screen, under a benefit, where a caveat competes
 * with the thing she is there to read — so it moved to `staff_note`, and this is
 * the test that stops it, or anything like it, coming back.
 *
 * It walks `INTERNAL_PARTNER_FIELDS` rather than naming a string, so a new internal
 * field is covered the moment it is declared.
 */
const internalStrings = () => {
  const out = [];
  const walk = (value) => {
    if (typeof value === 'string' && value.trim().length > 12) out.push(value.trim());
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  for (const partner of PARTNERS) {
    for (const field of INTERNAL_PARTNER_FIELDS) walk(partner[field]);
  }
  return out;
};

test('internal partner fields never reach the guest view', () => {
  const secrets = internalStrings();
  assert.ok(secrets.length >= 3, 'there is something to leak in the first place');

  for (const partner of activePartners()) {
    const view = JSON.stringify(partnerView(partner.partner_id, 'https://guide.example'));
    for (const field of [...INTERNAL_PARTNER_FIELDS, 'active', 'example']) {
      assert.equal(field in JSON.parse(view), false, `${partner.partner_id}.${field}`);
    }
    for (const secret of secrets) {
      assert.equal(view.includes(secret.slice(0, 40)), false,
        `${partner.partner_id} carries an internal line`);
    }
  }
});

/**
 * The second route, and the one that was open.
 *
 * `/api/catalog` publishes the register so the browser's selectors and the
 * server's run over one list, and it published the records whole. Nobody saw a
 * venue's negotiation notes on a screen; they were a view-source away on a public
 * endpoint.
 */
test('nor into the register the browser is handed', () => {
  const secrets = internalStrings();
  const published = JSON.stringify(publicPartners());

  for (const field of INTERNAL_PARTNER_FIELDS) {
    assert.equal(published.includes(`"${field}"`), false, `the wire carries ${field}`);
  }
  for (const secret of secrets) {
    assert.equal(published.includes(secret.slice(0, 40)), false, `leaked: ${secret.slice(0, 60)}…`);
  }

  // And it is still the register: same partners, and everything the selectors read.
  assert.deepEqual(publicPartners().map((p) => p.partner_id), activePartners().map((p) => p.partner_id));
  for (const partner of publicPartners()) {
    assert.equal(partner.active, true);
    assert.ok(partner.partnership_status, partner.partner_id);
    assert.ok(Array.isArray(partner.benefits), partner.partner_id);
    // A partnership that is agreed carries its rule; one being set up carries none.
    assert.equal(Boolean(partner.eligibility), partner.benefits.length > 0, partner.partner_id);
  }
  assert.ok(published.includes('14R–16R'), 'with the address, which is what finds the door');
  assert.equal(publicPartner({ partner_id: 'x', notes: 'secret', name: 'X' }).notes, undefined);
});

test('nor into any HTML a guest is drawn', () => {
  const secrets = internalStrings();
  const passes = [
    { state: 'active', entitlements: [], live_entitlements: [] },
    { state: 'active', entitlements: ['privilege'], live_entitlements: ['privilege'] },
    { state: 'active', entitlements: ['privilege'], live_entitlements: [] },
    { state: 'not-started', entitlements: ['privilege'], live_entitlements: [] },
    { state: 'expired', entitlements: ['privilege'], live_entitlements: [] },
    null,
  ];

  const surfaces = [];
  for (const lang of ['it', 'en']) {
    for (const pass of passes) {
      surfaces.push(privilegeSection(cardBenefits(), pass, lang));
      surfaces.push(stayBenefitsSection(stayBenefits(), pass, lang));
      for (const view of [...cardBenefits(), ...stayBenefits()]) {
        surfaces.push(partnerCard(view, pass, lang));
      }
    }
    for (const state of ['not-started', 'active', 'expired', 'revoked']) {
      surfaces.push(cardBenefitsBlock({
        state, start_date: '2026-11-03', end_date: '2026-11-04', benefits: cardBenefits(),
      }, lang));
    }
  }

  const html = surfaces.join('\n');
  assert.ok(html.includes('Blue Velvet') && html.includes('Le Firme'), 'the partners are drawn');
  assert.ok(html.includes('14R–16R'), 'and the address keeps both numbers, which is what finds the door');

  for (const secret of secrets) {
    assert.equal(html.includes(secret.slice(0, 40)), false, `leaked: ${secret.slice(0, 60)}…`);
  }
  // The one that was actually on screen, named so the failure is unmistakable.
  assert.equal(/ingressi adiacenti|adjacent entrances/.test(html), false,
    'the door note is operational and belongs nowhere near a guest');
  assert.equal(/listino|fino all.01:00/i.test(html), false,
    'and neither do the house prices behind a negotiation');
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
