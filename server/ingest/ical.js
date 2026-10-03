/**
 * iCal, as a safety net.
 *
 * An iCal feed is not a reservation source. It says a room is occupied between two
 * dates and, if we are lucky, carries a booking number in the summary. It has no
 * email address, usually no phone number, and often no name — so treating it as a
 * source would mean inventing a guest, and a guest invented from a calendar entry
 * is a guest nobody can email.
 *
 * What it is good for is catching what the email adapter missed. Compare the
 * occupancy in the feed against the reservations we hold, and anything in the
 * calendar with nothing behind it becomes an alert for staff: *there is a stay here
 * that is not fully synchronised*. That is a sentence a person can act on.
 *
 * In the other direction it is deliberately timid. An event that disappears from a
 * feed does not delete anything — OTAs rewrite UIDs, feeds truncate, a cache goes
 * stale — it raises a reconciliation alert and a person decides.
 */

import { isValidDate, addDays, propertyDate } from '../../commerce/time.js';
import { isLive } from '../reservations.js';
import { raiseAlert } from './index.js';

/** Unfold the continuation lines iCal wraps long values onto. */
function unfold(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '');
}

/** YYYYMMDD or YYYYMMDDTHHMMSSZ → YYYY-MM-DD. */
function icalDate(value = '') {
  const match = /(\d{4})(\d{2})(\d{2})/.exec(String(value));
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return isValidDate(date) ? date : null;
}

/**
 * Parse the events out of a feed.
 *
 * Only the fields that mean something here: when it starts, when it ends, its UID,
 * and whatever the summary and description say — which is where channel managers
 * put a booking number when they put one anywhere.
 */
export function parseIcal(text) {
  const lines = unfold(text).split('\n');
  const events = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT') {
      if (current) events.push(normalise(current));
      current = null;
      continue;
    }
    if (!current) continue;

    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const name = line.slice(0, colon).split(';')[0].toUpperCase();
    const value = line.slice(colon + 1).trim();

    if (name === 'UID') current.uid = value;
    else if (name === 'DTSTART') current.start = icalDate(value);
    else if (name === 'DTEND') current.end = icalDate(value);
    else if (name === 'SUMMARY') current.summary = unescapeIcal(value);
    else if (name === 'DESCRIPTION') current.description = unescapeIcal(value);
    else if (name === 'LOCATION') current.location = unescapeIcal(value);
    else if (name === 'STATUS') current.status = value.toUpperCase();
  }

  return events.filter((event) => event.check_in && event.check_out);
}

const unescapeIcal = (value) => String(value)
  .replace(/\\n/gi, ' ')
  .replace(/\\,/g, ',')
  .replace(/\\;/g, ';')
  .replace(/\\\\/g, '\\')
  .replace(/\s{2,}/g, ' ')
  .trim();

/**
 * One calendar event as occupancy.
 *
 * `DTEND` in a date-valued iCal event is exclusive — the morning the room is free
 * again — so the last occupied night is the day before, and checkout is that same
 * DTEND date. Getting this wrong by one day would make every single stay look like
 * a mismatch.
 */
function normalise(event) {
  const check_in = event.start;
  const check_out = event.end;
  const text = `${event.summary ?? ''} ${event.description ?? ''} ${event.location ?? ''}`;
  return {
    uid: event.uid ?? null,
    check_in,
    check_out,
    last_night: check_out ? addDays(check_out, -1) : null,
    summary: event.summary ?? '',
    status: event.status ?? 'CONFIRMED',
    /** Whatever looks like a booking number, and nothing more. */
    booking_reference: referenceIn(text),
    room: roomIn(text),
    blocked: /not available|blocked|closed|chiuso|bloccato/i.test(text),
  };
}

/** A booking number if one is written down. No guessing from free text. */
function referenceIn(text) {
  const labelled = /(?:prenotazione|booking|reservation|conferma|confirmation)\D{0,12}([A-Z0-9][A-Z0-9-]{5,})/i.exec(text);
  if (labelled) return labelled[1].toUpperCase();
  const bare = /\b(\d{8,12})\b/.exec(text);
  return bare ? bare[1] : '';
}

const roomIn = (text) => (/\b(30[1-6])\b/.exec(text)?.[1] ?? '');

/**
 * Compare a feed against what we hold.
 *
 * Matching is by booking number when the feed carries one, and otherwise by room
 * and dates, which is the best an occupancy entry supports. Three outcomes:
 *
 *   matched       the stay is accounted for
 *   unmatched     the calendar says occupied and we have no live reservation
 *   missing       we hold a live reservation the feed does not show
 *
 * `unmatched` is the one that matters — a guest is arriving and nothing has been
 * set up for them. `missing` is raised too, but gently: feeds lag, and a stay
 * typed in by staff before the OTA pushed it is the usual explanation.
 */
export function reconcile({ events = [], reservations = [], room = '', now = new Date() }) {
  const today = propertyDate(now);
  const live = reservations.filter((r) => isLive(r));
  const matched = [];
  const unmatched = [];
  const usedIds = new Set();

  for (const event of events) {
    if (event.blocked || event.status === 'CANCELLED') continue;
    // Yesterday's occupancy is not a problem to solve.
    if (event.check_out && event.check_out < today) continue;

    const candidate = live.find((reservation) => {
      if (usedIds.has(reservation.id)) return false;
      if (event.booking_reference && reservation.booking_reference) {
        return normaliseRef(reservation.booking_reference) === normaliseRef(event.booking_reference);
      }
      const sameRoom = !event.room || !reservation.room || event.room === reservation.room;
      return sameRoom && reservation.check_in === event.check_in && reservation.check_out === event.check_out;
    });

    if (candidate) {
      usedIds.add(candidate.id);
      matched.push({ uid: event.uid, reservation_id: candidate.id });
    } else {
      unmatched.push({
        uid: event.uid,
        check_in: event.check_in,
        check_out: event.check_out,
        room: event.room || room || null,
        booking_reference: event.booking_reference || null,
      });
    }
  }

  const missing = live
    .filter((reservation) => !usedIds.has(reservation.id))
    .filter((reservation) => reservation.check_out >= today)
    // A manual reservation is not expected to be in an OTA feed.
    .filter((reservation) => reservation.source !== 'manual' && reservation.source !== 'direct')
    .map((reservation) => ({
      reservation_id: reservation.id,
      booking_reference: reservation.booking_reference,
      check_in: reservation.check_in,
      check_out: reservation.check_out,
      room: reservation.room || null,
    }));

  return { matched, unmatched, missing, checked: events.length };
}

const normaliseRef = (value) => String(value ?? '').replace(/\s+/g, '').toUpperCase();

/**
 * Fetch the feeds, reconcile, and leave alerts behind.
 *
 * `fetchText` is injected so this can be tested with a string instead of a network:
 * the reconciliation logic is the part worth testing, and it has nothing to do with
 * HTTP.
 */
export async function reconcileFeeds({
  store, feeds = [], fetchText = defaultFetchText, now = new Date(),
}) {
  if (feeds.length === 0) return { ok: false, reason: 'no-feeds-configured' };

  const reservations = await store.reservations.list({ limit: 500 });
  const summary = { checked: 0, matched: 0, unmatched: 0, missing: 0, feeds: [], errors: [] };

  for (const feed of feeds) {
    let text;
    try {
      text = await fetchText(feed.url);
    } catch (error) {
      summary.errors.push({ feed: feed.url, message: String(error.message ?? error) });
      await raiseAlert({
        store,
        key: `ical-unreachable:${feed.url}`,
        kind: 'ical-feed-unreachable',
        severity: 'warning',
        detail: { feed: feed.url, room: feed.room ?? null, message: String(error.message ?? error) },
      });
      continue;
    }

    const events = parseIcal(text);
    const result = reconcile({ events, reservations, room: feed.room ?? '', now });

    summary.checked += result.checked;
    summary.matched += result.matched.length;
    summary.unmatched += result.unmatched.length;
    summary.missing += result.missing.length;
    summary.feeds.push({ url: feed.url, room: feed.room ?? null, ...countsOf(result) });

    for (const occupancy of result.unmatched) {
      await raiseAlert({
        store,
        key: `ical-unmatched:${occupancy.uid ?? `${occupancy.room}:${occupancy.check_in}`}`,
        kind: 'occupancy-not-synchronised',
        severity: 'action',
        detail: {
          message: 'Prenotazione o occupazione rilevata dal calendario, ma non sincronizzata.',
          ...occupancy,
          feed: feed.url,
        },
      });
    }

    for (const gap of result.missing) {
      await raiseAlert({
        store,
        key: `ical-missing:${gap.reservation_id}`,
        kind: 'reservation-not-in-calendar',
        severity: 'info',
        detail: {
          message: 'Prenotazione presente in LunArt ma non nel calendario del canale.',
          ...gap,
          feed: feed.url,
        },
      });
    }
  }

  return { ok: true, ...summary };
}

const countsOf = (result) => ({
  matched: result.matched.length,
  unmatched: result.unmatched.length,
  missing: result.missing.length,
});

async function defaultFetchText(url) {
  const response = await fetch(url, { headers: { accept: 'text/calendar' } });
  if (!response.ok) throw new Error(`feed responded ${response.status}`);
  return response.text();
}

/** `room:url,room:url` or just `url,url`, as the environment variable carries them. */
export function parseFeedConfig(value = '') {
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = /^(30[1-6])[:=](.+)$/.exec(entry);
      return match ? { room: match[1], url: match[2] } : { room: '', url: entry };
    });
}
