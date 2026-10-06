/**
 * Partners, entitlements and who can use what.
 *
 * These are the tests that stop the two expensive mistakes.
 *
 * The first is commercial: letting a benefit a guest paid for leak to a guest who
 * did not, or — worse the other way — listing something the stay already includes
 * as a reason to buy the upgrade. The Opera Caffè 30% is free for everybody, Le
 * Firme and Blue Velvet are not, and nothing may blur that line.
 *
 * The second is structural: deciding eligibility twice. `passState()` in
 * `server/pass.js` is the only thing in this codebase that knows what day it is in
 * Florence. A second date engine would drift from it, and the drift would be silent
 * until a guest was turned away at a door.
 *
 * The last block is about a product that does not exist. The Shopping add-on is
 * modelled and deliberately not for sale, and the test asserts both halves: that
 * moving a partner behind it would be a data change, and that nothing today sells
 * it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PARTNERS, PARTNER_CATEGORIES, BENEFIT_KINDS,
  ENTITLEMENTS, ENTITLEMENT_NAMES, ENTITLEMENTS_ON_SALE, PASS_STATES, ACCESS,
  STAY_ELIGIBILITY, PRIVILEGE_ELIGIBILITY,
  activePartners, cardPartners, stayPartners, partnersRequiring,
  eligibilityOf, entitlementsRequiredBy, inclusionOf, benefitAccess,
  partnerView, cardBenefits, stayBenefits, directionsUrl, applyPartners, passContextOf,
} from '../commerce/partners.js';
import { PASS_STATE, entitlementsOf, passFor, passState } from '../server/pass.js';
import { PRICES } from '../commerce/prices.js';
import { PRODUCTS } from '../commerce/catalog.js';
import { isPurchasable } from '../commerce/index.js';
import { privilegeSection, stayBenefitsSection, accessFor } from '../src/commerce/ui/partners.js';
import { UI } from '../src/i18n.js';

const byId = (id) => PARTNERS.find((partner) => partner.partner_id === id);
const benefitById = (id) => PARTNERS.flatMap((p) => p.benefits ?? []).find((b) => b.benefit_id === id);

/** The two Pass shapes every eligibility question is asked about. */
const standardPass = (state = 'active') => ({ state, entitlements: [] });
const privilegePass = (state = 'active') => ({ state, entitlements: [ENTITLEMENTS.privilege] });

/* ── The data model ──────────────────────────────────────────────────────── */

test('every partner id is unique', () => {
  const ids = PARTNERS.map((partner) => partner.partner_id);
  assert.equal(new Set(ids).size, ids.length, 'two partners cannot share an id');
  assert.ok(ids.every(Boolean), 'and none may be missing one');
});

test('every benefit id is unique across the whole register', () => {
  const ids = PARTNERS.flatMap((partner) => (partner.benefits ?? []).map((b) => b.benefit_id));
  assert.equal(new Set(ids).size, ids.length, 'a benefit id identifies one benefit, everywhere');
  assert.ok(ids.every(Boolean));
});

test('every partner states its eligibility rather than inheriting a default', () => {
  // The default is deliberately the paid tier, so a record that forgets this locks
  // rather than gives itself away. Nothing in the register may rely on it.
  for (const partner of PARTNERS) {
    // A business with no benefit has nothing to be eligible for, and must not
    // pretend otherwise by carrying a rule.
    if (!partner.benefits?.length) {
      assert.equal(partner.eligibility, undefined, `${partner.partner_id} promises nothing yet`);
      continue;
    }
    assert.ok(partner.eligibility, `${partner.partner_id} states no eligibility rule`);
  }
  assert.deepEqual(eligibilityOf({}), PRIVILEGE_ELIGIBILITY, 'and the fallback fails closed');
  assert.deepEqual(eligibilityOf({ eligibility: STAY_ELIGIBILITY }), STAY_ELIGIBILITY);
});

test('every eligibility rule is in the schema, and names only known entitlements', () => {
  for (const partner of PARTNERS) {
    for (const benefit of partner.benefits ?? []) {
      const rule = eligibilityOf(partner, benefit);
      assert.ok(PASS_STATES.includes(rule.passState),
        `${benefit.benefit_id} asks for an unknown Pass state: ${rule.passState}`);
      assert.ok(Array.isArray(rule.entitlementsAll));
      for (const name of rule.entitlementsAll) {
        assert.ok(ENTITLEMENT_NAMES.includes(name),
          `${benefit.benefit_id} asks for an entitlement that does not exist: ${name}`);
      }
    }
  }
});

test('the Pass states eligibility can ask for are the ones the Pass actually has', () => {
  // Two lists, because this module is shared with the browser and must not import
  // the server. They are allowed to be two lists; they are not allowed to differ.
  assert.deepEqual([...PASS_STATES].sort(), Object.values(PASS_STATE).sort());
});

test('a partner offering directions has an address to send a guest to', () => {
  for (const partner of PARTNERS) {
    if (!partner.directions) continue;
    assert.ok(partner.address, `${partner.partner_id} offers directions with no address`);
    const url = directionsUrl(partner);
    assert.ok(url.startsWith('https://www.google.com/maps/dir/'), url);
    assert.ok(url.includes(encodeURIComponent(partner.address)),
      'the destination is the address and nothing invented');
  }
  assert.equal(directionsUrl({ address: 'Somewhere' }), null, 'and it is opt-in');
  assert.equal(directionsUrl({ directions: true }), null, 'never a link to nowhere');
});

test('the model carries one partner with many benefits, not many partners with one', () => {
  const blueVelvet = byId('blue-velvet');
  assert.ok(blueVelvet.benefits.length > 1, 'Blue Velvet is the proof');
  assert.equal(byId('le-firme').benefits.length, 1, 'and one is still a list');
  for (const partner of PARTNERS) {
    assert.ok(Array.isArray(partner.benefits), `${partner.partner_id} keeps its benefits as a list`);
  }
});

test('Blue Velvet is one venue, with one address, however many doors it has', () => {
  const matching = PARTNERS.filter((partner) => /blue\s*velvet/i.test(partner.name));
  assert.equal(matching.length, 1, 'two adjacent entrances are not two clubs');

  const view = partnerView('blue-velvet');
  assert.equal(view.address, 'Via del Castello d\'Altafronte 14R–16R, Firenze');
  assert.equal(view.benefits.length, 2);
  assert.equal(new Set([view.directions_url]).size, 1, 'and one place to be sent to');
  // Both numbers on one line, which is what gets a guest to the door. Which of the
  // two is open tonight is operational, lives in `staff_note`, and stays there.
  assert.ok(view.address.includes('14R') && view.address.includes('16R'));
  assert.equal('note' in view, false, 'a partner has no guest-facing note of its own');
});

test('Le Firme gives ten per cent, in both languages', () => {
  const partner = byId('le-firme');
  assert.equal(partner.category, 'shopping');
  assert.ok(PARTNER_CATEGORIES.shopping, 'and shopping is a category the model knows');
  assert.equal(partner.address, 'Via Il Prato 49R, Firenze');
  assert.equal(partner.area.it, 'Porta al Prato');

  const [benefit] = partner.benefits;
  assert.equal(benefit.kind, 'percentage');
  assert.equal(benefit.value, 10);
  assert.equal(benefit.emphasis, '10% OFF');
  assert.equal(benefit.headline.it, '10% di sconto');
  assert.equal(benefit.headline.en, '10% off');
  assert.equal(benefit.subline.it, 'Moda e shopping a Porta al Prato.');
  assert.equal(benefit.subline.en, 'Fashion and shopping near Porta al Prato.');
});

test('the Blue Velvet entry is a capped price with a drink, at any hour', () => {
  const benefit = benefitById('blue-velvet-entry');
  assert.equal(benefit.kind, 'guestlist');
  assert.deepEqual(benefit.cap, { amount: 1500, per: 'person' }, 'a ceiling, in eurocents');
  assert.equal(benefit.emphasis, '€15 MAX + DRINK');
  assert.equal(benefit.description.it,
    'Ingresso in lista a massimo €15 a persona, con una consumazione inclusa, a qualsiasi ora della serata.');
  assert.equal(benefit.description.en,
    'Guest-list entry for no more than €15 per person, with one drink included, at any time of the night.');
  assert.equal(benefit.subline.en, 'All night · LunArt Privilege');
});

test('the Blue Velvet table discount is a second, separate benefit', () => {
  const benefit = benefitById('blue-velvet-tables');
  assert.notEqual(benefit, benefitById('blue-velvet-entry'));
  assert.equal(benefit.kind, 'percentage');
  assert.equal(benefit.value, 20);
  assert.equal(benefit.emphasis, '20% OFF');
  assert.equal(benefit.description.it, '20% di sconto su tavoli / bottle service.');
  assert.equal(benefit.description.en, '20% off table / bottle service.');
  assert.equal(benefit.subline.en, 'Table service');

  // Not collapsed into the entry's sentence, which is the mistake being guarded.
  assert.equal(/20\s*%/.test(benefitById('blue-velvet-entry').description.it), false);
});

test('both new partners are reserved for Privilege, and neither comes with the stay', () => {
  for (const id of ['le-firme', 'blue-velvet']) {
    const partner = byId(id);
    assert.deepEqual(entitlementsRequiredBy(partner), [ENTITLEMENTS.privilege], id);
    assert.equal(inclusionOf(partner), 'card', id);
    assert.equal(stayPartners().some((p) => p.partner_id === id), false,
      `${id} must never be listed as included with the stay`);
  }
  assert.deepEqual(cardPartners().map((p) => p.partner_id), ['le-firme', 'blue-velvet']);
});

test('nothing invents a fact a partner did not give', () => {
  for (const id of ['le-firme', 'blue-velvet']) {
    const view = partnerView(id);
    const text = JSON.stringify(view);
    assert.equal(view.maps, null, 'no map link was supplied for these two');
    assert.equal(/tel:|telefono|phone|whatsapp|https?:\/\/(?!www\.google\.com\/maps)/i.test(text), false,
      `${id} carries a contact or a website that nobody gave us`);
    assert.equal(/prenota|booking|reserve a table/i.test(text), false,
      `${id} offers a booking flow that does not exist`);
  }
});

/* ── Eligibility ─────────────────────────────────────────────────────────── */

test('an active standard Pass keeps Opera Caffè and finds Privilege locked', () => {
  const pass = standardPass('active');

  const opera = partnerView('opera-caffe');
  assert.equal(accessFor(opera, pass)[0].access.state, ACCESS.available,
    'what comes with the stay is usable with no upgrade at all');

  for (const view of cardBenefits()) {
    for (const row of accessFor(view, pass)) {
      assert.equal(row.access.state, ACCESS.locked, `${view.partner_id}/${row.benefit.benefit_id}`);
      assert.deepEqual(row.access.missing, [ENTITLEMENTS.privilege]);
    }
  }
});

test('an active Privilege Pass unlocks all three', () => {
  const pass = privilegePass('active');
  const everything = [...stayBenefits(), ...cardBenefits()];
  assert.equal(everything.length, 3, 'Opera Caffè, Le Firme, Blue Velvet');

  for (const view of everything) {
    for (const row of accessFor(view, pass)) {
      assert.equal(row.access.state, ACCESS.available, `${view.partner_id}/${row.benefit.benefit_id}`);
      assert.deepEqual(row.access.missing, []);
    }
  }
});

test('a Pass that has not started, has ended or was called off makes nothing usable', () => {
  for (const state of ['not-started', 'expired', 'cancelled', 'unknown']) {
    for (const pass of [standardPass(state), privilegePass(state)]) {
      for (const view of [...stayBenefits(), ...cardBenefits()]) {
        for (const row of accessFor(view, pass)) {
          assert.equal(row.access.state, ACCESS.unavailable,
            `${state}: ${view.partner_id}/${row.benefit.benefit_id} must not read as usable`);
        }
      }
    }
  }
});

test('eligibility is the Pass state and the entitlement, never one or the other', () => {
  const access = (rule, pass) => benefitAccess(rule, passContextOf(pass)).state;

  // A live Pass with nothing bought is not enough.
  assert.equal(access(PRIVILEGE_ELIGIBILITY, standardPass('active')), ACCESS.locked);
  // And an entitlement on a Pass that is not live is not enough either.
  assert.equal(access(PRIVILEGE_ELIGIBILITY, privilegePass('expired')), ACCESS.unavailable);
  // Both: usable.
  assert.equal(access(PRIVILEGE_ELIGIBILITY, privilegePass('active')), ACCESS.available);
  // The stay's own rule needs no entitlement, only a live Pass.
  assert.equal(access(STAY_ELIGIBILITY, standardPass('active')), ACCESS.available);
  assert.equal(access(STAY_ELIGIBILITY, standardPass('expired')), ACCESS.unavailable);
  // A rule asking for something that does not exist fails closed.
  assert.equal(access({ passState: 'active', entitlementsAll: ['not-a-thing'] }, privilegePass('active')),
    ACCESS.locked);
  // And a Pass nobody handed over is nothing, not everything.
  assert.equal(benefitAccess(PRIVILEGE_ELIGIBILITY, passContextOf(null)).state, ACCESS.unavailable);
  assert.equal(benefitAccess(PRIVILEGE_ELIGIBILITY).state, ACCESS.unavailable);
});

test('the entitlements come from the card, and a revoked card carries none', () => {
  assert.deepEqual(entitlementsOf(null), [], 'a Pass nobody upgraded');
  assert.deepEqual(entitlementsOf({ status: 'active' }), [ENTITLEMENTS.privilege]);
  assert.deepEqual(entitlementsOf({ status: 'revoked' }), [], 'withdrawn is withdrawn');
});

test('the Pass publishes its entitlements, and its state still comes from the stay', () => {
  const reservation = { first_name: 'Ada', check_in: '2026-11-10', check_out: '2026-11-14', room: '303' };
  const during = new Date('2026-11-11T12:00:00Z');

  const plain = passFor(reservation, { now: during });
  assert.deepEqual(plain.entitlements, []);
  assert.deepEqual(plain.privileges, [], 'a standard Pass is never told it has privileges');
  assert.ok(plain.included.some((view) => view.partner_id === 'opera-caffe'));

  const upgraded = passFor(reservation, { card: { status: 'active' }, now: during });
  assert.deepEqual(upgraded.entitlements, [ENTITLEMENTS.privilege]);
  assert.equal(upgraded.privileges.length, 2);
  assert.ok(upgraded.included.some((view) => view.partner_id === 'opera-caffe'),
    'and Opera Caffè stays on the stay side of the line');

  // The state is the stay's, not the card's: one date engine, and this is it.
  assert.equal(plain.state, passState(reservation, during));
  assert.equal(passFor(reservation, { card: { status: 'active' }, now: new Date('2026-12-01T12:00:00Z') }).state,
    PASS_STATE.expired);
});

/* ── The Shopping add-on: modelled, not sold ─────────────────────────────── */

test('the model can express an add-on entitlement without any rendering change', () => {
  const future = {
    ...byId('le-firme'),
    partner_id: 'future-shop',
    eligibility: { passState: 'active', entitlementsAll: [ENTITLEMENTS.privilege, ENTITLEMENTS.shopping] },
  };

  assert.deepEqual(entitlementsRequiredBy(future), [ENTITLEMENTS.privilege, ENTITLEMENTS.shopping]);
  assert.equal(inclusionOf(future), 'card', 'still the paid card, now with more on it');

  // Privilege alone locks it and says exactly what is missing.
  const onlyPrivilege = benefitAccess(future.eligibility, passContextOf(privilegePass('active')));
  assert.equal(onlyPrivilege.state, ACCESS.locked);
  assert.deepEqual(onlyPrivilege.missing, [ENTITLEMENTS.shopping]);

  // Both unlock it.
  assert.equal(
    benefitAccess(future.eligibility,
      passContextOf({ state: 'active', entitlements: ['privilege', 'shopping'] })).state,
    ACCESS.available,
  );

  // And the same renderer draws it: no component per entitlement.
  try {
    applyPartners([...PARTNERS, { ...future, active: true }]);
    const html = privilegeSection(cardBenefits(), { state: 'active', entitlements: ['privilege', 'shopping'] }, 'it');
    assert.ok(html.includes('data-partner="future-shop"'));
    assert.equal(html.includes('data-access="locked"'), false);
  } finally {
    applyPartners(PARTNERS);
  }
});

test('a card can carry an add-on, and nothing writes one today', () => {
  assert.deepEqual(entitlementsOf({ status: 'active', add_ons: [ENTITLEMENTS.shopping] }),
    [ENTITLEMENTS.privilege, ENTITLEMENTS.shopping], 'the seam exists');
  assert.deepEqual(entitlementsOf({ status: 'active' }), [ENTITLEMENTS.privilege], 'and is empty');
});

test('Shopping is not on sale: no entitlement to buy, no product, no SKU, no price', () => {
  assert.deepEqual(ENTITLEMENTS_ON_SALE, [ENTITLEMENTS.privilege]);
  assert.equal(ENTITLEMENTS_ON_SALE.includes(ENTITLEMENTS.shopping), false);

  for (const product of PRODUCTS) {
    assert.equal(/shopping/i.test(product.id), false, `${product.id} looks like the add-on`);
  }
  for (const sku of Object.keys(PRICES)) {
    assert.equal(/shopping/i.test(sku), false, `${sku} prices something that is not for sale`);
  }
  assert.equal(partnersRequiring(ENTITLEMENTS.shopping).length, 0,
    'and no partner has been moved behind it');
});

test('Privilege still costs what it costs', () => {
  assert.equal(PRICES['privilege-card:2d'].amount, 1500);
  assert.equal(PRICES['privilege-card:5d'].amount, 2500);
  assert.equal(PRICES['privilege-card:8d'].amount, 3500);
  for (const days of ['2d', '5d', '8d']) {
    assert.equal(PRICES[`privilege-card:${days}`].status, 'confirmed');
  }
});

test('the Privilege product is purchasable now that real partners stand behind it', () => {
  const card = PRODUCTS.find((product) => product.id === 'privilege-card');
  assert.equal(card.requiresPartners, true, 'the rail is still there');
  assert.equal(isPurchasable(card), true, 'and it passes without placeholder prices');
});

/* ── Copy ────────────────────────────────────────────────────────────────── */

test('every piece of partner copy exists in both languages', () => {
  for (const partner of PARTNERS) {
    for (const field of ['area', 'note', 'shortDescription']) {
      if (!partner[field]) continue;
      assert.ok(partner[field].it, `${partner.partner_id}.${field} it`);
      assert.ok(partner[field].en, `${partner.partner_id}.${field} en`);
    }
    for (const benefit of partner.benefits ?? []) {
      for (const field of ['headline', 'subline', 'description', 'note']) {
        if (!benefit[field]) continue;
        assert.ok(benefit[field].it?.trim(), `${benefit.benefit_id}.${field} it`);
        assert.ok(benefit[field].en?.trim(), `${benefit.benefit_id}.${field} en`);
      }
    }
  }
  for (const category of Object.values(PARTNER_CATEGORIES)) {
    assert.ok(category.it && category.en);
  }
});

test('the Privilege section has its own words, in both languages', () => {
  const keys = [
    'privilegeBenefits', 'privilegeBenefitsNote', 'privilegeBenefitsDiscover',
    'privilegeLocked', 'privilegeGet', 'privilegeWhenActive', 'directions',
  ];
  for (const key of keys) {
    assert.ok(UI.it[key]?.trim(), `it.${key}`);
    assert.ok(UI.en[key]?.trim(), `en.${key}`);
    assert.notEqual(UI.it[key], UI.en[key], `${key} is not the same string twice`);
  }
  assert.equal(UI.it.privilegeBenefits, 'Vantaggi Privilege');
  assert.equal(UI.en.privilegeBenefits, 'Privilege benefits');
  assert.equal(UI.it.privilegeBenefitsNote,
    'Mostra la tua LunArt Privilege attiva per utilizzare questi vantaggi.');
  assert.equal(UI.en.privilegeBenefitsNote,
    'Show your active LunArt Privilege to use these benefits.');
  assert.equal(UI.it.privilegeLocked, 'Disponibile con LunArt Privilege');
  assert.equal(UI.en.privilegeLocked, 'Available with LunArt Privilege');
});

/* ── What each guest sees ────────────────────────────────────────────────── */

test('a Privilege guest sees the benefits unlocked, and is told once how to use them', () => {
  for (const lang of ['it', 'en']) {
    const html = privilegeSection(cardBenefits(), privilegePass('active'), lang);
    assert.ok(html.includes(UI[lang].privilegeBenefits), 'the section is there');
    assert.ok(html.includes(UI[lang].privilegeBenefitsNote), 'with the one explanation');
    assert.equal(html.includes(UI[lang].privilegeLocked), false, 'and nothing locked');
    assert.equal(html.includes('data-product="privilege-card"'), false, 'and nothing to buy again');

    // Said once, not once per venue.
    const saidTwice = html.split(UI[lang].privilegeBenefitsNote).length - 1;
    assert.equal(saidTwice, 1, 'the "show your card" sentence appears exactly once');
  }
});

test('a standard-Pass guest discovers the same benefits, locked', () => {
  for (const lang of ['it', 'en']) {
    const html = privilegeSection(cardBenefits(), standardPass('active'), lang);
    assert.ok(html.includes('Le Firme') && html.includes('Blue Velvet'),
      'they are shown, not hidden');
    assert.ok(html.includes(UI[lang].privilegeLocked), 'and marked as an upgrade');
    assert.ok(html.includes(UI[lang].privilegeBenefitsDiscover));
    assert.equal(html.split('data-access="locked"').length - 1 >= 2, true);

    // The way to get it is the ordinary product sheet, not a second checkout.
    assert.ok(html.includes('data-product="privilege-card"'));
    assert.ok(html.includes(UI[lang].privilegeGet));
  }
});

test('the benefit is what the eye lands on, and the venue is the quiet line', () => {
  const html = privilegeSection(cardBenefits(), privilegePass('active'), 'it');
  for (const headline of ['10% di sconto', '€15 MAX + DRINK', '20% OFF']) {
    assert.ok(html.includes(`<p class="benefit__headline">${headline}</p>`), headline);
  }
  assert.ok(html.includes('<p class="partner__name">Le Firme</p>'));
  assert.ok(html.includes('<p class="partner__name">Blue Velvet</p>'));
});

test('Blue Velvet renders as one venue with two benefits and one set of directions', () => {
  const html = privilegeSection(cardBenefits(), privilegePass('active'), 'it');
  const [, after] = html.split('data-partner="blue-velvet"');
  assert.equal(html.split('data-partner="blue-velvet"').length - 1, 1, 'one venue block');
  assert.equal(after.split('class="benefit"').length - 1, 2, 'two benefits inside it');
  assert.equal(after.split('class="partner__directions"').length - 1, 1, 'one way to get there');
  assert.ok(after.includes('maps/dir/?api=1&amp;destination=Via%20del%20Castello'));
});

/**
 * Not usable is said to everybody; what to do about it depends on who is asking.
 *
 * A Pass that is not live makes nothing claimable, whether or not the upgrade was
 * bought — so neither guest is ever shown the "show your card" line. What differs
 * is the sentence and the button: an owner is told when their benefits start, and a
 * guest who has not upgraded is told what Privilege is and offered it, as long as
 * the stay still has a future. `test/privilege-card.test.mjs` holds that matrix in
 * full; this is the half of it the partner section is responsible for.
 */
test('a Pass that is not live never reads as usable, whoever owns it', () => {
  for (const state of ['not-started', 'expired', 'cancelled']) {
    for (const pass of [standardPass(state), privilegePass(state)]) {
      const html = privilegeSection(cardBenefits(), pass, 'it');
      assert.equal(html.includes(UI.it.privilegeBenefitsNote), false,
        `${state}: nothing may read as usable today`);
      assert.equal(html.split('class="partner" data-access="unavailable"').length - 1, 2, state);
    }
  }
});

test('an owner is told when their benefits start; everyone else is told what they are', () => {
  for (const state of ['not-started', 'expired', 'cancelled']) {
    const owner = privilegeSection(cardBenefits(), privilegePass(state), 'it');
    assert.ok(owner.includes(UI.it.privilegeWhenActive), state);
    assert.equal(owner.includes('data-product='), false, 'and never sold it twice');

    const guest = privilegeSection(cardBenefits(), standardPass(state), 'it');
    assert.ok(guest.includes(UI.it.privilegeBenefitsDiscover), state);
  }
});

test('the upgrade is offered while the stay has a future, and not afterwards', () => {
  // Buying before arrival is legitimate: the card is sold inside the stay and its
  // start dates are the stay's own.
  for (const state of ['not-started', 'active']) {
    assert.ok(privilegeSection(cardBenefits(), standardPass(state), 'it').includes('data-product='), state);
  }
  // A stay that is over, or was called off, has nothing left to buy an upgrade for.
  for (const state of ['expired', 'cancelled']) {
    assert.equal(
      privilegeSection(cardBenefits(), standardPass(state), 'it').includes('data-product='),
      false,
      state,
    );
  }
});

test('Opera Caffè is never drawn inside the Privilege section', () => {
  for (const pass of [standardPass('active'), privilegePass('active')]) {
    assert.equal(privilegeSection(cardBenefits(), pass, 'it').includes('Opera'), false);
    assert.ok(stayBenefitsSection(stayBenefits(), pass, 'it').includes('Opera Caffè'));
  }
});

test('the public guide lists what the stay includes without judging a Pass', () => {
  // No Pass at all: this is information, not an entitlement, so nothing is dimmed.
  const html = stayBenefitsSection(stayBenefits(), null, 'it');
  assert.ok(html.includes('Opera Caffè'));
  assert.equal(html.includes('data-access="unavailable"'), false);
  assert.equal(html.includes('data-access="locked"'), false);
});

test('an empty register draws nothing rather than an empty heading', () => {
  assert.equal(privilegeSection([], privilegePass('active'), 'it'), '');
  assert.equal(stayBenefitsSection([], null, 'it'), '');
});
