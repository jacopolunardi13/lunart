/**
 * iCal, as a safety net.
 *
 * An iCal feed is not a reservation source. It says a room is occupied between two
 * dates and, if we are lucky, carries a booking number in the summary. It has no
 * email address, usually no phone number, and often no name — so treating it as a
 * source would mean inventing a guest, and a guest invented from a calendar entry
 * is a guest nobody can email.
 *
 * What it is good for is catching what the email adapter missed — and that is worth
 * more than an alert. A stay in the calendar with nothing behind it means a guest is
 * arriving and LunArt has no reservation, no Pass and nothing to sell them. So the
 * feed does create something: a **provisional** reservation, holding exactly what
 * the feed really said and admitting the rest is missing. Nothing is invented. No
 * name, no email address, no telephone number, no channel, no booking number.
 *
 * Two guarantees make that safe to do:
 *
 *   nothing is sent    a provisional reservation never schedules a guest email,
 *                      enforced in `scheduleGuideEmail` rather than here
 *   nothing is doubled when the QuoVai notification arrives it *fills this record
 *                      in* — same id, same guide token, same orders, same Pass —
 *                      instead of filing a second stay. See `findProvisionalMatch`
 *                      in `server/reservations.js`
 *
 * In the other direction it stays deliberately timid. An event that disappears from
 * a feed deletes nothing and cancels nothing — OTAs rewrite UIDs, feeds truncate, a
 * cache goes stale — it raises an alert and a person decides.
 *
 * Nothing here assumes what a QuoVai feed looks like. The parser reads the iCal
 * properties that are standard, takes a booking number and a room only where one is
 * actually written down, and `inspectIcal` exists so that the first thing done with
 * a real feed URL is to look at what it carries rather than to guess.
 */

import { isValidDate, addDays, propertyDate } from '../../commerce/time.js';
import { isLive, buildReservation, incompleteFields, RESERVATION_SOURCES } from '../reservations.js';
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
 * What a feed actually carries.
 *
 * Read-only, and the first thing to do with a real URL. Nothing in LunArt knows
 * what a QuoVai iCal export looks like — whether it names the guest in the SUMMARY,
 * whether it carries the booking number anywhere, whether the room is in the
 * LOCATION or only implied by which feed it is — and the honest answer to that is
 * to look, not to assume. This reports the shape: which properties appear, how many
 * events, and whether the fields matching depends on are present.
 *
 * The sample is one event with its free text truncated, because a feed may name a
 * guest and this is read by a diagnostics screen.
 */
export function inspectIcal(text) {
  const raw = unfold(text);
  const properties = new Set();
  for (const line of raw.split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const name = line.slice(0, colon).split(';')[0].trim().toUpperCase();
    if (/^[A-Z][A-Z0-9-]*$/.test(name)) properties.add(name);
  }

  const events = parseIcal(text);
  const first = events[0] ?? null;
  return {
    looksLikeIcal: /BEGIN:VCALENDAR/i.test(raw),
    bytes: raw.length,
    events: events.length,
    properties: [...properties].sort(),
    withUid: events.filter((e) => e.uid).length,
    withBookingReference: events.filter((e) => e.booking_reference).length,
    withRoom: events.filter((e) => e.room).length,
    blocked: events.filter((e) => e.blocked).length,
    sample: first
      ? {
        uid: first.uid,
        check_in: first.check_in,
        check_out: first.check_out,
        status: first.status,
        booking_reference: first.booking_reference || null,
        room: first.room || null,
        summary: String(first.summary ?? '').slice(0, 120),
      }
      : null,
  };
}

/**
 * Compare a feed against what we hold.
 *
 * Matching runs strongest first, and stops at the first tier that gives exactly one
 * answer:
 *
 *   1. the feed's own UID, against a reservation this feed already created
 *   2. the booking number, when the feed carries one
 *   3. the room over exactly the same nights
 *
 * Three outcomes:
 *
 *   matched       the stay is accounted for
 *   unmatched     the calendar says occupied and we have no reservation at all
 *   missing       we hold a live reservation the feed does not show
 *
 * `unmatched` is the one that matters — a guest is arriving and nothing has been set
 * up for them — and it is what `reconcileFeeds` turns into a provisional
 * reservation. `missing` is raised too, and split in two: a stay we only ever knew
 * about *through this feed* vanishing from it is worth a warning, because the OTA
 * may have cancelled it; an emailed reservation the feed has not caught up with is
 * routine.
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

    const free = live.filter((reservation) => !usedIds.has(reservation.id));
    const tiers = [
      ['uid', (r) => event.uid && r.ical_uid === event.uid],
      ['booking_reference', (r) => (
        event.booking_reference && r.booking_reference
        && normaliseRef(r.booking_reference) === normaliseRef(event.booking_reference)
      )],
      ['room-and-dates', (r) => (
        (!event.room || !r.room || event.room === r.room)
        && r.check_in === event.check_in && r.check_out === event.check_out
      )],
    ];

    let candidate = null;
    let by = null;
    for (const [tier, matches] of tiers) {
      const found = free.filter(matches);
      // Two reservations answering to one calendar entry is not a match. It is a
      // thing for a person to look at, and merging either one would be a guess.
      if (found.length === 1) { candidate = found[0]; by = tier; break; }
      if (found.length > 1) { by = tier; break; }
    }

    if (candidate) {
      usedIds.add(candidate.id);
      matched.push({
        uid: event.uid,
        reservation_id: candidate.id,
        by,
        provisional: candidate.provisional === true,
        incomplete: incompleteFields(candidate),
      });
    } else {
      unmatched.push({
        uid: event.uid,
        check_in: event.check_in,
        check_out: event.check_out,
        last_night: event.last_night,
        room: event.room || room || null,
        booking_reference: event.booking_reference || null,
        summary: event.summary ?? '',
        ambiguous: by ? by : null,
      });
    }
  }

  const absent = live
    .filter((reservation) => !usedIds.has(reservation.id))
    .filter((reservation) => reservation.check_out >= today)
    // A manual reservation is not expected to be in an OTA feed.
    .filter((reservation) => reservation.source !== 'manual' && reservation.source !== 'direct')
    .map((reservation) => ({
      reservation_id: reservation.id,
      booking_reference: reservation.booking_reference || null,
      check_in: reservation.check_in,
      check_out: reservation.check_out,
      room: reservation.room || null,
      provisional: reservation.provisional === true,
      ical_uid: reservation.ical_uid ?? null,
    }));

  return {
    matched,
    unmatched,
    /** Emailed stays the feed has not caught up with. Routine. */
    missing: absent.filter((r) => !r.ical_uid),
    /**
     * Stays we only ever knew about through a calendar, now gone from it.
     *
     * Reported, never acted on: this is where an automatic cancellation would go,
     * and an automatic cancellation here would call off a real guest because a feed
     * rewrote its UIDs.
     */
    vanished: absent.filter((r) => Boolean(r.ical_uid)),
    checked: events.length,
  };
}

const normaliseRef = (value) => String(value ?? '').replace(/\s+/g, '').toUpperCase();

/**
 * Hold a stay we can see but do not know.
 *
 * Every field comes from the feed or is left empty. `booking_reference` is empty
 * unless the feed actually wrote one down — a booking number is something a guest
 * reads back to us, so a made-up one is worse than none — and the feed's UID goes in
 * `ical_uid` instead, which is what makes the next read of the same feed recognise
 * this record rather than create another.
 *
 * `provisional: true` is the load-bearing field: it is what stops the guest email,
 * and what lets the QuoVai notification adopt this record later instead of filing a
 * second stay.
 */
export async function createProvisional({ store, occupancy, feed = {}, now = new Date() }) {
  const existing = occupancy.uid ? await store.reservations.findByIcalUid(occupancy.uid) : null;
  if (existing) return { ok: true, action: 'unchanged', reservation: existing };

  const reservation = buildReservation({
    source: RESERVATION_SOURCES.ical,
    provisional: true,
    ical_uid: occupancy.uid ?? '',
    booking_reference: occupancy.booking_reference ?? '',
    check_in: occupancy.check_in,
    check_out: occupancy.check_out,
    room: occupancy.room ?? '',
    guide_email_status: 'no-address',
    notes: [
      'Prenotazione provvisoria creata dal calendario.',
      'Dati ospite da completare: nome, cognome, email.',
      feed.url ? `Feed: ${feed.url}` : '',
      occupancy.summary ? `Calendario: ${occupancy.summary}` : '',
    ].filter(Boolean).join(' '),
  });

  const created = await store.reservations.create({
    ...reservation,
    history: [{
      at: now.toISOString(),
      type: 'created-provisional',
      detail: `da calendario${occupancy.uid ? ` (${occupancy.uid})` : ''}`,
    }],
  });
  return { ok: true, action: 'created', reservation: created };
}

/**
 * Fetch the feeds, reconcile, hold what is missing, and leave alerts behind.
 *
 * `fetchText` is injected so this can be tested with a string instead of a network:
 * the reconciliation logic is the part worth testing, and it has nothing to do with
 * HTTP. `create` is injectable in the same spirit and defaults to on — a run that
 * only reports would leave the arriving guest exactly as unprepared for as before.
 */
export async function reconcileFeeds({
  store, feeds = [], fetchText = defaultFetchText, now = new Date(), create = true,
}) {
  if (feeds.length === 0) return { ok: false, reason: 'no-feeds-configured' };

  const reservations = await store.reservations.list({ limit: 500 });
  const summary = {
    checked: 0,
    matched: 0,
    unmatched: 0,
    /** Provisional reservations this run brought into being. */
    created: 0,
    /** Occupancy that already had one, which is what a second run looks like. */
    alreadyHeld: 0,
    /** Calendar entries that could be either of two stays. Never merged. */
    ambiguous: 0,
    missing: 0,
    vanished: 0,
    feeds: [],
    errors: [],
    provisional: [],
  };

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
    summary.vanished += result.vanished.length;
    summary.feeds.push({ url: feed.url, room: feed.room ?? null, ...countsOf(result) });

    for (const occupancy of result.unmatched) {
      if (occupancy.ambiguous) {
        // Two reservations answer to this calendar entry. Creating a third, or
        // picking one, would both be guesses; a person is told instead.
        summary.ambiguous++;
        await raiseAlert({
          store,
          key: `ical-ambiguous:${occupancy.uid ?? `${occupancy.room}:${occupancy.check_in}`}`,
          kind: 'occupancy-ambiguous',
          severity: 'action',
          detail: {
            message: 'Più prenotazioni corrispondono allo stesso evento del calendario: nessuna unione automatica.',
            ...occupancy,
            feed: feed.url,
          },
        });
        continue;
      }

      let held = null;
      if (create) {
        const outcome = await createProvisional({ store, occupancy, feed, now });
        held = outcome.reservation ?? null;
        if (outcome.action === 'created') {
          summary.created++;
          // So the next feed in this same run matches it instead of making another.
          reservations.push(held);
          summary.provisional.push({
            reservation_id: held.id,
            room: held.room || null,
            check_in: held.check_in,
            check_out: held.check_out,
            incomplete: incompleteFields(held),
          });
        } else {
          summary.alreadyHeld++;
        }
      }

      await raiseAlert({
        store,
        key: `ical-unmatched:${occupancy.uid ?? `${occupancy.room}:${occupancy.check_in}`}`,
        kind: 'occupancy-not-synchronised',
        severity: 'action',
        detail: {
          message: held
            ? 'Prenotazione provvisoria creata dal calendario. Dati ospite da completare.'
            : 'Prenotazione o occupazione rilevata dal calendario, ma non sincronizzata.',
          ...occupancy,
          reservation_id: held?.id ?? null,
          incomplete: held ? incompleteFields(held) : null,
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

    for (const gone of result.vanished) {
      await raiseAlert({
        store,
        key: `ical-vanished:${gone.reservation_id}`,
        kind: 'occupancy-vanished',
        severity: 'warning',
        detail: {
          message: 'L’evento del calendario che ha creato questa prenotazione non c’è più. '
            + 'Nessuna cancellazione automatica: verificare sul canale.',
          ...gone,
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
  vanished: result.vanished.length,
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

/**
 * Look at one feed without touching anything.
 *
 * The staff-triggered half of `inspectIcal`: fetch the URL, report its shape, write
 * nothing. It is how a real QuoVai feed gets understood before it is trusted.
 */
export async function inspectFeeds({ feeds = [], fetchText = defaultFetchText }) {
  if (feeds.length === 0) return { ok: false, reason: 'no-feeds-configured' };
  const results = [];
  for (const feed of feeds) {
    try {
      results.push({ url: feed.url, room: feed.room ?? null, ok: true, ...inspectIcal(await fetchText(feed.url)) });
    } catch (error) {
      results.push({ url: feed.url, room: feed.room ?? null, ok: false, message: String(error.message ?? error) });
    }
  }
  return { ok: true, feeds: results };
}
