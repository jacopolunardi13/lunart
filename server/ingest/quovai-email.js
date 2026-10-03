/**
 * Reading a QuoVai notification.
 *
 * QuoVai already emails LunArt whenever an OTA booking lands, changes or is called
 * off. That email is a real, verified source of reservations today, which is why it
 * is the first adapter: it needs nothing from QuoVai that LunArt does not already
 * receive.
 *
 * It is also somebody else's email template, so this parser is written to be
 * forgiving about everything except meaning:
 *
 *   - plain text and HTML both work; the HTML is flattened to lines first;
 *   - labels are matched by a set of aliases, because "Check-in", "Check in" and
 *     "Arrivo" are the same question;
 *   - a value may sit after a colon, after a pipe from a table cell, or on the next
 *     line, which is what a two-column table becomes once flattened;
 *   - Italian dates and Italian money are read as Italian: 12/10/2026 is October,
 *     and 1.234,50 is one thousand two hundred thirty-four and a half.
 *
 * What it will not do is guess. A notification whose booking number or dates cannot
 * be read is returned as a failure with a reason, so it lands in front of staff
 * instead of creating a reservation with a plausible-looking stay in it.
 */

import { createHash } from 'node:crypto';

/** What kind of notification this is. */
export const QUOVAI_KINDS = { new: 'new', modified: 'modified', cancelled: 'cancelled' };

const SUBJECT_MARKERS = [
  { kind: 'cancelled', patterns: [/⛔/, /\bcancellazione\b/i, /\bcancellation\b/i] },
  { kind: 'modified', patterns: [/🔄/, /\bmodifica\b/i, /\bmodification\b/i, /\bmodified\b/i] },
  { kind: 'new', patterns: [/🔔/, /\bprenotazione\b/i, /\breservation\b/i, /\bnew booking\b/i] },
];

const BODY_MARKERS = [
  { kind: 'cancelled', patterns: [/\bCANCELLED\b/, /\bCANCELLATA\b/i] },
  { kind: 'modified', patterns: [/\bMODIFIED\b/, /\bMODIFICATA\b/i] },
  { kind: 'new', patterns: [/\bNEW\b/, /\bNUOVA\b/i] },
];

const LABELS = {
  booking_reference: ['numero prenotazione', 'n. prenotazione', 'numero di prenotazione', 'codice prenotazione', 'booking number', 'reservation number'],
  property: ['struttura', 'property'],
  channel: ['agenzia', 'canale', 'agenzia/canale', 'agency', 'channel', 'portale'],
  first_name: ['nome', 'first name', 'nome ospite'],
  last_name: ['cognome', 'last name', 'cognome ospite'],
  guest: ['ospite', 'cliente', 'guest', 'guest name', 'nominativo'],
  check_in: ['check-in', 'check in', 'checkin', 'arrivo', 'data di arrivo', 'arrival'],
  check_out: ['check-out', 'check out', 'checkout', 'partenza', 'data di partenza', 'departure'],
  total_amount: ['prezzo totale', 'totale', 'importo totale', 'total price', 'total'],
  adults: ['adulti', 'adults'],
  children: ['bambini', 'children', 'bimbi'],
  guest_phone: ['telefono', 'tel', 'phone', 'cellulare'],
  guest_email: ['e-mail', 'email', 'mail', 'indirizzo e-mail'],
  booked_at: ['data prenotazione', 'data della prenotazione', 'booking date', 'created'],
  source_updated_at: ['data ultima modifica', 'ultima modifica', 'last modified', 'modified at'],
  room: ['camera', 'alloggio', 'unità', 'unita', 'room', 'accommodation'],
  rate: ['tariffa', 'trattamento', 'piano tariffario', 'rate', 'rate plan'],
  notes: ['note', 'richieste', 'richieste speciali', 'notes', 'special requests'],
};

const MONTHS = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7,
  agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
};

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&euro;': '€', '&eacute;': 'é', '&agrave;': 'à',
};

/** HTML to lines, keeping the table structure as separators rather than losing it. */
export function flatten(input = '') {
  let out = String(input);
  if (/<[a-z!/][\s\S]*>/i.test(out)) {
    out = out
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
      .replace(/<\/(td|th)>/gi, ' | ')
      .replace(/<[^>]+>/g, ' ');
  }
  out = out.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
  for (const [entity, char] of Object.entries(ENTITIES)) out = out.split(entity).join(char);
  return out
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').replace(/ {2,}/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The value for a label.
 *
 * Looks for it after a colon or a table pipe on the same line, and failing that on
 * the next line — which is what a label-above-value table looks like once it has
 * been flattened.
 */
export function fieldOf(textBody, aliases) {
  const lines = textBody.split('\n');
  // Longest alias first, so "Agenzia/Canale" is read as itself rather than as
  // "Agenzia" followed by rubbish.
  const ordered = [...aliases].sort((a, b) => b.length - a.length);

  for (const alias of ordered) {
    // The label has to be the whole line, or be followed by a colon or a table
    // pipe. Without that, "Camera 303" answers the question "Camera?" with "303 —
    // Superior | Tariffa: ..." and every later field is wrong.
    const head = new RegExp(`^\\s*\\|?\\s*${escapeRe(alias)}\\s*(?:[:|]\\s*(.*))?$`, 'i');
    for (let i = 0; i < lines.length; i++) {
      const match = head.exec(lines[i]);
      if (!match) continue;
      const inline = (match[1] ?? '').replace(/^[|:\s]+/, '').replace(/\|.*$/, '').trim();
      if (inline) return inline;
      const next = (lines[i + 1] ?? '').replace(/^[|:\s]+/, '').replace(/\|.*$/, '').trim();
      // A label whose next line is another label has no value of its own.
      if (next && !isLabelLine(next)) return next;
    }
  }

  // Then anywhere in a line, for the rows that carry two fields at once:
  // "Camera 303 — Superior | Tariffa: standard non rimborsabile".
  for (const alias of ordered) {
    const inside = new RegExp(`${escapeRe(alias)}\\s*[:|]\\s*([^|\\n]+)`, 'i');
    for (const line of lines) {
      const match = inside.exec(line);
      if (match?.[1]?.trim()) return match[1].trim();
    }
  }
  return '';
}

function isLabelLine(line) {
  const bare = line.replace(/[:|].*$/, '').trim().toLowerCase();
  return Object.values(LABELS).some((aliases) => aliases.includes(bare));
}

/** dd/mm/yyyy, yyyy-mm-dd, 12 ottobre 2026 — all to YYYY-MM-DD. */
export function parseItalianDate(input = '') {
  const value = String(input).trim();
  if (!value) return null;

  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const numeric = /(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/.exec(value);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const named = /(\d{1,2})\s+([a-zà-ú]+)\.?\s+(\d{4})/i.exec(value);
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    if (!month) return null;
    return `${named[3]}-${String(month).padStart(2, '0')}-${String(Number(named[1])).padStart(2, '0')}`;
  }
  return null;
}

/** "1.234,50 €" → 123450 eurocents. Italian separators, and no floats on the way. */
export function parseMoney(input = '') {
  const value = String(input).replace(/[^\d.,-]/g, '');
  if (!value) return null;
  const normalised = value.includes(',')
    ? value.replace(/\./g, '').replace(',', '.')
    : value;
  const amount = Number(normalised);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

const wholeNumber = (input) => {
  const match = /\d+/.exec(String(input ?? ''));
  return match ? Number(match[0]) : null;
};

/** Which notification this is, from the subject and from the body, in that order. */
export function kindOf({ subject = '', body = '' }) {
  for (const { kind, patterns } of BODY_MARKERS) {
    if (patterns.some((p) => p.test(body))) return kind;
  }
  for (const { kind, patterns } of SUBJECT_MARKERS) {
    if (patterns.some((p) => p.test(subject))) return kind;
  }
  return null;
}

/** Does this look like a QuoVai notification at all? */
export function isQuovaiMessage({ subject = '', from = '', body = '' } = {}) {
  const haystack = `${subject}\n${from}`;
  if (/quovai/i.test(haystack)) return true;
  if (/\blunart\b/i.test(subject) && kindOf({ subject, body })) return true;
  return /numero prenotazione/i.test(body) && /\bstruttura\b/i.test(body);
}

/** Split "Mario Rossi" into a first and last name without pretending to be clever. */
function splitName(full) {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: '', last_name: '' };
  if (parts.length === 1) return { first_name: '', last_name: parts[0] };
  return { first_name: parts.slice(0, -1).join(' '), last_name: parts[parts.length - 1] };
}

/** A stable id for a message that arrived without one. */
export const fingerprint = (parts) =>
  `quovai:${createHash('sha256').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 32)}`;

/**
 * Turn one QuoVai email into a canonical reservation event.
 *
 * The returned `event` is the shape `server/reservations.js` expects, plus `kind`
 * so the caller knows whether this creates, changes or cancels. Nothing is
 * defaulted into existence: a field that was not in the email is absent, and the
 * upsert leaves whatever we already hold alone.
 */
export function parseQuovaiEmail({ subject = '', from = '', body = '', html = '', messageId = '', receivedAt = null } = {}) {
  const textBody = flatten(html || body);
  const kind = kindOf({ subject, body: textBody });

  if (!kind) return { ok: false, reason: 'not-a-quovai-notification' };

  const get = (key) => fieldOf(textBody, LABELS[key]);
  const warnings = [];

  const booking_reference = get('booking_reference').replace(/\s+/g, '');
  if (!booking_reference) return { ok: false, reason: 'no-booking-reference', kind };

  const check_in = parseItalianDate(get('check_in'));
  const check_out = parseItalianDate(get('check_out'));
  if (kind !== 'cancelled' && (!check_in || !check_out)) {
    return { ok: false, reason: 'unreadable-dates', kind, booking_reference };
  }
  if (check_in && check_out && check_out < check_in) {
    return { ok: false, reason: 'checkout-before-checkin', kind, booking_reference };
  }

  let first_name = get('first_name');
  let last_name = get('last_name');
  if (!last_name) {
    const combined = splitName(get('guest'));
    first_name = first_name || combined.first_name;
    last_name = combined.last_name;
  }
  if (!last_name) warnings.push('no-guest-name');

  const guest_email = get('guest_email').toLowerCase();
  if (!guest_email) warnings.push('no-guest-email');

  const adults = wholeNumber(get('adults'));
  const children = wholeNumber(get('children'));
  const room = roomOf(textBody, get('room'));

  const event = {
    kind,
    source: 'quovai',
    booking_reference,
    source_reference: get('booking_reference').replace(/\s+/g, ''),
    channel: get('channel'),
    first_name,
    last_name,
    guest_email,
    guest_phone: get('guest_phone').replace(/\s+/g, ' ').trim(),
    check_in,
    check_out,
    adults: adults ?? 0,
    children: children ?? 0,
    guest_count: (adults ?? 0) + (children ?? 0),
    room,
    rate: get('rate'),
    total_amount: parseMoney(get('total_amount')),
    notes: get('notes'),
    booked_at: parseItalianDate(get('booked_at')),
    source_updated_at: parseItalianDate(get('source_updated_at')),
    /** What makes processing idempotent. A real Message-Id if there is one. */
    message_id: messageId || fingerprint([subject, booking_reference, kind, get('source_updated_at'), check_in, check_out]),
    received_at: receivedAt ?? new Date().toISOString(),
    property: get('property'),
  };

  return { ok: true, kind, event, warnings };
}

/**
 * The room, from the label or from the tariff row.
 *
 * LunArt's rooms are numbered 301 to 305, and the room row in these emails carries
 * the number somewhere in it. Anything else is left empty for staff to fill rather
 * than guessed from a category name.
 */
function roomOf(textBody, labelled) {
  const fromLabel = /\b(30[1-6])\b/.exec(labelled ?? '');
  if (fromLabel) return fromLabel[1];
  const rows = textBody.split('\n').filter((line) => /camera|room|alloggio/i.test(line));
  for (const row of rows) {
    const match = /\b(30[1-6])\b/.exec(row);
    if (match) return match[1];
  }
  return '';
}

export { LABELS };
