/**
 * Real QuoVai notifications, as they actually arrive.
 *
 * Transcribed from the live LunArt mailbox in October 2026 — the structure is
 * theirs, the names and numbers are the four reservations that were really in the
 * staging store. The parser was written against a shape nobody had seen yet and
 * got two things wrong on contact with the real thing: the guest name carries no
 * label, and the room number is in the table's data rather than beside the word
 * "Camera". Both are reproduced here exactly, so neither can quietly come back.
 *
 * The operational messages are real too. The same mailbox carries them, they are
 * not reservations, and they must not reach the parser at all.
 */

/** The shape every reservation notification takes. */
const notification = ({ reference, status, name, room, rate, from, to, channel, total, quantity = 1 }) => `
Numero prenotazione: ${reference} ${status}

${name}

Struttura: LUNART
Agenzia/Canale: ${channel}
Check-in: ${from}
Check-out: ${to}
Adulti: 2
Bambini: 0

Stanza
Tariffa
Camera
Check-in
Check-out
Quantità
Prezzo totale
Stato

${room}
${rate}

${from.slice(0, 5)}
${to.slice(0, 5)}
${quantity}
${total}
${status.toLowerCase()}
`.trim();

/** Martin Markert — room 304, Booking.com, a modification. */
export const MARTIN = {
  subject: '🔄 QuoVai — prenotazione modificata',
  from: 'QuoVai <noreply@quovai.com>',
  messageId: '<quovai-6230618454-mod@quovai.com>',
  body: notification({
    reference: '6230618454', status: 'MODIFIED', name: 'Martin Markert',
    room: '304 queen std', rate: '304 queen std /NR BB OTA',
    from: '02/10/2026', to: '03/10/2026', channel: 'BOOKING.COM', total: '142,00',
  }),
};

/** Kelly Kay — room 305, Booking.com, new. */
export const KELLY = {
  subject: '🔔 QuoVai — nuova prenotazione',
  from: 'QuoVai <noreply@quovai.com>',
  messageId: '<quovai-6213834462-new@quovai.com>',
  body: notification({
    reference: '6213834462', status: 'NEW', name: 'Kelly Kay',
    room: '305 sup', rate: '305 sup /NR BB OTA',
    from: '13/10/2026', to: '14/10/2026', channel: 'BOOKING.COM', total: '168,50',
  }),
};

/** Irene Cappellini — room 302, Booking.com, new. */
export const IRENE = {
  subject: '🔔 QuoVai — nuova prenotazione',
  from: 'QuoVai <noreply@quovai.com>',
  messageId: '<quovai-6703524869-new@quovai.com>',
  body: notification({
    reference: '6703524869', status: 'NEW', name: 'Irene Cappellini',
    room: '302 queen std', rate: '302 queen std /NR BB OTA',
    from: '07/11/2026', to: '08/11/2026', channel: 'BOOKING.COM', total: '175,86',
  }),
};

/** Florian Tinsley — room 305, Expedia, new, four nights. */
export const FLORIAN = {
  subject: '🔔 QuoVai — nuova prenotazione',
  from: 'QuoVai <noreply@quovai.com>',
  messageId: '<quovai-2568875469-new@quovai.com>',
  body: notification({
    reference: '2568875469', status: 'NEW', name: 'Florian Tinsley',
    room: '305 sup', rate: '305 sup /Tariffa Expedia NR',
    from: '29/05/2027', to: '02/06/2027', channel: 'EXPEDIA', total: '612,40', quantity: 4,
  }),
};

/** The same stay, called off. */
export const IRENE_CANCELLED = {
  subject: '⛔ QuoVai — cancellazione',
  from: 'QuoVai <noreply@quovai.com>',
  messageId: '<quovai-6703524869-cancel@quovai.com>',
  body: notification({
    reference: '6703524869', status: 'CANCELLED', name: 'Irene Cappellini',
    room: '302 queen std', rate: '302 queen std /NR BB OTA',
    from: '07/11/2026', to: '08/11/2026', channel: 'BOOKING.COM', total: '175,86',
  }),
};

/**
 * Bina Kang — seven adults across four rooms, Booking.com, new.
 *
 * The notification that proved the parser was reading one room and calling it the
 * room. Its principal table lists 305, 302, 303 and 304 in the order QuoVai sends
 * them, and the per-night price table underneath repeats all four of those numbers
 * once per night — so a reader that simply looked for room numbers after the first
 * heading would find them twice, and one that stopped at the first would tell a
 * party of seven they were in 305.
 *
 * The totals are in the same places as the single-room shape, including one that
 * reads `302,00`: a number that is a price in this table and a room number
 * anywhere else, which is exactly the collision the row rules have to survive.
 */
export const BINA = {
  subject: '🔔 QuoVai — nuova prenotazione',
  from: 'QuoVai <noreply@quovai.com>',
  messageId: '<quovai-5639466196-new@quovai.com>',
  body: `
Numero prenotazione: 5639466196 NEW

Bina Kang

Struttura: LUNART
Agenzia/Canale: BOOKING.COM
Check-in: 25/10/2026
Check-out: 27/10/2026
Adulti: 7
Bambini: 0

Stanza
Tariffa
Camera
Check-in
Check-out
Quantità
Prezzo totale
Stato

305 sup
305 sup /NR BB OTA
25/10
27/10
2
336,00
new

302 queen std
302 queen std /NR BB OTA
25/10
27/10
2
302,00
new

303 sup
303 sup /NR BB OTA
25/10
27/10
2
336,00
new

304 queen std
304 queen std /NR BB OTA
25/10
27/10
2
308,00
new

Data
Stanza
Prezzo
25/10/2026
305
168,00
25/10/2026
302
151,00
25/10/2026
303
168,00
25/10/2026
304
154,00
26/10/2026
305
168,00
26/10/2026
302
151,00
26/10/2026
303
168,00
26/10/2026
304
154,00

Prezzo totale: 1.282,00
`.trim(),
};

export const REAL_RESERVATIONS = [MARTIN, KELLY, IRENE, FLORIAN];

/** The same booking as a modification, with the rooms listed in another order. */
export const BINA_MODIFIED = {
  subject: '🔄 QuoVai — prenotazione modificata',
  from: 'QuoVai <noreply@quovai.com>',
  messageId: '<quovai-5639466196-mod@quovai.com>',
  body: BINA.body
    .replace('5639466196 NEW', '5639466196 MODIFIED')
    .replace(/\bnew\b/g, 'modified'),
};

/* ── The same mailbox, carrying things that are not reservations ───────────── */

/** The police forms waiting to be filed. Operational, and not a stay. */
export const SCHEDINE = {
  subject: '8 schedine da inviare per LunArt',
  from: 'QuoVai <noreply@quovai.com>',
  messageId: '<quovai-schedine-8@quovai.com>',
  body: `
Ciao,
ci sono 8 schedine da inviare per LunArt.

Accedi a QuoVai per completare l'invio ad Alloggiati Web.
`.trim(),
};

export const SCHEDINE_14 = {
  ...SCHEDINE,
  subject: '14 schedine da inviare per LunArt',
  messageId: '<quovai-schedine-14@quovai.com>',
  body: SCHEDINE.body.replace('8 schedine', '14 schedine'),
};

/**
 * A guest finished the online check-in.
 *
 * The subject carries the word "prenotazione" and a number, which is exactly why
 * the old classifier took it for a reservation notification: it is not one, and
 * nothing in it was ever going to parse.
 */
export const ONLINE_CHECKIN = {
  subject: 'LunArt: check-in online effettuato per prenotazione 1308918 (Pelicic)',
  from: 'QuoVai <noreply@quovai.com>',
  messageId: '<quovai-checkin-1308918@quovai.com>',
  body: `
Il check-in online per la prenotazione 1308918 (Pelicic) è stato completato.

Puoi vedere i dati inseriti dall'ospite in QuoVai.
`.trim(),
};

export const OPERATIONAL = [SCHEDINE, SCHEDINE_14, ONLINE_CHECKIN];

/**
 * A genuine reservation notification that is broken.
 *
 * It says what it is — a booking number, a status, the property — and then fails
 * to give a date anyone can read. This one must still reach staff: a guest is
 * arriving whether or not the email parsed.
 */
export const MALFORMED = {
  subject: '🔔 QuoVai — nuova prenotazione',
  from: 'QuoVai <noreply@quovai.com>',
  messageId: '<quovai-broken-1@quovai.com>',
  body: `
Numero prenotazione: 9999000111 NEW

Sconosciuto Ospite

Struttura: LUNART
Agenzia/Canale: BOOKING.COM
Check-in: ------
Check-out: ------
`.trim(),
};
