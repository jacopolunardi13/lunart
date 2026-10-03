/**
 * Integrity of the knowledge layer.
 *
 * These are the checks that stop the guide and the Concierge drifting apart again:
 * every link resolves, every string exists in both languages, and every photograph
 * a room claims is actually on disk.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  entries, getEntry, getPlace, places, rooms, contacts, escalation, OFFICIAL_WHATSAPP, emergency, property,
  SECTION_IDS, PHASE_IDS, QUICK_ACTIONS, verifyList, itineraries, dayTrips, CATEGORIES,
} from '../data/index.js';
import { ICON_IDS } from '../src/ui/icons.js';
import { SECTIONS } from '../data/schema.js';
import { UI } from '../src/i18n.js';
import { PRODUCTS } from '../commerce/catalog.js';

const ROOT = new URL('..', import.meta.url).pathname;
const LANGS = ['it', 'en'];

/** A localised string must exist, in both languages, and not be empty. */
function assertL10n(value, where) {
  assert.equal(typeof value, 'object', `${where} should be a {it, en} object`);
  for (const lang of LANGS) {
    assert.equal(typeof value[lang], 'string', `${where} is missing "${lang}"`);
    assert.ok(value[lang].trim().length > 0, `${where}.${lang} is empty`);
  }
}

test('entry ids are unique', () => {
  const seen = new Set();
  for (const entry of entries) {
    assert.ok(!seen.has(entry.id), `duplicate entry id "${entry.id}"`);
    seen.add(entry.id);
  }
});

test('every entry is complete and bilingual', async (t) => {
  for (const entry of entries) {
    await t.test(entry.id, () => {
      assertL10n(entry.title, `${entry.id}.title`);
      assertL10n(entry.summary, `${entry.id}.summary`);
      if (entry.detail) assertL10n(entry.detail, `${entry.id}.detail`);
      assert.ok(SECTION_IDS.includes(entry.section), `${entry.id} has unknown section "${entry.section}"`);
      assert.ok(Array.isArray(entry.phase) && entry.phase.length > 0, `${entry.id} has no phase`);
      for (const phase of entry.phase) {
        assert.ok(PHASE_IDS.includes(phase), `${entry.id} has unknown phase "${phase}"`);
      }
      assert.equal(typeof entry.icon, 'string', `${entry.id} has no icon`);
    });
  }
});

test('facts and actions are well formed', () => {
  const kinds = new Set(['tel', 'whatsapp', 'mailto', 'map', 'url', 'entry', 'product']);
  for (const entry of entries) {
    for (const fact of entry.facts ?? []) {
      if (typeof fact.label === 'object') assertL10n(fact.label, `${entry.id} fact label`);
      assert.ok(fact.value, `${entry.id} has a fact with no value`);
      if (typeof fact.value === 'object') assertL10n(fact.value, `${entry.id} fact value`);
    }
    for (const action of entry.actions ?? []) {
      assert.ok(kinds.has(action.kind), `${entry.id} has unknown action kind "${action.kind}"`);
      assertL10n(action.label, `${entry.id} action label`);
      assert.ok(action.value, `${entry.id} has an action with no value`);
      if (action.kind === 'entry') {
        assert.ok(getEntry(action.value),
          `${entry.id} links to missing entry "${action.value}"`);
      }
      if (action.kind === 'product') {
        assert.ok(PRODUCTS.some((p) => p.id === action.value),
          `${entry.id} links to missing product "${action.value}"`);
      }
      if (action.kind === 'url' || action.kind === 'map') {
        assert.match(action.value, /^https:\/\//, `${entry.id} action "${action.value}" is not https`);
      }
    }
  }
});

test('no entry links to itself', () => {
  for (const entry of entries) {
    for (const action of entry.actions ?? []) {
      if (action.kind === 'entry') {
        assert.notEqual(action.value, entry.id, `${entry.id} links to itself`);
      }
    }
  }
});

test('every referenced place exists', () => {
  for (const entry of entries) {
    for (const placeId of entry.places ?? []) {
      assert.ok(getPlace(placeId), `${entry.id} references missing place "${placeId}"`);
    }
  }
});

test('places are complete and point somewhere real', () => {
  const categories = new Set(CATEGORIES.map((c) => c.id));
  const seen = new Set();
  for (const place of places) {
    assert.ok(!seen.has(place.id), `duplicate place id "${place.id}"`);
    seen.add(place.id);
    assert.ok(place.name, `place "${place.id}" has no name`);
    assert.ok(categories.has(place.category), `place "${place.id}" has unknown category "${place.category}"`);
    assertL10n(place.note, `place ${place.id} note`);
    assertL10n(place.area, `place ${place.id} area`);
    assert.match(place.maps, /^https:\/\//, `place "${place.id}" has no https Maps link`);
    if (place.url) assert.match(place.url, /^https:\/\//, `place "${place.id}" url is not https`);
  }
});

test('every quick action points at a real entry', () => {
  for (const [phase, ids] of Object.entries(QUICK_ACTIONS)) {
    assert.ok(PHASE_IDS.includes(phase), `unknown phase "${phase}" in QUICK_ACTIONS`);
    for (const id of ids) {
      assert.ok(getEntry(id), `quick action "${id}" for phase "${phase}" does not exist`);
    }
  }
});

test('every section has at least one entry', () => {
  for (const section of SECTION_IDS) {
    const count = entries.filter((e) => e.section === section).length;
    assert.ok(count > 0, `section "${section}" is empty`);
  }
});

test('every phase has at least one entry', () => {
  for (const phase of PHASE_IDS) {
    const count = entries.filter((e) => e.phase.includes(phase)).length;
    assert.ok(count > 0, `phase "${phase}" has nothing to show`);
  }
});

test('rooms are complete and their photographs exist on disk', async (t) => {
  for (const room of rooms) {
    await t.test(`room ${room.number}`, () => {
      assertL10n(room.summary, `room ${room.id} summary`);
      assertL10n(room.category, `room ${room.id} category`);
      for (const photo of room.photos) {
        assertL10n(photo.alt, `room ${room.id} photo alt`);
        for (const variant of ['400.webp', '700.webp', '1024.webp', '800.jpg']) {
          const file = join(ROOT, 'assets/img', `${photo.src}-${variant}`);
          assert.ok(existsSync(file), `missing image ${photo.src}-${variant}`);
        }
      }
    });
  }
});

/**
 * A room gallery only ever shows that room.
 *
 * Room 304 carried two photographs that were not room 304: one was room 302 — the
 * owner confirmed it, and 302 already held the same shot — and the other was a
 * generic LunArt bathroom with a caption carefully worded not to name a room,
 * which inside a room's own gallery still reads as "this is yours". The filename
 * is the invariant: a photograph in room N's gallery lives at `rooms/N-...`.
 * Nothing else may be attributed to a room, however suggestive it looks.
 */
test('no room shows a photograph belonging to another room, or to no room', () => {
  const wrong = [];
  for (const room of rooms) {
    for (const photo of room.photos) {
      if (!photo.src.startsWith(`rooms/${room.number}-`)) wrong.push(`${room.number}: ${photo.src}`);
    }
  }
  assert.deepEqual(wrong, []);
});

/**
 * And a photograph belongs to one room only.
 *
 * Moving a misattributed shot to the room it really shows is right; adding it
 * where a copy already sits is how a gallery grows the same picture twice.
 */
test('no photograph appears in two rooms', () => {
  const seen = new Map();
  const twice = [];
  for (const room of rooms) {
    for (const photo of room.photos) {
      if (seen.has(photo.src)) twice.push(`${photo.src}: ${seen.get(photo.src)} and ${room.number}`);
      else seen.set(photo.src, room.number);
    }
  }
  assert.deepEqual(twice, []);
});

/** A room with nothing verified is flagged, not quietly empty. */
test('a room with no photograph says so on the review screen', () => {
  for (const room of rooms.filter((r) => r.photos.length === 0)) {
    assert.ok(room.verify, `room ${room.number} has no photo and no verify note`);
    assert.equal(room.verify.level, 'blocker', `room ${room.number} should block on its missing photos`);
  }
});

test('contacts are reachable', () => {
  assert.ok(contacts.some((c) => c.primary), 'no primary contact is marked');
  for (const contact of contacts) {
    assert.ok(contact.phone || contact.whatsapp || contact.email, `contact "${contact.id}" has no way to reach it`);
    for (const field of ['phone', 'whatsapp']) {
      if (contact[field]) assert.match(contact[field], /^\+\d{8,}$/, `contact "${contact.id}" ${field} is not E.164`);
    }
    if (contact.email) assert.match(contact.email, /^[^@\s]+@[^@\s]+\.[^@\s]+$/, `contact "${contact.id}" email looks wrong`);
    assertL10n(contact.role, `contact ${contact.id} role`);
  }
  assert.ok(emergency.some((e) => e.number === '112'), '112 must always be listed');
});

/* ── The two channels, and the line between them ───────────────────────────
   LunArt has one WhatsApp Business line and one telephone, and they are not the
   same number. The WhatsApp line does not ring: rendering it as a telephone
   promises a call that cannot happen. Diego's number is a telephone: routing
   WhatsApp to it sends a guest to a chat nobody staffs. The field a number sits
   in is what decides, so these tests read the fields rather than the markup. */

const OFFICIAL = '+393925661488';
const DIEGO = '+393342115505';

test('the official WhatsApp number is never held in a field that can be dialled', () => {
  for (const contact of [...contacts, ...escalation]) {
    assert.notEqual(contact.phone, OFFICIAL, `contact "${contact.id}" has the WhatsApp line as a phone number`);
  }
  assert.equal(OFFICIAL_WHATSAPP, OFFICIAL);
});

test('Diego’s number is never held in a field that would open WhatsApp', () => {
  for (const contact of [...contacts, ...escalation]) {
    assert.notEqual(contact.whatsapp, DIEGO, `contact "${contact.id}" routes WhatsApp to Diego's phone`);
  }
});

test('no contact carries the same number as both a phone and a WhatsApp line', () => {
  for (const contact of [...contacts, ...escalation]) {
    if (contact.phone && contact.whatsapp) {
      assert.notEqual(contact.phone, contact.whatsapp, `contact "${contact.id}" claims one number does both`);
    }
  }
});

test('exactly one contact is the official WhatsApp, and it is the first one offered', () => {
  const whatsapp = contacts.filter((c) => c.whatsapp);
  assert.equal(whatsapp.length, 1, 'there is one official WhatsApp line, not several');
  assert.equal(whatsapp[0].whatsapp, OFFICIAL);
  assert.equal(whatsapp[0], contacts.find((c) => c.primary), 'the official line is the primary contact');
});

test('every WhatsApp action anywhere in the knowledge layer is the official line', () => {
  const wrong = [];
  for (const entry of entries) {
    for (const action of entry.actions ?? []) {
      if (action.kind === 'whatsapp' && action.value !== OFFICIAL) wrong.push(`${entry.id}: ${action.value}`);
      if (action.kind === 'tel' && action.value === OFFICIAL) wrong.push(`${entry.id}: dials the WhatsApp line`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('itineraries and day trips are bilingual', () => {
  for (const item of itineraries) {
    assertL10n(item.title, `itinerary ${item.id} title`);
    assertL10n(item.body, `itinerary ${item.id} body`);
  }
  for (const trip of dayTrips) {
    assert.ok(trip.name, `day trip "${trip.id}" has no name`);
    assertL10n(trip.how, `day trip ${trip.id} how`);
  }
});

test('verify flags are usable by a human', () => {
  const levels = new Set(['blocker', 'confirm', 'volatile']);
  const list = verifyList();
  assert.ok(list.length > 0, 'nothing is flagged, which would be suspicious');
  for (const item of list) {
    assert.ok(levels.has(item.level), `"${item.id}" has unknown verify level "${item.level}"`);
    assert.ok(item.note && item.note.length > 20,
      `"${item.id}" needs a note that says what to check`);
  }
  // Blockers first: the review list is read top down.
  const levelsInOrder = list.map((i) => i.level);
  const firstConfirm = levelsInOrder.indexOf('confirm');
  const lastBlocker = levelsInOrder.lastIndexOf('blocker');
  if (firstConfirm !== -1 && lastBlocker !== -1) {
    assert.ok(lastBlocker < firstConfirm, 'blockers should sort before everything else');
  }
});

test('no entry restates another entry’s summary', () => {
  // Duplication is exactly what this rewrite set out to remove.
  const seen = new Map();
  for (const entry of entries) {
    for (const lang of LANGS) {
      const text = entry.summary[lang].trim();
      const previous = seen.get(text);
      assert.ok(!previous, `"${entry.id}" repeats the ${lang} summary of "${previous}"`);
      seen.set(text, entry.id);
    }
  }
});

test('the property block has every localised field a view asks for', () => {
  // A missing one renders as an empty string rather than throwing, so it has to
  // be caught here: `shortTagline` once vanished silently from the hero.
  for (const field of ['tagline', 'shortTagline', 'intro']) {
    assertL10n(property[field], `property.${field}`);
  }
  assertL10n(property.address.city, 'property.address.city');
  assertL10n(property.address.floor, 'property.address.floor');
  assert.match(property.address.maps, /^https:\/\//);
});

test('every icon an entry or section names actually exists', () => {
  const used = new Set([
    ...entries.map((e) => e.icon),
    ...SECTIONS.map((s) => s.icon),
    ...CATEGORIES.map((c) => c.icon),
  ]);
  for (const id of used) {
    assert.ok(ICON_IDS.includes(id), `icon "${id}" is referenced but not drawn`);
  }
});

test('the interface is translated in both languages', () => {
  const it = Object.keys(UI.it).sort();
  const en = Object.keys(UI.en).sort();
  assert.deepEqual(it, en, 'UI string tables have drifted apart');
  for (const key of it) {
    assert.ok(UI.it[key].trim() && UI.en[key].trim(), `UI key "${key}" is empty somewhere`);
  }
});
