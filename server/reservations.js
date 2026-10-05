/**
 * The reservation, as LunArt means it.
 *
 * Everything downstream — the personal guide link, the guest email, which card
 * lengths can be sold, what the Staff app shows — reads this shape and only this
 * shape. Booking.com's fields, Expedia's fields and QuoVai's fields never get
 * further than an adapter, because a model shaped around one channel's email
 * becomes a model that cannot hold the next channel.
 *
 * Three rules hold the whole thing together:
 *
 *   1. One reservation per `source` + `booking_reference`. That pair is what a
 *      modification refers to, so it is what the upsert turns on.
 *   2. Ingestion is idempotent. The same QuoVai email delivered twice must not
 *      produce a second reservation, a second guide link or a second email.
 *   3. A cancellation never deletes. The record stays, with its history, because
 *      somebody may already have paid for breakfast against it.
 *   4. A reservation can start life incomplete. An iCal feed knows a room is
 *      occupied and nothing else; that is worth holding as a `provisional`
 *      reservation, and the notification that arrives later must fill it in rather
 *      than file a second stay beside it. See `adoptProvisional` below.
 */

import { opaqueToken, randomRef } from './store.js';
import { propertyDate, isValidDate, addDays } from '../commerce/time.js';
import { stayDates } from '../commerce/stay.js';

export const RESERVATION_STATUS = {
  /** Live, and either coming or here. */
  active: 'active',
  /** Live, and something changed since we first saw it. Still a stay. */
  modified: 'modified',
  /** Called off. Kept, never deleted. */
  cancelled: 'cancelled',
  /** Checked out. */
  completed: 'completed',
};

/** A status that still means "there is a stay". */
export const isLive = (reservation) =>
  reservation?.status === RESERVATION_STATUS.active || reservation?.status === RESERVATION_STATUS.modified;

export const RESERVATION_SOURCES = {
  /** The channel manager, whatever OTA is behind it. */
  quovai: 'quovai',
  /** Typed in by staff, because something did not arrive. */
  manual: 'manual',
  /** Read off an iCal feed: occupancy, not a guest. */
  ical: 'ical',
  /** Booked directly with LunArt. */
  direct: 'direct',
};

const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const digits = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
};

/**
 * Build a canonical reservation.
 *
 * `guide_token` is minted here and is opaque: 24 random bytes, base64url. It
 * carries no name, no room, no dates and no booking number — a link that encodes
 * who you are is a link that tells anyone who sees it who you are.
 */
export function buildReservation(input = {}) {
  const check_in = isValidDate(input.check_in) ? input.check_in : null;
  const check_out = isValidDate(input.check_out) ? input.check_out : null;
  const adults = digits(input.adults ?? 0);
  const children = digits(input.children ?? 0);

  return {
    object: 'reservation',
    source: text(input.source ?? RESERVATION_SOURCES.manual, 40),
    /** The id in whatever system it came from, kept for tracing, never shown. */
    source_reference: text(input.source_reference, 80),
    /** What a guest would read out: the OTA booking number. */
    booking_reference: text(input.booking_reference, 80).toUpperCase(),
    /** Which OTA or channel actually sold it, when the source knows. */
    channel: text(input.channel, 80),
    status: input.status ?? RESERVATION_STATUS.active,

    first_name: text(input.first_name, 80),
    last_name: text(input.last_name, 80),
    guest_email: text(input.guest_email, 160),
    guest_phone: text(input.guest_phone, 40),
    lang: input.lang === 'en' ? 'en' : 'it',

    check_in,
    check_out,
    adults,
    children,
    guest_count: digits(input.guest_count ?? adults + children) || adults + children,
    room: text(input.room, 20),
    rate: text(input.rate, 120),
    total_amount: Number.isFinite(Number(input.total_amount)) ? Math.trunc(Number(input.total_amount)) : null,
    currency: text(input.currency ?? 'EUR', 8),
    notes: text(input.notes, 1000),

    /**
     * True while this is occupancy rather than a guest.
     *
     * An iCal feed gives dates, a room and sometimes a booking number. It does not
     * give a name, an address or a telephone number, and inventing any of them
     * would be worse than admitting they are missing — so the record says so, and
     * says it in one field that everything downstream can check. Nothing is emailed
     * to a provisional reservation, and the Staff app puts it in front of somebody.
     */
    provisional: input.provisional === true,
    /**
     * The calendar entry this came from, when it came from one.
     *
     * The feed's own UID, kept so that reading the same feed again recognises the
     * reservation it already made instead of making another. It is never shown to a
     * guest and never used as a booking number, because it is not one.
     */
    ical_uid: text(input.ical_uid, 200),

    guide_token: input.guide_token ?? opaqueToken(24),
    guide_created_at: input.guide_created_at ?? new Date().toISOString(),
    guide_email_status: input.guide_email_status ?? 'pending',
    guide_email_sent_at: input.guide_email_sent_at ?? null,

    /** A short code staff can read down the phone. Not a credential. */
    staff_ref: input.staff_ref ?? randomRef(6),

    booked_at: input.booked_at ?? null,
    source_updated_at: input.source_updated_at ?? null,
    cancelled_at: null,
    cancel_reason: '',
    history: [],
  };
}

/** One line of history, so a staff screen can say what changed and when. */
const note = (reservation, type, detail = '') => ({
  ...reservation,
  history: [...(reservation.history ?? []), { at: new Date().toISOString(), type, detail: text(detail, 300) }].slice(-50),
});

/** Fields an inbound event is allowed to change on an existing reservation. */
const MUTABLE = [
  'first_name', 'last_name', 'guest_email', 'guest_phone', 'channel',
  'check_in', 'check_out', 'adults', 'children', 'guest_count', 'room', 'rate',
  'total_amount', 'currency', 'notes', 'source_reference', 'source_updated_at', 'booked_at',
];

/** What actually differs between what we hold and what just arrived. */
export function changesBetween(current, incoming) {
  const changed = {};
  for (const field of MUTABLE) {
    const next = incoming[field];
    if (next === undefined || next === null || next === '') continue;
    if (String(current[field] ?? '') !== String(next)) changed[field] = next;
  }
  return changed;
}

const normaliseRef = (value) => String(value ?? '').replace(/\s+/g, '').toUpperCase();

/**
 * Fields a provisional reservation is still missing before it is a guest.
 *
 * Derived, never stored, so it cannot go stale: the moment a name is filled in the
 * record stops reporting that it needs one. The Staff app shows this list verbatim
 * under "Dati ospite da completare".
 */
export const REQUIRED_FOR_GUEST = ['first_name', 'last_name', 'guest_email'];

export function incompleteFields(reservation) {
  if (!reservation) return [];
  return REQUIRED_FOR_GUEST.filter((field) => !String(reservation[field] ?? '').trim());
}

/** True when there is a stay here but not yet a guest to send anything to. */
export const isProvisional = (reservation) =>
  reservation?.provisional === true || incompleteFields(reservation).length > 0;

/**
 * Find the provisional reservation this notification is about, if there is one.
 *
 * The problem this solves: the calendar feed said room 304 is taken from the 12th
 * to the 15th, so LunArt holds a provisional stay for it. Three hours later the
 * QuoVai email arrives for the same stay. Keyed on `source` + `booking_reference`
 * the email finds nothing — the provisional record came from `ical` and has no
 * booking number — and files a second reservation. The guest then has two stays,
 * two Passes and two guide links, one of which nobody is watching.
 *
 * So before creating, look for occupancy that is plainly the same stay. Three
 * tiers, strongest first:
 *
 *   1. the booking number, when the feed happened to carry one
 *   2. the same room over exactly the same nights
 *   3. the same room arriving on the same day — two guests cannot
 *
 * And one rule above all three: **more than one candidate is not a match.** An
 * ambiguous merge would silently attach a guest to somebody else's stay, orders
 * and Pass included. Two candidates means a person decides, so it returns the
 * candidates instead and the caller raises them.
 */
export async function findProvisionalMatch({ store, incoming }) {
  const candidates = (await store.reservations.provisional()).filter((r) => isLive(r));
  if (candidates.length === 0) return { match: null, by: null, candidates: [] };

  const tiers = [
    ['booking_reference', (r) => (
      normaliseRef(incoming.booking_reference)
      && normaliseRef(r.booking_reference) === normaliseRef(incoming.booking_reference)
    )],
    ['room-and-dates', (r) => (
      incoming.room && incoming.check_in && incoming.check_out
      && r.room === incoming.room
      && r.check_in === incoming.check_in && r.check_out === incoming.check_out
    )],
    ['room-and-arrival', (r) => (
      incoming.room && incoming.check_in
      && r.room === incoming.room && r.check_in === incoming.check_in
    )],
  ];

  for (const [by, matches] of tiers) {
    const found = candidates.filter(matches);
    if (found.length === 1) return { match: found[0], by, candidates: found };
    if (found.length > 1) return { match: null, by, candidates: found, ambiguous: true };
  }
  return { match: null, by: null, candidates: [] };
}

/**
 * Turn occupancy into a guest, in place.
 *
 * Everything that identifies the stay to the outside world is kept: the id orders
 * are filed against, the guide token that may already be open on somebody's phone,
 * the staff reference read down the telephone, the history, and — because they are
 * keyed on `reservation_id` elsewhere and never copied in here — the orders, the
 * Pass and any Privilege card. What changes is where it came from and who it is
 * for.
 */
async function adoptProvisional({ store, reservation, incoming, by }) {
  const patch = { provisional: false, status: incoming.status ?? RESERVATION_STATUS.active };
  for (const field of [...MUTABLE, 'source', 'booking_reference', 'source_reference', 'lang']) {
    const next = incoming[field];
    if (next === undefined || next === null || next === '') continue;
    if (String(reservation[field] ?? '') === String(next)) continue;
    patch[field] = next;
  }
  // The guide email was never scheduled for occupancy. Now there is somebody to
  // send it to, so it goes back on the ordinary footing and the caller schedules it.
  if (incoming.guest_email) patch.guide_email_status = 'pending';

  const described = Object.entries(patch)
    .filter(([field]) => field !== 'provisional' && field !== 'status')
    .map(([field, value]) => `${field}: ${value}`).join(', ');
  const updated = await store.reservations.update(reservation.id, {
    ...patch,
    history: note(reservation, 'completed-from-notification', `${by}; ${described}`).history,
  });
  return { ok: true, action: 'completed', reservation: updated, matchedBy: by, changed: patch };
}

/**
 * Create or update one reservation from an inbound event.
 *
 * Returns what happened as well as the record, because the caller has to decide
 * whether to schedule an email, and "nothing changed" is a different answer from
 * "the dates moved".
 */
export async function upsertReservation({ store, event, now = new Date() }) {
  const incoming = buildReservation(event);
  if (!incoming.booking_reference) {
    return { ok: false, reason: 'missing-booking-reference' };
  }

  const existing = await store.reservations.findByBooking(incoming.source, incoming.booking_reference);

  if (!existing) {
    /**
     * Nothing under this key — but possibly the same stay under no key at all.
     * A calendar feed may already have put it there.
     */
    const provisional = await findProvisionalMatch({ store, incoming });
    if (provisional.match) {
      return adoptProvisional({ store, reservation: provisional.match, incoming, by: provisional.by });
    }
    const created = await store.reservations.create(
      note(incoming, 'created', `da ${incoming.source}`),
    );
    return {
      ok: true,
      action: 'created',
      reservation: created,
      /** Said rather than guessed at: two provisional stays could be this one. */
      ambiguousProvisional: provisional.ambiguous ? provisional.candidates.map((r) => r.id) : null,
    };
  }

  const changed = changesBetween(existing, incoming);
  const wasCancelled = existing.status === RESERVATION_STATUS.cancelled;
  const reviving = wasCancelled && event.kind !== 'cancelled';

  if (Object.keys(changed).length === 0 && !reviving) {
    return { ok: true, action: 'unchanged', reservation: existing };
  }

  const patch = {
    ...changed,
    status: reviving ? RESERVATION_STATUS.active : RESERVATION_STATUS.modified,
    cancelled_at: reviving ? null : existing.cancelled_at,
  };
  const described = Object.entries(changed).map(([field, value]) => `${field}: ${value}`).join(', ');
  const updated = await store.reservations.update(
    existing.id,
    { ...patch, history: note(existing, reviving ? 'reinstated' : 'modified', described).history },
  );
  return { ok: true, action: reviving ? 'reinstated' : 'modified', reservation: updated, changed };
}

/**
 * What a parser repair is allowed to touch.
 *
 * Deliberately narrower than MUTABLE. A repair exists because the parser read the
 * email badly, so it may correct what the parser produces — the name, the room,
 * the channel, the contact details. It may not touch the dates, because moving
 * them is a modification to the stay and modifications arrive as notifications and
 * reschedule the guest email; nor the status, because a repair is not a
 * cancellation or a reinstatement; nor the guide token, the guide email state or
 * the staff reference, because a guest already holds a link and may already have
 * had the email.
 */
export const REPAIRABLE = [
  'first_name', 'last_name', 'guest_email', 'guest_phone', 'channel',
  'adults', 'children', 'guest_count', 'room', 'rate', 'total_amount',
  'source_reference', 'booked_at', 'notes',
];

/**
 * Fill in and correct what a better parser can now read.
 *
 * Nothing here creates, cancels, reinstates, schedules or sends. It takes a
 * reservation that already exists and an event parsed from the email it came from,
 * and moves the record towards the email — once. Run it again with the same email
 * and it finds nothing to change, which is what makes it safe to run twice by
 * mistake.
 *
 * An empty value never overwrites a filled one: a parser that lost a field is not
 * evidence that the field is empty, and the whole point of this is that the old
 * parser lost fields.
 */
export async function repairReservation({ store, reservation, event, fields = REPAIRABLE }) {
  if (!reservation) return { ok: false, reason: 'no-reservation' };

  const incoming = buildReservation({ ...event, source: reservation.source });
  const changed = {};
  for (const field of fields) {
    const next = incoming[field];
    if (next === undefined || next === null || next === '' || next === 0) continue;
    if (String(reservation[field] ?? '') === String(next)) continue;
    changed[field] = next;
  }

  /**
   * The booking number itself, when the parser mangled it.
   *
   * It is the key the upsert turns on, so it is never changed by an ordinary
   * modification — but the old parser glued the status word onto it
   * ("6703524869NEW"), and a number no guest could read back is exactly what a
   * repair is for. Only ever towards the clean value, and never onto a number some
   * other reservation already holds.
   */
  const clean = text(event.booking_reference, 80).toUpperCase();
  if (clean && clean !== reservation.booking_reference && reservation.booking_reference.startsWith(clean)) {
    const collision = await store.reservations.findByBooking(reservation.source, clean);
    if (collision && collision.id !== reservation.id) {
      return { ok: false, reason: 'reference-collision', reservation, collision: collision.id };
    }
    changed.booking_reference = clean;
  }

  if (Object.keys(changed).length === 0) return { ok: true, action: 'unchanged', reservation };

  const described = Object.entries(changed).map(([field, value]) => `${field}: ${value}`).join(', ');
  const updated = await store.reservations.update(reservation.id, {
    ...changed,
    history: note(reservation, 'parser-repair', described).history,
  });
  return { ok: true, action: 'repaired', reservation: updated, changed };
}

/** Called off. The record and everything bought against it stay exactly where they are. */
export async function cancelReservation({ store, reservation, reason = '', now = new Date() }) {
  if (!reservation) return null;
  if (reservation.status === RESERVATION_STATUS.cancelled) return reservation;
  return store.reservations.update(reservation.id, {
    status: RESERVATION_STATUS.cancelled,
    cancelled_at: now.toISOString(),
    cancel_reason: text(reason, 300),
    history: note(reservation, 'cancelled', reason).history,
  });
}

/** Past checkout, so it is history rather than a stay. Runs on a schedule, and idempotent. */
export async function completePastStays({ store, now = new Date() }) {
  const today = propertyDate(now);
  const live = await store.reservations.filter((r) => isLive(r));
  const done = [];
  for (const reservation of live) {
    if (!reservation.check_out || reservation.check_out >= today) continue;
    done.push(await store.reservations.update(reservation.id, {
      status: RESERVATION_STATUS.completed,
      history: note(reservation, 'completed').history,
    }));
  }
  return done;
}

/** A fresh link, when the old one went astray or has to be invalidated. */
export async function rotateGuideToken({ store, reservation }) {
  return store.reservations.update(reservation.id, {
    guide_token: opaqueToken(24),
    guide_created_at: new Date().toISOString(),
    history: note(reservation, 'guide-link-rotated').history,
  });
}

/**
 * What the browser is allowed to know on a personal guide link.
 *
 * First name, room, dates, how many people, and the state of the stay. Not the
 * surname, not the email, not the phone number, not the booking number, not the
 * rate, not the channel — none of which the guide needs to do its job, and all of
 * which would then be sitting in a URL someone shares over a hotel Wi-Fi.
 */
export function guestContext(reservation, { now = new Date() } = {}) {
  if (!reservation) return null;
  const today = propertyDate(now);
  const dates = stayDates(reservation);
  return {
    first_name: reservation.first_name,
    room: reservation.room || null,
    check_in: reservation.check_in,
    check_out: reservation.check_out,
    nights: Math.max(0, dates.length - 1),
    guest_count: reservation.guest_count,
    adults: reservation.adults,
    children: reservation.children,
    lang: reservation.lang,
    status: reservation.status,
    cancelled: reservation.status === RESERVATION_STATUS.cancelled,
    /** Which part of the stay they are in, so the guide can order itself. */
    phase: phaseOf(reservation, today),
    /**
     * Today, in Florence.
     *
     * So the browser never has to work out which day it is for a property in
     * another time zone, and so "arrives today" means the same thing on the phone
     * as it does at the desk.
     */
    today,
    /** The days anything sold inside the stay may fall on. */
    stay_days: dates,
  };
}

/** Before, during, after — from the dates rather than from a guess. */
export function phaseOf(reservation, today = propertyDate()) {
  if (!reservation?.check_in || !reservation?.check_out) return 'before';
  if (today < reservation.check_in) return 'before';
  if (today > reservation.check_out) return 'leaving';
  return today === reservation.check_out ? 'leaving' : 'staying';
}

/** Everything staff see. Still no guide token unless they ask for the link itself. */
export function staffView(reservation) {
  if (!reservation) return null;
  return {
    id: reservation.id,
    status: reservation.status,
    source: reservation.source,
    channel: reservation.channel,
    booking_reference: reservation.booking_reference,
    staff_ref: reservation.staff_ref,
    first_name: reservation.first_name,
    last_name: reservation.last_name,
    guest_email: reservation.guest_email,
    guest_phone: reservation.guest_phone,
    check_in: reservation.check_in,
    check_out: reservation.check_out,
    adults: reservation.adults,
    children: reservation.children,
    guest_count: reservation.guest_count,
    room: reservation.room,
    rate: reservation.rate,
    total_amount: reservation.total_amount,
    currency: reservation.currency,
    notes: reservation.notes,
    provisional: reservation.provisional === true,
    /** Exactly what a person has to go and find. Derived, so it cannot go stale. */
    incomplete: incompleteFields(reservation),
    ical_uid: reservation.ical_uid ?? null,
    guide_email_status: reservation.guide_email_status,
    guide_email_sent_at: reservation.guide_email_sent_at,
    guide_created_at: reservation.guide_created_at,
    cancelled_at: reservation.cancelled_at,
    created_at: reservation.created_at,
    updated_at: reservation.updated_at,
    history: reservation.history ?? [],
  };
}

/** The stay a reservation represents, for anything that has to fit inside it. */
export const stayOf = (reservation) => (
  reservation?.check_in && reservation?.check_out
    ? { check_in: reservation.check_in, check_out: reservation.check_out }
    : null
);

export { propertyDate, addDays, stayDates };
