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

/**
 * The subject, when it says outright what happened.
 *
 * `prenotazione` on its own used to be enough for "new", which made every
 * "check-in online effettuato per prenotazione 1308918" a reservation. A subject
 * now has to pair the word with something that happened to it, or carry QuoVai's
 * own emoji.
 */
const SUBJECT_MARKERS = [
  { kind: 'cancelled', patterns: [/⛔/, /\bcancellazione\b/i, /\bcancellation\b/i, /prenotazione\s+cancellata/i, /booking\s+cancell(?:ed|ation)/i] },
  { kind: 'modified', patterns: [/🔄/, /\bmodifica\s+(?:della\s+)?prenotazione\b/i, /prenotazione\s+modificata/i, /booking\s+modifi(?:ed|cation)/i] },
  { kind: 'new', patterns: [/🔔/, /\bnuova\s+prenotazione\b/i, /prenotazione\s+confermata/i, /\bnew\s+(?:booking|reservation)\b/i] },
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
  // QuoVai states it outright, next to the booking number. Nothing beats that.
  const beside = splitReference(fieldOf(body, LABELS.booking_reference)).status;
  if (beside) return beside;

  for (const { kind, patterns } of BODY_MARKERS) {
    if (patterns.some((p) => p.test(body))) return kind;
  }
  for (const { kind, patterns } of SUBJECT_MARKERS) {
    if (patterns.some((p) => p.test(subject))) return kind;
  }
  return null;
}

/**
 * Operational QuoVai mail: real, useful, and not a reservation.
 *
 * The same mailbox carries the police forms waiting to be filed and a note every
 * time a guest finishes the online check-in. They are not stays and they were
 * never going to parse as one, so the old pipeline turned each of them into
 * "Notifica non interpretabile" and put it in front of staff — which is how a
 * warning list becomes something nobody reads.
 *
 * These patterns only ever decide what to IGNORE. Anything carrying the structure
 * of a reservation notification is handled as one even if it also matches here,
 * because a real notification mentioning an online check-in must not disappear.
 */
const OPERATIONAL_MARKERS = [
  { reason: 'schedine', pattern: /\bschedin[ae]\b/i },
  { reason: 'online-check-in', pattern: /check-?in\s+online|online\s+check-?in/i },
  { reason: 'alloggiati', pattern: /\balloggiati\s*web\b/i },
  { reason: 'istat', pattern: /\bistat\b/i },
  { reason: 'review', pattern: /\brecensione\b|\bnuova recensione\b/i },
  { reason: 'invoice', pattern: /\bfattura\b|\bfatturazione\b/i },
];

/**
 * Does this message carry the structure of a reservation notification?
 *
 * Not "did it parse" — structure. A notification whose dates are unreadable is
 * still a notification, and staff have to hear about it; an email about eight
 * police forms is not one however badly it reads. The two cases need different
 * answers, so they need to be asked apart.
 *
 * The structure is the booking-number label, or a subject that says in so many
 * words that a reservation was made, changed or called off. A bare "prenotazione"
 * in a subject is not enough — "check-in online effettuato per prenotazione
 * 1308918" contains it and is an operational notice.
 */
function hasReservationStructure({ subject = '', body = '' }) {
  if (fieldOf(body, LABELS.booking_reference)) return true;
  return SUBJECT_MARKERS.some(({ patterns }) => patterns.some((p) => p.test(subject)));
}

/**
 * What to do with one message from the reservation mailbox.
 *
 *   relevant: true   → the reservation parser, and a warning if it will not read
 *   relevant: false  → nothing at all, quietly
 *
 * Sender alone decides nothing. Everything QuoVai sends comes from QuoVai.
 */
export function classifyQuovaiMessage({ subject = '', from = '', body = '', html = '' } = {}) {
  const text = flatten(html || body);
  const fromQuovai = /quovai/i.test(`${subject}\n${from}`);

  // Structure first, always: it is the only thing that can say "this is a stay".
  if (hasReservationStructure({ subject, body: text })) {
    return { relevant: true, kind: kindOf({ subject, body: text }) };
  }

  if (!fromQuovai && !/\blunart\b/i.test(subject)) {
    return { relevant: false, reason: 'not-from-the-reservation-mailbox' };
  }

  const operational = OPERATIONAL_MARKERS.find(({ pattern }) => pattern.test(subject) || pattern.test(text));
  if (operational) return { relevant: false, reason: 'operational-notice', notice: operational.reason };

  return { relevant: false, reason: 'not-a-reservation-notification' };
}

/** Kept for callers that only want the yes-or-no. */
export function isQuovaiMessage(message = {}) {
  return classifyQuovaiMessage(message).relevant;
}

/**
 * Particles that belong to the surname they precede.
 *
 * "Maria Teresa Di Napoli" is Maria Teresa, surname Di Napoli — not Maria Teresa
 * Di, surname Napoli. Taking the last word alone is right for most names and
 * visibly wrong for these, and they are common enough in an Italian guest list to
 * be worth the twelve words.
 */
const NAME_PARTICLES = new Set([
  'di', 'de', 'del', 'della', 'dello', 'dei', 'degli', 'delle', 'da', 'dal', 'dalla',
  'la', 'le', 'lo', 'van', 'von', 'der', 'den', 'ter', 'ten', 'af', 'av',
  'du', 'des', 'el', 'al', 'bin', 'ibn', 'mac', 'mc', 'o’', "o'", 'st', 'san',
]);

/**
 * Split a full name into a first and a last without pretending to be clever.
 *
 * One word is a surname. Two are a first and a last. More than two take the last
 * word plus any particles immediately before it, which is as much cleverness as a
 * guest list deserves — the whole name is kept either way, so nothing is lost if
 * the split lands in the wrong place.
 */
function splitName(full) {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: '', last_name: '' };
  if (parts.length === 1) return { first_name: '', last_name: parts[0] };

  let cut = parts.length - 1;
  while (cut > 1 && NAME_PARTICLES.has(parts[cut - 1].toLowerCase().replace(/\.$/, ''))) cut--;
  return { first_name: parts.slice(0, cut).join(' '), last_name: parts.slice(cut).join(' ') };
}

/** The status words QuoVai puts beside the booking number. Never a guest's name. */
const STATUS_WORDS = /^(new|modified|cancelled|canceled|nuova|modificata|cancellata|confermata|confirmed)$/i;

/** Is this word one of them? Used where a lone status word has to be recognised. */
export const isStatusWord = (value = '') => STATUS_WORDS.test(String(value).trim());

/** Which notification a status word beside the booking number means. */
const STATUS_KIND = {
  new: 'new', nuova: 'new', confermata: 'new', confirmed: 'new',
  modified: 'modified', modificata: 'modified',
  cancelled: 'cancelled', canceled: 'cancelled', cancellata: 'cancelled',
};

/**
 * The booking number, without the word printed next to it.
 *
 * QuoVai writes the status on the same line: "Numero prenotazione: 6703524869 NEW".
 * Taking the whole value and squeezing the spaces out filed that stay under
 * "6703524869NEW" — so the same booking arriving later as MODIFIED became a second
 * reservation under "6703524869MODIFIED", and neither number was one a guest could
 * read back. The reference is what it says it is; the status is read separately.
 */
export function splitReference(raw = '') {
  const words = String(raw).trim().split(/\s+/).filter(Boolean);
  let status = null;
  while (words.length > 1 && STATUS_WORDS.test(words[words.length - 1])) {
    status = STATUS_KIND[words.pop().toLowerCase()] ?? status;
  }
  return { reference: words.join(''), status };
}

/**
 * The guest name, when QuoVai does not label it.
 *
 * The real notifications put the name on its own line directly under the booking
 * number and directly above the field block:
 *
 *     Numero prenotazione: 6703524869 NEW
 *     Irene Cappellini
 *     Struttura: LUNART
 *
 * So that is exactly where this looks, and nowhere else. It starts at the booking
 * reference line, stops at the first labelled field, and in between accepts only a
 * line that could be a name: letters, no digits, no colon, no pipe, not a status
 * word, not the property's own name. A line that fails any of those is skipped
 * rather than guessed at — an email with no name is worth a warning, and a
 * reservation filed under "Struttura" is not.
 */
export function unlabelledName(textBody, { property = '' } = {}) {
  const lines = textBody.split('\n');
  const anchor = lines.findIndex((line) => LABELS.booking_reference.some(
    (alias) => new RegExp(`^\\s*\\|?\\s*${escapeRe(alias)}\\s*[:|]`, 'i').test(line),
  ));
  if (anchor < 0) return '';

  // Five lines is the whole gap in every real example; beyond that we are guessing.
  for (let i = anchor + 1; i < Math.min(lines.length, anchor + 6); i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // The field block has started: the name was not there.
    if (isLabelLine(line) || /[:|]/.test(line)) return '';
    if (!looksLikeName(line)) continue;
    if (property && line.toLowerCase() === property.toLowerCase()) continue;
    return line.replace(/\s+/g, ' ');
  }
  return '';
}

/** Letters, spaces and the punctuation names actually contain. Nothing else. */
function looksLikeName(line) {
  if (line.length < 2 || line.length > 80) return false;
  if (STATUS_WORDS.test(line)) return false;
  if (!/^[\p{L}][\p{L}\p{M}'’\-. ]*$/u.test(line)) return false;
  const words = line.split(/\s+/);
  return words.length >= 1 && words.length <= 5;
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

  const { reference: booking_reference } = splitReference(get('booking_reference'));
  if (!booking_reference) return { ok: false, reason: 'no-booking-reference', kind };

  const check_in = parseItalianDate(get('check_in'));
  const check_out = parseItalianDate(get('check_out'));
  if (kind !== 'cancelled' && (!check_in || !check_out)) {
    return { ok: false, reason: 'unreadable-dates', kind, booking_reference };
  }
  if (check_in && check_out && check_out < check_in) {
    return { ok: false, reason: 'checkout-before-checkin', kind, booking_reference };
  }

  const property = get('property');

  let first_name = get('first_name');
  let last_name = get('last_name');
  if (!last_name) {
    const combined = splitName(get('guest'));
    first_name = first_name || combined.first_name;
    last_name = combined.last_name;
  }
  // QuoVai's own notifications carry no label at all: the name is simply the line
  // under the booking number. Labelled wins; this only fills a gap.
  if (!last_name) {
    const combined = splitName(unlabelledName(textBody, { property }));
    first_name = first_name || combined.first_name;
    last_name = combined.last_name;
  }
  if (!last_name) warnings.push('no-guest-name');

  const guest_email = get('guest_email').toLowerCase();
  if (!guest_email) warnings.push('no-guest-email');

  const adults = wholeNumber(get('adults'));
  const children = wholeNumber(get('children'));
  const notes = get('notes');
  const room = roomOf(textBody, get('room'), { notes });
  if (!room) warnings.push('no-room');

  const event = {
    kind,
    source: 'quovai',
    booking_reference,
    source_reference: booking_reference,
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
    notes,
    booked_at: parseItalianDate(get('booked_at')),
    source_updated_at: parseItalianDate(get('source_updated_at')),
    /** What makes processing idempotent. A real Message-Id if there is one. */
    message_id: messageId || fingerprint([subject, booking_reference, kind, get('source_updated_at'), check_in, check_out]),
    received_at: receivedAt ?? new Date().toISOString(),
    property,
  };

  return { ok: true, kind, event, warnings };
}

/** The headers of QuoVai's room table, as they appear once the HTML is flattened. */
const ROOM_TABLE_HEADERS = ['stanza', 'camera', 'room', 'alloggio', 'unità', 'unita', 'accommodation'];

/**
 * The room, from the label or from the table.
 *
 * The real emails do not put the number next to the word "Camera". The table
 * flattens into its headers and then its data, and the number is in the data:
 *
 *     Stanza | Tariffa | Camera | Check-in | Check-out | Quantità | Prezzo | Stato
 *     302 queen std
 *     302 queen std /NR BB OTA
 *     07/11
 *     ...
 *
 * So the number is read from a row that *begins* with it, inside the window that
 * starts at the table's own header. Two bounds, both deliberate: a row has to lead
 * with the number, which "we are three adults, 305 would be lovely" does not, and
 * the search never leaves the table, which is what keeps a note out of it. LunArt
 * lets 301 to 305, with 306 expected; nothing outside that range is a room.
 */
function roomOf(textBody, labelled, { notes = '' } = {}) {
  const fromLabel = /\b(30[1-6])\b/.exec(labelled ?? '');
  if (fromLabel) return fromLabel[1];

  const lines = textBody.split('\n');
  const bare = (line) => line.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

  // The table's window: from its first header, far enough to cover the data rows.
  const header = lines.findIndex((line) => ROOM_TABLE_HEADERS.includes(bare(line)));
  if (header >= 0) {
    for (const line of lines.slice(header, header + 30)) {
      const match = /(?:^|\|)\s*(30[1-6])\b/.exec(line);
      if (match) return match[1];
    }
  }

  /**
   * No table header: a plain-text notification, or one laid out some other way.
   *
   * The leading-number rule still holds, and the notes are excluded outright —
   * whatever a guest wrote in a request field is prose, and prose is the one place
   * a number in this range would mean something else.
   */
  const noteLines = new Set(String(notes).split('\n').map((line) => line.trim()).filter(Boolean));
  for (const line of lines) {
    if (noteLines.has(line.trim())) continue;
    const match = /^\s*\|?\s*(30[1-6])\b\s+\S/.exec(line);
    if (match) return match[1];
  }

  // Last: a line that names a room and carries a number, which is the labelled
  // shape written without a colon.
  for (const line of lines) {
    if (noteLines.has(line.trim())) continue;
    if (!/\b(camera|room|stanza|alloggio)\b/i.test(line)) continue;
    const match = /\b(30[1-6])\b/.exec(line);
    if (match) return match[1];
  }
  return '';
}

export { LABELS };
