/**
 * The network: who LunArt works with, and who it is still arranging to work with.
 *
 * Thirty-two businesses are published and three of them have an agreement. The
 * other twenty-nine are real places with real names that LunArt is talking to, and
 * the only honest thing to say about them is that there is nothing to claim yet —
 * so these tests are mostly about that nothing staying nothing.
 *
 * The hazard is not malice, it is convenience: a future selector that reaches for
 * `activePartners()` because it is the obvious one, and quietly puts a business
 * with no signed terms behind a Privilege card. `benefitPartners()` is the single
 * gate, and every claimable path is checked here to be standing behind it.
 *
 * The second hazard is the opposite of nothing: an invented percentage, a borrowed
 * address, somebody's phone number. A business being set up carries its name, what
 * it is, and where it is when that is certain. Nothing else.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

import {
  PARTNERS, PARTNERSHIP_STATUS, PARTNER_CATEGORIES, INTERNAL_PARTNER_FIELDS,
  statusOf, activePartners, benefitPartners, activatingPartners,
  cardPartners, stayPartners, cardBenefits, stayBenefits, allGuestBenefits,
  partnerNetwork, partnerView, publicPartners, applyPartners, partnersRequiring,
  ENTITLEMENTS, directionsUrl,
} from '../commerce/partners.js';
import { PRODUCTS } from '../commerce/catalog.js';
import { isPurchasable } from '../commerce/index.js';
import { createStore } from '../server/store.js';
import { buildCard, currentCode, validateCode, cardState } from '../server/card.js';
import { networkSection, privilegeSection } from '../src/commerce/ui/partners.js';
import { UI } from '../src/i18n.js';

const KEY = 'a-network-test-signing-key-that-never-leaves';
const byId = (id) => PARTNERS.find((p) => p.partner_id === id);
const count = (html, needle) => html.split(needle).length - 1;

/* ── The register ────────────────────────────────────────────────────────── */

test('three agreements, and a network being built around them', () => {
  assert.deepEqual(benefitPartners().map((p) => p.partner_id), ['opera-caffe', 'le-firme', 'blue-velvet']);
  assert.equal(activatingPartners().length, 29);
  assert.equal(activePartners().length, 32, 'all of them published');
});

test('partnership status is its own field, and not the publication flag', () => {
  for (const partner of PARTNERS) {
    assert.ok(['active', 'activating'].includes(statusOf(partner)), partner.partner_id);
  }
  // `active` still means published, and the example shapes are still not.
  assert.equal(PARTNERS.filter((p) => !p.active).every((p) => p.example), true);
  // An unmarked record is treated as having no agreement, which is the safe way
  // to be wrong about one.
  assert.equal(statusOf({}), PARTNERSHIP_STATUS.activating);
  assert.equal(statusOf(null), PARTNERSHIP_STATUS.activating);
});

test('every business being set up carries facts and promises nothing', () => {
  for (const partner of activatingPartners()) {
    assert.ok(partner.name?.trim(), partner.partner_id);
    assert.ok(Object.keys(PARTNER_CATEGORIES).includes(partner.category), partner.partner_id);
    assert.deepEqual(partner.benefits, [], `${partner.partner_id} carries a benefit`);
    assert.equal(partner.eligibility, undefined, `${partner.partner_id} carries an eligibility rule`);
    assert.equal(partner.logo, null, 'no official asset has been supplied for these yet');

    // Nothing that reads as a commercial term in anything a guest is shown. The
    // map link is excluded: its percent-encoding is full of `%` and says nothing.
    const view = partnerView(partner.partner_id);
    const words = JSON.stringify({ ...view, directions_url: null, maps: null });
    assert.equal(/\d\s*%|sconto|discount|gratis|omaggio|minimo|minimum/i.test(words), false,
      `${partner.partner_id} reads like an offer`);
  }
});

test('the ones excluded on purpose are not in the register', () => {
  // No "Buca" — which one it was is still being remembered, and the wrong Buca
  // is a different restaurant with somebody else's name on it.
  assert.equal(PARTNERS.some((p) => /buca/i.test(p.name)), false);
});

/* ── The firewall ────────────────────────────────────────────────────────── */

test('a business being set up cannot reach any claimable list', () => {
  const ids = new Set(activatingPartners().map((p) => p.partner_id));

  for (const [label, list] of [
    ['cardPartners', cardPartners()], ['stayPartners', stayPartners()],
  ]) {
    assert.equal(list.some((p) => ids.has(p.partner_id)), false, label);
  }
  for (const [label, views] of [
    ['cardBenefits', cardBenefits()], ['stayBenefits', stayBenefits()],
    ['allGuestBenefits', allGuestBenefits()],
  ]) {
    assert.equal(views.some((v) => ids.has(v.partner_id)), false, label);
    assert.ok(views.every((v) => v.partnership_status === PARTNERSHIP_STATUS.active), label);
  }
  assert.equal(partnersRequiring(ENTITLEMENTS.privilege).some((p) => ids.has(p.partner_id)), false);
});

test('and has no access state at all, because it has nothing to have one about', () => {
  for (const pass of [
    { state: 'active', entitlements: [], live_entitlements: [] },
    { state: 'active', entitlements: ['privilege'], live_entitlements: ['privilege'] },
  ]) {
    const html = privilegeSection(cardBenefits(), pass, 'it');
    for (const partner of activatingPartners()) {
      assert.equal(html.includes(`data-partner="${partner.partner_id}"`), false, partner.partner_id);
    }
  }
});

test('an active Privilege card validates at a real partner and nowhere else', async () => {
  const store = createStore();
  const card = await store.cards.create(buildCard({
    orderId: 'o', holderName: 'Ada', startDate: '2026-11-07', days: 2, variantId: '2d', signingKey: KEY,
  }));
  const now = new Date('2026-11-07T20:00:00Z');
  assert.equal(cardState(card, now), 'active');
  const { code } = currentCode(card, { signingKey: KEY, periodSeconds: 60, now });

  const real = await validateCode({
    reference: card.public_ref, code, store, signingKey: KEY, periodSeconds: 60, now,
    partnerId: 'blue-velvet',
  });
  assert.equal(real.valid, true);
  assert.equal(real.partner.partner, 'Blue Velvet');

  // The same live card, at a business with no agreement: no benefit comes back.
  const soon = await validateCode({
    reference: card.public_ref, code, store, signingKey: KEY, periodSeconds: 60, now,
    partnerId: 'la-petite',
  });
  assert.equal(soon.partner, null, 'a scanner is told of no benefit it could honour');
  assert.equal(soon.benefits.some((v) => v.partner_id === 'la-petite'), false);
  assert.ok(soon.benefits.every((v) => v.partnership_status === PARTNERSHIP_STATUS.active));
});

test('a register of nothing but businesses being set up does not make Privilege sellable', () => {
  const card = PRODUCTS.find((p) => p.id === 'privilege-card');
  const saved = PARTNERS.map((p) => ({ ...p }));
  try {
    // Twenty-nine venues, every one of them published and visible, and not one of
    // them an agreement. The rail must read this as an empty shelf.
    applyPartners(saved.filter((p) => statusOf(p) === PARTNERSHIP_STATUS.activating));
    assert.equal(activePartners().length, 29, 'they are all still published');
    assert.equal(cardPartners().length, 0, 'and none of them is a reason to sell anything');
    assert.equal(isPurchasable(card, { allowPlaceholders: true }), false);

    // Opera Caffè alone is not either: it is a stay benefit, not a card one.
    applyPartners(saved.filter((p) => p.partner_id === 'opera-caffe'));
    assert.equal(cardPartners().length, 0);
    assert.equal(isPurchasable(card, { allowPlaceholders: true }), false);
  } finally {
    applyPartners(saved);
  }
  assert.deepEqual(cardPartners().map((p) => p.partner_id), ['le-firme', 'blue-velvet']);
  assert.equal(isPurchasable(card), true);
});

/* ── What is unchanged ───────────────────────────────────────────────────── */

test('Opera Caffè is still the stay benefit, at thirty per cent, outside Privilege', () => {
  const opera = byId('opera-caffe');
  assert.equal(statusOf(opera), PARTNERSHIP_STATUS.active);
  assert.equal(opera.applies_to, 'all-guests');
  assert.deepEqual(opera.eligibility.entitlementsAll, []);
  assert.equal(opera.benefits[0].value, 30);
  assert.equal(opera.benefits[0].headline.it, '30% sul menù al tavolo');

  assert.ok(stayPartners().some((p) => p.partner_id === 'opera-caffe'));
  assert.equal(cardPartners().some((p) => p.partner_id === 'opera-caffe'), false);
});

test('Le Firme and Blue Velvet keep their economics exactly', () => {
  assert.deepEqual(byId('le-firme').benefits.map((b) => b.emphasis), ['10% OFF']);
  assert.deepEqual(byId('blue-velvet').benefits.map((b) => b.emphasis), ['€15 MAX + DRINK', '20% OFF']);
  assert.equal(byId('blue-velvet').benefits[0].cap.amount, 1500);
  assert.equal(PARTNERS.filter((p) => /blue\s*velvet/i.test(p.name)).length, 1, 'still one venue');
  assert.equal(partnerView('blue-velvet').address, 'Via del Castello d\'Altafronte 14R–16R, Firenze');
});

/* ── Order, and the one turn in it ───────────────────────────────────────── */

test('the network is one list: what works, one turn, then what is being set up', () => {
  const views = partnerNetwork();
  assert.equal(views.length, 32);

  const turn = views.findIndex((v) => v.partnership_status === PARTNERSHIP_STATUS.activating);
  assert.equal(turn, 3, 'the three agreements lead');
  assert.deepEqual(views.slice(0, 3).map((v) => v.partner_id), ['opera-caffe', 'le-firme', 'blue-velvet']);
  // Everything after the turn is on the other side of it, and nothing before.
  assert.ok(views.slice(turn).every((v) => v.partnership_status === PARTNERSHIP_STATUS.activating));

  // The curated order is the register's, kept rather than sorted.
  assert.deepEqual(views.slice(3, 7).map((v) => v.partner), 
    ['Babylon Club', 'La Petite', 'Bitter Bar', 'Giotto Pizzeria-Bistrot']);
  assert.equal(views.at(-1).partner, 'Sartoria Rossi');
});

test('the rendered list has exactly one transition in it', () => {
  for (const lang of ['it', 'en']) {
    const html = networkSection(partnerNetwork(), lang);
    assert.equal(count(html, 'data-network-turn'), 1, lang);
    assert.ok(html.includes(UI[lang].partnerActivating), lang);
    assert.equal(count(html, 'class="partner partner--network"'), 32, lang);
    assert.equal(count(html, 'data-status="activating"'), 29, lang);

    // The turn sits between the two, not at either end.
    const [before, after] = html.split('data-network-turn');
    assert.equal(count(before, 'data-status="active"'), 3);
    assert.equal(count(after, 'data-status="activating"'), 29);
  }
  assert.equal(networkSection([], 'it'), '');
});

test('a business being set up says so, and is offered nothing', () => {
  for (const lang of ['it', 'en']) {
    const html = networkSection(partnerNetwork(), lang);
    assert.equal(count(html, UI[lang].partnerComingSoon), 29, 'one badge each');
    assert.equal(count(html, 'partner__lock'), 0, 'no padlock anywhere');
    assert.equal(count(html, 'data-product='), 0, 'and nothing to buy');
    for (const word of [UI[lang].privilegeGet, UI[lang].openCard, UI[lang].privilegeLocked]) {
      assert.equal(html.includes(word), false, `"${word}" has no business here`);
    }
    // Again without the hrefs, whose percent-encoding is not a discount.
    assert.equal(/\d+\s*%/.test(html.replace(/href="[^"]*"/g, '')), false,
      'and no percentage was invented');
  }
});

/* ── Where a guest is sent, and where they are not ───────────────────────── */

test('directions exist where the address does, and nowhere else', () => {
  const withPin = activatingPartners().filter((p) => partnerView(p.partner_id).directions_url);
  const without = activatingPartners().filter((p) => !partnerView(p.partner_id).directions_url);

  assert.equal(withPin.length + without.length, 29);
  assert.ok(withPin.length >= 15 && without.length >= 10, `${withPin.length} / ${without.length}`);

  for (const partner of withPin) {
    assert.ok(partner.address?.includes('Firenze'), partner.partner_id);
    assert.ok(partnerView(partner.partner_id).directions_url.includes(encodeURIComponent(partner.address)));
  }
  // A brand with no confirmed branch gets its name and no pin: a wrong pin sends a
  // guest across Florence, which is worse than none.
  for (const id of ['erbolario', 'alessi', 'osteria-fulvio', 'caffe-maioli', 'pasquinucci', 'tre-panche']) {
    const view = partnerView(id);
    assert.equal(view.directions_url, null, id);
    assert.equal(view.address, null, id);
    assert.ok(view.partner, `${id} still says who it is`);
  }
  assert.equal(directionsUrl({ directions: true }), null, 'and never a link to nowhere');
});

test('the named branches are the named branches', () => {
  assert.equal(byId('wycon-calzaiuoli').address, 'Via dei Calzaiuoli 88, Firenze');
  assert.equal(byId('via-del-te-condotta').address, 'Via della Condotta 26/28R, Firenze');
  assert.equal(byId('benheart-vigna-nuova').address, 'Via della Vigna Nuova 85/R, Firenze');
  assert.equal(byId('erbolario').address, null, 'and the one still in question has none');
});

/* ── Logos ───────────────────────────────────────────────────────────────── */

test('an official mark is served from here, never from somebody else', () => {
  for (const partner of PARTNERS) {
    if (!partner.logo) continue;
    assert.equal(/^https?:\/\//.test(partner.logo.src), false, `${partner.partner_id} hotlinks`);
    assert.match(partner.logo.src, /^assets\/img\/partners\//, partner.partner_id);
    assert.ok(partner.logo.width > 0 && partner.logo.height > 0, 'with its own proportions');
  }
  const html = networkSection(partnerNetwork(), 'it');
  assert.equal(/src="https?:/.test(html), false, 'and no rendered logo points off this origin');
});

test('the two supplied marks are on disk, with their masters beside them', async () => {
  for (const [served, master] of [
    ['assets/img/partners/opera-caffe-400.webp', 'assets/img/_src/partners/opera-caffe.png'],
    ['assets/img/partners/blue-velvet.svg', 'assets/img/_src/partners/blue-velvet.pdf'],
  ]) {
    assert.ok((await stat(new URL(`../${served}`, import.meta.url))).size > 0, served);
    assert.ok((await stat(new URL(`../${master}`, import.meta.url))).size > 0, master);
  }

  // Blue Velvet's web asset is the vector master itself, path for path: converted,
  // cropped to its own ink by the viewBox, and never redrawn.
  const svg = await readFile(new URL('../assets/img/partners/blue-velvet.svg', import.meta.url), 'utf8');
  assert.match(svg, /<svg[^>]*viewBox="[\d.\s]+"/);
  assert.ok(svg.split('<path').length - 1 >= 20, 'every path the master had');
  assert.equal(/<image|xlink:href="data:/.test(svg), false, 'no raster smuggled inside');
});

test('a logo never replaces a name, and a partner without one still has a card', () => {
  for (const lang of ['it', 'en']) {
    const html = networkSection(partnerNetwork(), lang);

    // The two that have marks show both the mark and the words.
    assert.ok(html.includes('assets/img/partners/opera-caffe-400.webp'));
    assert.ok(html.includes('L’Opera Caffè'), 'and its name in text');
    assert.ok(html.includes('assets/img/partners/blue-velvet.svg'));
    assert.ok(html.includes('>Blue Velvet<'), 'and its name in text');

    // Le Firme has no asset yet and is drawn exactly the same way minus the box.
    assert.ok(html.includes('>Le Firme<'));
    const [, leFirme] = html.split('data-partner="le-firme"');
    assert.equal(leFirme.split('</li>')[0].includes('partner__logo'), false);

    // The mark is decorative: the name beside it is what gets read aloud.
    assert.equal(count(html, '<img src="assets/img/partners/'), count(html, 'alt=""'));
  }
  // Every partner in the network has its name in the markup, logo or no logo.
  const html = networkSection(partnerNetwork(), 'it');
  for (const view of partnerNetwork()) assert.ok(html.includes(view.partner), view.partner_id);
});

/* ── Internal data ───────────────────────────────────────────────────────── */

test('no contact, no negotiation note and no uncertainty reaches a guest', () => {
  const secrets = [];
  const walk = (v) => {
    if (typeof v === 'string' && v.trim().length > 10) secrets.push(v.trim());
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const partner of PARTNERS) for (const f of INTERNAL_PARTNER_FIELDS) walk(partner[f]);
  assert.ok(secrets.length >= 12, 'there is plenty to leak');

  const surfaces = [JSON.stringify(publicPartners())];
  for (const lang of ['it', 'en']) {
    surfaces.push(networkSection(partnerNetwork(), lang));
    surfaces.push(JSON.stringify(partnerNetwork('https://guide.example')));
  }
  const all = surfaces.join('\n');

  for (const secret of secrets) {
    assert.equal(all.includes(secret.slice(0, 36)), false, `leaked: ${secret.slice(0, 60)}…`);
  }
  // The four operational references, named so a failure is unmistakable.
  for (const who of ['Mirko', 'Massimiliano', 'Mary', 'Mauro']) {
    assert.equal(new RegExp(`\\b${who}\\b`).test(all), false, `${who} is on a guest's screen`);
  }
  for (const field of INTERNAL_PARTNER_FIELDS) {
    assert.equal(all.includes(`"${field}"`), false, field);
  }
  // And the list is genuinely there, so the check above is checking something.
  assert.ok(all.includes('Le Mossacce') && all.includes('WYCON') && all.includes('Tabacchi'));
});

test('activating one later is a data change', () => {
  // What it takes: a benefit, a rule, and the word. No renderer knows the
  // difference — `networkSection` and `privilegeSection` already draw both.
  const saved = PARTNERS.map((p) => ({ ...p }));
  try {
    applyPartners(saved.map((p) => (p.partner_id !== 'la-petite' ? p : {
      ...p,
      partnership_status: PARTNERSHIP_STATUS.active,
      eligibility: { passState: 'active', entitlementsAll: [ENTITLEMENTS.privilege] },
      benefits: [{
        benefit_id: 'la-petite-example', kind: 'percentage', value: 10,
        headline: { it: '10% di sconto', en: '10% off' },
      }],
    })));

    assert.ok(cardPartners().some((p) => p.partner_id === 'la-petite'));
    assert.ok(cardBenefits().some((v) => v.partner_id === 'la-petite'));
    assert.equal(partnerView('la-petite').validation_url, '/partner/la-petite', 'and it gets a scanner');

    const html = privilegeSection(cardBenefits(), { state: 'active', entitlements: ['privilege'], live_entitlements: ['privilege'] }, 'it');
    assert.ok(html.includes('data-partner="la-petite"'), 'drawn by the renderer that was already there');

    const network = networkSection(partnerNetwork(), 'it');
    assert.equal(count(network, 'data-network-turn'), 1, 'still one list with one turn');
  } finally {
    applyPartners(saved);
  }
  assert.equal(partnerView('la-petite').validation_url, null, 'and back to no agreement');
});
