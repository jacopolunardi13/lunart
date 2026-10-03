/**
 * Reading QuoVai's notifications, and the calendar reconciliation behind them.
 *
 * The parser is tested against fixtures that look like the real thing — plain text,
 * an HTML table, Italian dates, Italian money, an OTA relay address — because the
 * failure that matters is not a crash. It is a notification that parses into a
 * plausible-looking reservation with the wrong dates in it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';

import {
  parseQuovaiEmail, isQuovaiMessage, kindOf, parseItalianDate, parseMoney, flatten, fieldOf,
} from '../server/ingest/quovai-email.js';
import { ingestMessage, ingestMessages } from '../server/ingest/index.js';
import { parseIcal, reconcile, reconcileFeeds, parseFeedConfig } from '../server/ingest/ical.js';
import { createQuovaiApiAdapter, reservationSources } from '../server/ingest/quovai-api.js';
import { createMemoryMailbox, createGmailMailbox, pollMailbox, createMailbox } from '../server/ingest/mailbox.js';
import { createStore } from '../server/store.js';
import { buildReservation } from '../server/reservations.js';

const fixtureUrl = (name) => new URL(`./fixtures/${name}`, import.meta.url);

/** The fixtures are stored as messages, headers and all, and split like one. */
async function fixture(name) {
  const raw = await readFile(fixtureUrl(name), 'utf8');
  const split = raw.indexOf('\n\n');
  const headers = Object.fromEntries(raw.slice(0, split).split('\n').map((line) => {
    const colon = line.indexOf(':');
    return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
  }));
  return {
    subject: headers.subject,
    from: headers.from,
    messageId: headers['message-id'],
    body: raw.slice(split + 2),
  };
}

const store = () => createStore();

/* ── Recognising one ─────────────────────────────────────────────────────── */

test('a QuoVai notification is recognised, and other mail is not', async () => {
  assert.equal(isQuovaiMessage(await fixture('quovai-new.eml')), true);
  assert.equal(isQuovaiMessage({ subject: 'Fattura elettronica', from: 'commercialista@example.com', body: 'Buongiorno' }), false);
  assert.equal(isQuovaiMessage({ subject: 'Newsletter', from: 'news@example.com', body: 'Offerte' }), false);
});

test('the kind comes from the body, and from the subject when it has to', () => {
  assert.equal(kindOf({ subject: '🔔 Prenotazione per LunArt', body: 'NEW' }), 'new');
  assert.equal(kindOf({ subject: '🔄 Modifica per LunArt', body: 'MODIFIED' }), 'modified');
  assert.equal(kindOf({ subject: '⛔ Cancellazione per LunArt', body: 'CANCELLED' }), 'cancelled');
  assert.equal(kindOf({ subject: '🔔 Prenotazione per LunArt', body: 'nessuna parola chiave' }), 'new');
  assert.equal(kindOf({ subject: 'Qualcosa', body: 'Qualcosa' }), null);
});

/* ── NEW ─────────────────────────────────────────────────────────────────── */

test('a NEW notification becomes a complete reservation event', async () => {
  const parsed = parseQuovaiEmail(await fixture('quovai-new.eml'));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.kind, 'new');

  const { event } = parsed;
  assert.equal(event.booking_reference, '5312447891');
  assert.equal(event.channel, 'Booking.com');
  assert.equal(event.first_name, 'Marta');
  assert.equal(event.last_name, 'Venturi');
  assert.equal(event.guest_email, 'marta.venturi.4h9k@guest.booking.com');
  assert.equal(event.guest_phone, '+39 348 112 4455');
  assert.equal(event.check_in, '2026-10-12');
  assert.equal(event.check_out, '2026-10-15');
  assert.equal(event.adults, 2);
  assert.equal(event.children, 0);
  assert.equal(event.room, '303');
  assert.equal(event.rate, 'standard non rimborsabile');
  assert.equal(event.total_amount, 48600);
  assert.equal(event.booked_at, '2026-09-28');
  assert.deepEqual(parsed.warnings, []);
});

test('an OTA relay address is kept exactly as it arrived', async () => {
  const { event } = parseQuovaiEmail(await fixture('quovai-new.eml'));
  assert.match(event.guest_email, /@guest\.booking\.com$/, 'the alias is the address that works');
});

test('a notification laid out as a table, with named dates, parses the same way', async () => {
  const { ok, event } = parseQuovaiEmail(await fixture('quovai-expedia-new.eml'));
  assert.equal(ok, true);
  assert.equal(event.booking_reference, 'EXP-77120934');
  assert.equal(event.channel, 'Expedia');
  assert.equal(event.check_in, '2026-11-05', '5 novembre 2026');
  assert.equal(event.check_out, '2026-11-07');
  assert.equal(event.total_amount, 124050, '1.240,50 € is Italian, not American');
  assert.equal(event.room, '302');
  assert.equal(event.children, 1);
  assert.equal(event.guest_count, 3);
});

/* ── MODIFIED and CANCELLED ──────────────────────────────────────────────── */

test('a MODIFIED notification in HTML parses, entities and all', async () => {
  const { ok, kind, event } = parseQuovaiEmail(await fixture('quovai-modified.eml'));
  assert.equal(ok, true);
  assert.equal(kind, 'modified');
  assert.equal(event.booking_reference, '5312447891', 'the same booking');
  assert.equal(event.check_out, '2026-10-17', 'the dates moved');
  assert.equal(event.adults, 3);
  assert.equal(event.room, '305');
  assert.equal(event.total_amount, 81000, '810,00 &euro; decoded');
  assert.equal(event.source_updated_at, '2026-10-02');
});

test('a CANCELLED notification parses without a full set of fields', async () => {
  const { ok, kind, event, warnings } = parseQuovaiEmail(await fixture('quovai-cancelled.eml'));
  assert.equal(ok, true);
  assert.equal(kind, 'cancelled');
  assert.equal(event.booking_reference, '5312447891');
  assert.equal(event.last_name, 'Venturi', 'read from a single "Ospite" line');
  assert.equal(event.first_name, 'Marta');
  assert.ok(warnings.includes('no-guest-email'), 'and it says what was missing');
});

/* ── Refusing rather than guessing ───────────────────────────────────────── */

test('a notification without a booking number is refused', () => {
  const result = parseQuovaiEmail({ subject: '🔔 Prenotazione per LunArt', body: 'NEW\nStruttura: LunArt' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-booking-reference');
});

test('a notification with unreadable dates is refused rather than filled in', () => {
  const result = parseQuovaiEmail({
    subject: '🔔 Prenotazione per LunArt',
    body: 'NEW\nNumero prenotazione: 123456\nCheck-in: prossimamente\nCheck-out: ?',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unreadable-dates');
});

test('a checkout before the check-in is refused', () => {
  const result = parseQuovaiEmail({
    subject: '🔔 Prenotazione per LunArt',
    body: 'NEW\nNumero prenotazione: 123456\nCheck-in: 12/10/2026\nCheck-out: 03/10/2026',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'checkout-before-checkin');
});

test('an unreadable notification becomes something staff have to look at', async () => {
  const db = store();
  const result = await ingestMessage({
    store: db,
    message: { subject: '🔔 Prenotazione per LunArt', body: 'NEW\nqualcosa è andato storto', messageId: '<broken@q>' },
  });
  assert.equal(result.ok, false);
  const alerts = await db.alerts.open();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'unreadable-notification');
});

/* ── The small parsers ───────────────────────────────────────────────────── */

test('Italian dates are read as Italian', () => {
  assert.equal(parseItalianDate('12/10/2026'), '2026-10-12');
  assert.equal(parseItalianDate('05.11.2026'), '2026-11-05');
  assert.equal(parseItalianDate('2026-10-12'), '2026-10-12');
  assert.equal(parseItalianDate('5 novembre 2026'), '2026-11-05');
  assert.equal(parseItalianDate('5 November 2026'), '2026-11-05');
  assert.equal(parseItalianDate('12/10/26'), '2026-10-12');
  assert.equal(parseItalianDate('presto'), null);
  assert.equal(parseItalianDate(''), null);
});

test('Italian money is read as Italian', () => {
  assert.equal(parseMoney('486,00 €'), 48600);
  assert.equal(parseMoney('1.240,50 €'), 124050);
  assert.equal(parseMoney('€ 90'), 9000);
  assert.equal(parseMoney('90.00'), 9000);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('gratis'), null);
});

test('a label is not matched inside another label', () => {
  const body = flatten('Agenzia/Canale: Booking.com\nCamera 303 - Superior | Tariffa: non rimborsabile');
  assert.equal(fieldOf(body, ['agenzia/canale', 'agenzia']), 'Booking.com');
  assert.equal(fieldOf(body, ['tariffa']), 'non rimborsabile');
});

/* ── The mailbox seam ────────────────────────────────────────────────────── */

test('a mailbox is just something that returns messages', async () => {
  const db = store();
  const mailbox = createMemoryMailbox([await fixture('quovai-new.eml'), await fixture('quovai-modified.eml')]);
  const result = await pollMailbox({ store: db, mailbox, ingest: ingestMessages });

  assert.equal(result.ok, true);
  assert.equal(result.created, 1);
  assert.equal(result.modified, 1);
  assert.equal((await db.reservations.list({})).length, 1, 'one booking, seen twice');
  assert.equal(mailbox.pending(), 0);
});

test('polling the same mailbox twice does not send a guest two guides', async () => {
  const db = store();
  const message = await fixture('quovai-new.eml');
  const mailbox = createMemoryMailbox([message]);
  await pollMailbox({ store: db, mailbox, ingest: ingestMessages });
  mailbox.push(message);
  const second = await pollMailbox({ store: db, mailbox, ingest: ingestMessages });

  assert.equal(second.duplicates, 1);
  assert.equal((await db.deliveries.list({})).length, 1, 'one scheduled email, not two');
});

test('the Gmail mailbox says it is not configured rather than returning nothing', async () => {
  const mailbox = createGmailMailbox({});
  assert.equal(mailbox.configured, false);
  await assert.rejects(() => mailbox.fetchMessages(), /not configured/);

  const db = store();
  const result = await pollMailbox({ store: db, mailbox, ingest: ingestMessages });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'source-not-configured');
});

test('no mailbox configured is an answer, not a crash', async () => {
  assert.equal(createMailbox({}), null);
  const result = await pollMailbox({ store: store(), mailbox: null, ingest: ingestMessages });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-mailbox-configured');
});

/* ── The API seam ────────────────────────────────────────────────────────── */

test('the QuoVai API adapter refuses everything until it is configured', async () => {
  const adapter = createQuovaiApiAdapter({});
  assert.equal(adapter.configured, false);
  assert.equal(adapter.verify('{}', 'anything'), false, 'nothing verifies without a secret');
  await assert.rejects(() => adapter.fetchChanges(), /not configured/);
  assert.ok(adapter.requires.includes('QUOVAI_WEBHOOK_SECRET'));
  assert.ok(adapter.openQuestions.length >= 3, 'the unknowns are written down');
});

test('a configured adapter verifies a signature and refuses a forged one', () => {
  const adapter = createQuovaiApiAdapter({ quovaiWebhookSecret: 'shhh' });
  assert.equal(adapter.configured, true);
  const body = '{"kind":"new","booking_reference":"1"}';
  const signature = createHmac('sha256', 'shhh').update(body).digest('hex');
  assert.equal(adapter.verify(body, signature), true);
  assert.equal(adapter.verify(body, `sha256=${signature}`), true);
  assert.equal(adapter.verify(body, signature.replace(/.$/, '0')), false);
  assert.equal(adapter.verify(`${body} `, signature), false, 'over the exact body');
});

test('an unmapped payload throws rather than inventing a reservation', () => {
  const adapter = createQuovaiApiAdapter({ quovaiWebhookSecret: 'shhh' });
  assert.throws(() => adapter.toEvent({ something: 'else' }), /not agreed/);
  assert.deepEqual(adapter.toEvent({ kind: 'NEW', booking_reference: 'A1' }), {
    kind: 'new', source: 'quovai', booking_reference: 'A1', message_id: undefined, raw_kept_for_mapping: true,
  });
});

test('every reservation source says whether it can actually be used', () => {
  const sources = reservationSources({});
  assert.equal(sources.find((s) => s.id === 'quovai-email').configured, true);
  assert.equal(sources.find((s) => s.id === 'quovai-api').configured, false);
  assert.equal(sources.find((s) => s.id === 'quovai-ical').configured, false);
  assert.equal(sources.find((s) => s.id === 'manual').configured, true);
});

/* ── iCal reconciliation ─────────────────────────────────────────────────── */

const ICAL = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//QuoVai//EN
BEGIN:VEVENT
UID:qv-5312447891@quovai
DTSTART;VALUE=DATE:20261012
DTEND;VALUE=DATE:20261015
SUMMARY:Prenotazione 5312447891 - camera 303
END:VEVENT
BEGIN:VEVENT
UID:qv-unknown@quovai
DTSTART;VALUE=DATE:20261020
DTEND;VALUE=DATE:20261022
SUMMARY:Camera 305 occupata
DESCRIPTION:Nessun dato ospite
END:VEVENT
BEGIN:VEVENT
UID:qv-blocked@quovai
DTSTART;VALUE=DATE:20261101
DTEND;VALUE=DATE:20261103
SUMMARY:Not available
END:VEVENT
END:VCALENDAR`;

test('an iCal feed parses into occupancy, with the end date read correctly', () => {
  const events = parseIcal(ICAL);
  assert.equal(events.length, 3);
  const [first] = events;
  assert.equal(first.uid, 'qv-5312447891@quovai');
  assert.equal(first.check_in, '2026-10-12');
  assert.equal(first.check_out, '2026-10-15');
  assert.equal(first.last_night, '2026-10-14', 'DTEND is the morning the room is free');
  assert.equal(first.booking_reference, '5312447891');
  assert.equal(first.room, '303');
  assert.equal(events[2].blocked, true, 'a block is not a guest');
});

test('folded iCal lines are unfolded before being read', () => {
  const folded = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a@b
DTSTART;VALUE=DATE:20261012
DTEND;VALUE=DATE:20261013
SUMMARY:Prenotazione 998877
 6655 - camera 301
END:VEVENT
END:VCALENDAR`;
  const [event] = parseIcal(folded);
  assert.equal(event.room, '301');
  assert.match(event.summary, /9988776655/);
});

test('an occupancy with no reservation behind it is the alert that matters', () => {
  const reservations = [buildReservation({
    source: 'quovai', booking_reference: '5312447891',
    check_in: '2026-10-12', check_out: '2026-10-15', room: '303',
  })];
  const result = reconcile({ events: parseIcal(ICAL), reservations, now: new Date('2026-10-01T10:00:00Z') });

  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 1);
  assert.equal(result.unmatched[0].uid, 'qv-unknown@quovai');
  assert.equal(result.unmatched[0].room, '305');
  assert.equal(result.missing.length, 0);
});

test('a reservation the feed does not show is flagged, not deleted', () => {
  const reservations = [buildReservation({
    source: 'quovai', booking_reference: 'NOT-IN-FEED',
    check_in: '2026-10-12', check_out: '2026-10-15', room: '301',
  })];
  const result = reconcile({ events: [], reservations, now: new Date('2026-10-01T10:00:00Z') });
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].booking_reference, 'NOT-IN-FEED');
});

test('a reservation typed in by staff is not expected to be in an OTA feed', () => {
  const reservations = [buildReservation({
    source: 'manual', booking_reference: 'MAN-1',
    check_in: '2026-10-12', check_out: '2026-10-15', room: '301',
  })];
  const result = reconcile({ events: [], reservations, now: new Date('2026-10-01T10:00:00Z') });
  assert.equal(result.missing.length, 0);
});

test('an occupancy matched only by room and dates still counts as matched', () => {
  const feed = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:no-ref@quovai
DTSTART;VALUE=DATE:20261012
DTEND;VALUE=DATE:20261015
SUMMARY:Camera 303
END:VEVENT
END:VCALENDAR`;
  const reservations = [buildReservation({
    source: 'quovai', booking_reference: 'WHATEVER',
    check_in: '2026-10-12', check_out: '2026-10-15', room: '303',
  })];
  const result = reconcile({ events: parseIcal(feed), reservations, now: new Date('2026-10-01T10:00:00Z') });
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
});

test('reconciling a feed leaves one alert per problem, however often it runs', async () => {
  const db = store();
  const feeds = [{ room: '303', url: 'https://feed.example/303.ics' }];
  const fetchText = async () => ICAL;

  const first = await reconcileFeeds({ store: db, feeds, fetchText, now: new Date('2026-10-01T10:00:00Z') });
  assert.equal(first.ok, true);
  assert.equal(first.unmatched, 2, 'both the 303 booking and the 305 occupancy are unaccounted for');

  const before = (await db.alerts.open()).length;
  await reconcileFeeds({ store: db, feeds, fetchText, now: new Date('2026-10-01T11:00:00Z') });
  const after = await db.alerts.open();
  assert.equal(after.length, before, 'the same problem is one alert, with a count');
  assert.ok(after.every((alert) => alert.seen >= 2));
});

test('an unreachable feed is an alert, not a silent failure', async () => {
  const db = store();
  const result = await reconcileFeeds({
    store: db,
    feeds: [{ room: '303', url: 'https://feed.example/303.ics' }],
    fetchText: async () => { throw new Error('ETIMEDOUT'); },
  });
  assert.equal(result.errors.length, 1);
  const alerts = await db.alerts.open();
  assert.equal(alerts[0].kind, 'ical-feed-unreachable');
});

test('no feeds configured is reported as such', async () => {
  const result = await reconcileFeeds({ store: store(), feeds: [] });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-feeds-configured');
});

test('feeds are configured as room:url pairs, or bare urls', () => {
  assert.deepEqual(parseFeedConfig('303:https://a.ics,305:https://b.ics'), [
    { room: '303', url: 'https://a.ics' },
    { room: '305', url: 'https://b.ics' },
  ]);
  assert.deepEqual(parseFeedConfig('https://all.ics'), [{ room: '', url: 'https://all.ics' }]);
  assert.deepEqual(parseFeedConfig(''), []);
});
