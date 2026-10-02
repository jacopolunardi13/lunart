/**
 * The knowledge layer, assembled.
 *
 * Everything the Guest Guide renders and everything the Concierge answers comes
 * from here. Nothing downstream holds a copy of a fact — `src/` only ever reads.
 */

import { SECTIONS, PHASES, SECTION_IDS, PHASE_IDS } from './schema.js';
import { property, contacts, unverifiedContacts, emergency } from './property.js';
import { rooms, roomsCommon } from './rooms.js';
import { places, CATEGORIES, itineraries, dayTrips } from './florence.js';
import { arrival } from './entries/arrival.js';
import { stay } from './entries/stay.js';
import { breakfast } from './entries/breakfast.js';
import { help } from './entries/help.js';
import { departure } from './entries/departure.js';
import { florence } from './entries/florence.js';

export { SECTIONS, PHASES, SECTION_IDS, PHASE_IDS };
export { property, contacts, unverifiedContacts, emergency };
export { rooms, roomsCommon };
export { places, CATEGORIES, itineraries, dayTrips };

/** Every entry, in one flat list. Order within a section comes from `priority`. */
export const entries = [...arrival, ...stay, ...breakfast, ...help, ...departure, ...florence]
  .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));

const byId = new Map(entries.map((e) => [e.id, e]));
const placesById = new Map(places.map((p) => [p.id, p]));

export const getEntry = (id) => byId.get(id);
export const getPlace = (id) => placesById.get(id);

export const entriesInSection = (sectionId) => entries.filter((e) => e.section === sectionId);

/** The handful of things a guest taps for without reading anything first. */
export const QUICK_ACTIONS = {
  before:  ['checkin', 'access', 'parking', 'luggage-early'],
  staying: ['wifi', 'breakfast', 'room-problem', 'eat'],
  leaving: ['checkout', 'luggage-late', 'taxi', 'to-airport'],
};

/** Everything flagged for human confirmation, for the review screen and the report. */
export function verifyList() {
  const out = [];
  for (const e of entries) {
    if (e.verify) out.push({ kind: 'entry', id: e.id, title: e.title, ...e.verify });
  }
  for (const r of rooms) {
    if (r.verify) out.push({ kind: 'room', id: r.id, title: { it: `Camera ${r.number}`, en: `Room ${r.number}` }, ...r.verify });
  }
  const rank = { blocker: 0, confirm: 1, volatile: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
