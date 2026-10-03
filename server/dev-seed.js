/**
 * Something to look at in the preview.
 *
 * The Staff app and the personal guide link are both about reservations, and an
 * empty store shows neither. So a preview server — and only a preview server —
 * feeds two obviously-invented QuoVai notifications through the real ingestion
 * path: the same parser, the same upsert, the same email scheduling. Nothing is
 * faked past the mailbox, which is the only part that does not exist yet.
 *
 * The names say what they are. Nothing here runs when `LUNART_DEV_PRICES` is off.
 */

import { ingestMessages } from './ingest/index.js';
import { guideUrl } from './delivery.js';
import { propertyDate, addDays } from '../commerce/time.js';

const notification = ({ kind, reference, first, last, email, room, from, to, adults, channel }) => ({
  from: 'QuoVai <no-reply@quovai.example>',
  subject: `${kind === 'cancelled' ? '⛔ Cancellazione' : kind === 'modified' ? '🔄 Modifica' : '🔔 Prenotazione'} per LunArt`,
  messageId: `<preview-${reference}-${kind}@quovai.example>`,
  body: [
    kind === 'cancelled' ? 'CANCELLED' : kind === 'modified' ? 'MODIFIED' : 'NEW',
    '',
    `Numero prenotazione: ${reference}`,
    'Struttura: LunArt',
    `Agenzia/Canale: ${channel}`,
    `Nome: ${first}`,
    `Cognome: ${last}`,
    `Check-in: ${italian(from)}`,
    `Check-out: ${italian(to)}`,
    'Prezzo totale: 486,00 €',
    `Adulti: ${adults}`,
    'Bambini: 0',
    'Telefono: +39 000 000 0000',
    `E-Mail: ${email}`,
    `Camera ${room} - Superior | Tariffa: anteprima`,
    `Data prenotazione: ${italian(propertyDate())}`,
  ].join('\n'),
});

const italian = (date) => {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
};

export async function seedPreview({ store, publicUrl }) {
  const existing = await store.reservations.list({ limit: 1 });
  if (existing.length > 0) return null;

  const today = propertyDate();
  const messages = [
    notification({
      kind: 'new', reference: 'PREVIEW-0001',
      first: 'Ospite', last: 'Anteprima', email: 'anteprima@example.invalid',
      room: '303', from: today, to: addDays(today, 3), adults: 2, channel: 'Booking.com',
    }),
    notification({
      kind: 'new', reference: 'PREVIEW-0002',
      first: 'Prossimo', last: 'Arrivo', email: 'arrivo@example.invalid',
      room: '305', from: addDays(today, 2), to: addDays(today, 6), adults: 2, channel: 'Expedia',
    }),
  ];

  const outcome = await ingestMessages({ store, messages });
  const reservations = await store.reservations.list({ limit: 5 });
  return {
    ...outcome,
    links: reservations.map((reservation) => ({
      guest: `${reservation.first_name} ${reservation.last_name}`,
      room: reservation.room,
      link: guideUrl(publicUrl, reservation),
    })),
  };
}
