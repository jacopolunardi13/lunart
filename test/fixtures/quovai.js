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

export const REAL_RESERVATIONS = [MARTIN, KELLY, IRENE, FLORIAN];

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
