/**
 * Which rooms LunArt has, and how to name more than one of them.
 *
 * A booking is not always one room. Booking.com sells a group of seven adults the
 * whole floor, QuoVai sends one notification listing four rooms, and until this
 * module existed the parser kept the first number it found and the guide told the
 * group they were in room 305. Everything downstream believed it: the Staff app
 * printed "Camera 305 · 7 ospiti", the email said Camera 305, and a breakfast
 * ordered without a room was quietly attached to 305 as well.
 *
 * So there is one definition here of what a room id is, and one of how to read a
 * set of them out loud. Both the browser and the server import it, because the
 * sentence a guest reads on their phone and the sentence in the email they were
 * sent have to be the same sentence.
 *
 * The range is deliberately a closed list rather than "any three digits". LunArt
 * lets 301 to 305 and expects a 306; a notification carrying 307, a price of 302
 * euros or a booking number ending in 304 is not a room, and the one place that
 * decides is here. `data/rooms.js` is a different thing — what LunArt publishes
 * about each room, photographs and all — and it covers only the rooms that exist.
 */

/** Every room id LunArt lets, or expects to let. */
export const ROOM_IDS = ['301', '302', '303', '304', '305', '306'];

/**
 * A room id inside a longer string.
 *
 * Exported so the QuoVai parser and this module cannot drift apart: a room in the
 * email ("305 sup", "302 queen std /NR BB OTA") is the same thing as a room in the
 * store. Not global — each caller decides whether it wants one match or all of
 * them — and word-bounded, so "1305" and "3050" are not rooms.
 */
export const ROOM_IN_TEXT = /\b(30[1-6])\b/;

/** True for exactly the strings LunArt uses as room numbers. */
export const isRoomId = (value) => ROOM_IDS.includes(String(value ?? '').trim());

/**
 * Read a room set out of whatever shape it arrives in.
 *
 * Takes an array, a single value, or a string, and answers with the LunArt rooms
 * in it: unique, valid, and in ascending order. The order is not cosmetic — it is
 * what makes two readings of the same booking compare equal, so a modification
 * that lists the rooms in a different order is not mistaken for a change.
 *
 * This reads values that have already been extracted structurally — a parsed room
 * column, a stored field — and never free prose. Pulling numbers out of a guest's
 * note is the mistake this exists to prevent, and the parser is where that bound
 * is enforced.
 */
export function roomsOf(input) {
  const found = new Set();
  for (const entry of Array.isArray(input) ? input : [input]) {
    for (const match of String(entry ?? '').matchAll(/\b(30[1-6])\b/g)) found.add(match[1]);
  }
  return [...found].sort();
}

/** The conjunction, which is the only part of a list of numbers that has a language. */
const AND = { it: 'e', en: 'and' };

/**
 * A room set as a person reads it: `302, 303, 304 e 305`.
 *
 * Commas and then a conjunction, because "302, 303, 304, 305" read aloud in a
 * breakfast room sounds like it might continue. One room is just the number, so
 * every caller can use this and let the singular case look after itself.
 */
export function roomList(rooms, lang = 'it') {
  const list = roomsOf(rooms);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  const and = AND[lang === 'en' ? 'en' : 'it'];
  return `${list.slice(0, -1).join(', ')} ${and} ${list.at(-1)}`;
}

/**
 * The rooms a record holds, whichever field it has them in.
 *
 * `rooms` when there is one, and `room` when there is not — which is every record
 * written before `rooms` existed, and is why this is a function rather than
 * `record.rooms ?? record.room` spelled out at each of twenty call sites. Written
 * so that an empty set never hides a legacy single room: a `rooms: []` beside a
 * `room: '305'` reads as 305 rather than as nothing.
 */
export const roomsIn = (record) => {
  const set = roomsOf(record?.rooms);
  return set.length > 0 ? set : roomsOf(record?.room);
};

/**
 * The room pair as the reservation model holds it.
 *
 * One room keeps the legacy single field, so every record written before this
 * existed and every screen that reads `room` carries on working. More than one
 * clears it: a group in four rooms is not in room 305, and a field saying it is
 * would be the original bug preserved for the convenience of the code that reads
 * it. Nothing — no room at all — leaves `room` for the caller to keep as it was,
 * because a parser that lost the room is not evidence that there isn't one.
 */
export function roomFields(input) {
  const rooms = roomsOf(input);
  return { rooms, room: rooms.length === 1 ? rooms[0] : '' };
}

/** True when this booking spans more than one room. */
export const isMultiRoom = (reservation) => roomsIn(reservation).length > 1;
