/**
 * Getting the guide into the guest's hands.
 *
 * The rule LunArt wants is simple to say and easy to get wrong: the guide goes out
 * three days before arrival. Which means:
 *
 *   - a booking made weeks ahead waits, and goes out on the right morning;
 *   - a booking made tonight for tomorrow goes out now, because three days before
 *     arrival is already in the past;
 *   - a modification moves the date but keeps the link, because the guest may
 *     already have it open;
 *   - a cancellation stops an email that has not gone yet, and never un-sends one
 *     that has.
 *
 * Nothing is sent from a preview or a test. The mailer is an adapter: without one
 * configured, every send is recorded as `simulated` and the body is kept, so the
 * whole path can be exercised and read without a single real message leaving.
 *
 * The address is whatever the reservation carries, alias and all. A Booking.com
 * reservation arrives with something like `marta.4h9k@guest.booking.com`, which is
 * a real relay to a real person, and substituting our own guess for it would mean
 * writing to nobody.
 */

import { propertyTimeToInstant, propertyDate, addDays } from '../commerce/time.js';
import { isLive, roomPhrase } from './reservations.js';
import { createGmailMailer } from './mail/gmail.js';

export const DELIVERY_STATUS = {
  scheduled: 'scheduled',
  sent: 'sent',
  simulated: 'simulated',
  cancelled: 'cancelled',
  failed: 'failed',
  /** Nothing to send to: no address on the reservation. */
  unsendable: 'unsendable',
};

/** How far ahead of arrival the guide goes out, and at what hour in Florence. */
export const GUIDE_EMAIL_LEAD_DAYS = 3;
export const GUIDE_EMAIL_HOUR = '10:00';

/**
 * When this reservation's guide email should go out.
 *
 * Three days before check-in at ten in the morning, Florence time — or right now,
 * if that moment has already passed. A booking taken at midnight for tomorrow does
 * not wait for a morning that will arrive after the guest does.
 */
export function sendTimeFor(reservation, { now = new Date() } = {}) {
  if (!reservation?.check_in) return null;
  const target = propertyTimeToInstant(addDays(reservation.check_in, -GUIDE_EMAIL_LEAD_DAYS), GUIDE_EMAIL_HOUR);
  if (!target) return null;
  return target.getTime() <= now.getTime() ? new Date(now.getTime()) : target;
}

/** True when the guide would be going out after the guest has already left. */
const staleStay = (reservation, now) => Boolean(reservation.check_out) && reservation.check_out < propertyDate(now);

/**
 * Put this reservation's guide email on the schedule, or move it.
 *
 * One delivery per reservation, by design: a modification must not produce a
 * second email with a second link. An email already sent is left alone — the link
 * in it still works, because the token did not change.
 */
export async function scheduleGuideEmail({ store, reservation, now = new Date(), reason = '' }) {
  if (!reservation) return null;
  const existing = await store.deliveries.findByReservation(reservation.id);

  if (!isLive(reservation)) return existing;
  if (staleStay(reservation, now)) return existing;

  /**
   * Occupancy is not a correspondent.
   *
   * A provisional reservation came from a calendar feed: it has dates and a room
   * and no idea who the guest is. There is nothing to write to, and there is no
   * address to guess at — so nothing is scheduled at all, not even as `unsendable`.
   * The guarantee lives here rather than at each call site, because the whole point
   * of the safety net is that a half-known stay can be created freely and the one
   * irreversible act, writing to a guest, still cannot happen by accident. When the
   * notification arrives and fills the record in, the adoption clears the flag and
   * the email is scheduled by the ordinary path.
   */
  if (reservation.provisional === true) return existing;

  const sendAt = sendTimeFor(reservation, { now });
  if (!sendAt) return existing;

  const to = reservation.guest_email ?? '';
  const base = {
    reservation_id: reservation.id,
    to,
    lang: reservation.lang ?? 'it',
    send_at: sendAt.toISOString(),
    status: to ? DELIVERY_STATUS.scheduled : DELIVERY_STATUS.unsendable,
    reason,
  };

  if (!existing) return store.deliveries.create({ ...base, attempts: 0, sent_at: null, provider: null, error: null });

  // Sent is sent. The link is unchanged, so there is nothing to send again.
  if (existing.status === DELIVERY_STATUS.sent || existing.status === DELIVERY_STATUS.simulated) {
    return store.deliveries.update(existing.id, { to, lang: base.lang });
  }

  return store.deliveries.update(existing.id, base);
}

/** A cancellation stops an email that has not gone out. */
export async function cancelGuideEmail({ store, reservation, reason = 'reservation cancelled' }) {
  const existing = await store.deliveries.findByReservation(reservation.id);
  if (!existing) return null;
  if (existing.status === DELIVERY_STATUS.sent || existing.status === DELIVERY_STATUS.simulated) return existing;
  return store.deliveries.update(existing.id, { status: DELIVERY_STATUS.cancelled, reason });
}

/**
 * How many times a delivery is retried before a person has to look at it.
 *
 * Five is a morning's worth of a provider being down, and few enough that a
 * permanently bad address stops being retried and starts being a problem on the
 * Staff app's sync screen instead.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;

/** Everything due to go out by `now`, including what failed and can be tried again. */
export const dueDeliveries = ({ store, now = new Date() }) =>
  store.deliveries.due(now.toISOString(), { maxAttempts: MAX_DELIVERY_ATTEMPTS });

/**
 * Send what is due.
 *
 * Each delivery is marked before the attempt and updated after it, so a crash in
 * the middle leaves a record rather than a mystery. A failure is recorded and
 * retried on the next run; it does not stop the others.
 */
export async function sendDueGuideEmails({ store, mailer, origin, now = new Date() }) {
  const due = await dueDeliveries({ store, now });
  const results = [];

  for (const delivery of due) {
    const reservation = await store.reservations.get(delivery.reservation_id);
    if (!reservation || !isLive(reservation)) {
      results.push(await store.deliveries.update(delivery.id, {
        status: DELIVERY_STATUS.cancelled, reason: 'reservation is no longer live',
      }));
      continue;
    }
    if (!delivery.to) {
      results.push(await store.deliveries.update(delivery.id, { status: DELIVERY_STATUS.unsendable }));
      continue;
    }
    results.push(await deliverGuideEmail({ store, mailer, origin, reservation, delivery, now }));
  }

  return results;
}

/**
 * Write one guide email, and record exactly what happened to it.
 *
 * Pulled out of the loop above because the launch-day catch-up sends the same
 * email through the same door, and two functions writing a delivery's status is
 * how one of them ends up writing a status the other does not expect. Whoever
 * calls this has already decided that this reservation should be written to; this
 * only does it, and records it.
 *
 * `simulated` and `sent` are deliberately different words. With no mail provider
 * configured nothing left the building, and a record saying otherwise would make
 * a staging run look like a guest had been contacted.
 */
export async function deliverGuideEmail({ store, mailer, origin, reservation, delivery, now = new Date() }) {
  const message = renderGuideEmail({ reservation, origin, lang: delivery.lang });
  try {
    const outcome = await mailer.send({ to: delivery.to, ...message });
    const status = outcome.simulated ? DELIVERY_STATUS.simulated : DELIVERY_STATUS.sent;
    const written = await store.deliveries.update(delivery.id, {
      status,
      sent_at: now.toISOString(),
      attempts: (delivery.attempts ?? 0) + 1,
      provider: mailer.id,
      subject: message.subject,
      /** Kept when nothing was really sent, so it can be read and checked. */
      body: outcome.simulated ? message.text : null,
      error: null,
    });
    await store.reservations.update(reservation.id, {
      guide_email_status: status,
      guide_email_sent_at: now.toISOString(),
    });
    return written;
  } catch (error) {
    return store.deliveries.update(delivery.id, {
      status: DELIVERY_STATUS.failed,
      attempts: (delivery.attempts ?? 0) + 1,
      error: String(error.message ?? error).slice(0, 300),
    });
  }
}

/* ── The email itself ──────────────────────────────────────────────────── */

const COPY = {
  it: {
    subject: 'La tua LunArt Guest Guide',
    hello: (name) => (name ? `Ciao ${name},` : 'Ciao,'),
    lead: 'ecco la tua guida personale per il soggiorno a LunArt: come entrare, il Wi-Fi, la colazione, il parcheggio e Firenze — tutto in una pagina, da aprire dal telefono.',
    cta: 'Apri la tua LunArt Guest Guide',
    stay: (from, to) => `Soggiorno: ${from} → ${to}`,
    room: 'Camera',
    rooms: 'Camere',
    keep: 'Il link è personale: tienilo da parte, ti servirà anche durante il soggiorno.',
    extras: 'Dalla guida puoi anche ordinare colazione in camera, vino, il transfer dall’aeroporto e il resto.',
    signoff: 'A presto,\nLunArt — Vicolo del Canneto 2, Firenze',
  },
  en: {
    subject: 'Your LunArt Guest Guide',
    hello: (name) => (name ? `Hello ${name},` : 'Hello,'),
    lead: 'here is your personal guide for your stay at LunArt: how to get in, the Wi-Fi, breakfast, parking and Florence — all on one page, made for your phone.',
    cta: 'Open your LunArt Guest Guide',
    stay: (from, to) => `Stay: ${from} → ${to}`,
    room: 'Room',
    rooms: 'Rooms',
    keep: 'The link is personal: keep it, you will want it during the stay too.',
    extras: 'From the guide you can also order breakfast in your room, wine, the airport transfer and the rest.',
    signoff: 'See you soon,\nLunArt — Vicolo del Canneto 2, Florence',
  },
};

/** The personal link. Opaque token, nothing readable in it. */
export const guideUrl = (origin, reservation) =>
  `${String(origin ?? '').replace(/\/$/, '')}/g/${reservation.guide_token}`;

export function renderGuideEmail({ reservation, origin = '', lang = 'it' }) {
  const copy = COPY[lang === 'en' ? 'en' : 'it'];
  const link = guideUrl(origin, reservation);
  /**
   * "Camera 303", or "Camere 302, 303, 304 e 305".
   *
   * One line either way. A group booked across four rooms used to be told they
   * were in 305, which is the first thing they would have read about their own
   * stay and the first thing they would have had to correct.
   */
  const rooms = roomPhrase(reservation, { one: copy.room, many: copy.rooms, lang });
  const lines = [
    copy.hello(reservation.first_name),
    '',
    copy.lead,
    '',
    link,
    '',
    copy.stay(reservation.check_in, reservation.check_out),
    rooms,
    '',
    copy.keep,
    copy.extras,
    '',
    copy.signoff,
  ].filter((line) => line !== null);

  const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const html = `<!doctype html><html lang="${lang}"><body style="margin:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f7;padding:28px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;padding:28px">
        <tr><td style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#8a7f72">LunArt Firenze</td></tr>
        <tr><td style="padding-top:14px;font-size:17px;line-height:1.6">${esc(copy.hello(reservation.first_name))}</td></tr>
        <tr><td style="padding-top:10px;font-size:15px;line-height:1.7">${esc(copy.lead)}</td></tr>
        <tr><td style="padding:22px 0">
          <a href="${esc(link)}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:14px 22px;border-radius:999px;font-size:15px">${esc(copy.cta)}</a>
        </td></tr>
        <tr><td style="font-size:14px;line-height:1.7;color:#55504a">
          ${esc(copy.stay(reservation.check_in, reservation.check_out))}${rooms ? `<br>${esc(rooms)}` : ''}
        </td></tr>
        <tr><td style="padding-top:16px;font-size:14px;line-height:1.7;color:#55504a">${esc(copy.keep)}<br>${esc(copy.extras)}</td></tr>
        <tr><td style="padding-top:20px;font-size:13px;line-height:1.7;color:#8a7f72">${esc(copy.signoff).replace(/\n/g, '<br>')}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject: copy.subject, text: lines.join('\n'), html, link };
}

/* ── Mail adapters ─────────────────────────────────────────────────────── */

/**
 * The mailer seam.
 *
 * `simulated` is the honest default: nothing is sent, the body is kept, and the
 * Staff app shows it as simulated rather than claiming the guest has it. An SMTP or
 * API adapter plugs in here and the rest of the system does not change.
 */
export function createSimulatedMailer() {
  const sent = [];
  return {
    id: 'simulated',
    configured: false,
    implemented: true,
    async send(message) {
      sent.push({ ...message, at: new Date().toISOString() });
      return { simulated: true, id: `sim_${sent.length}` };
    },
    outbox: () => [...sent],
    state: () => ({ sent: sent.length, lastError: null, lastSuccessAt: sent.at(-1)?.at ?? null }),
    check: async () => ({ ok: false, reason: 'credentials-missing' }),
  };
}

/**
 * Registry for mail providers, so adding another is a registration rather than an
 * edit to this file.
 *
 * Gmail is registered and implemented; it reports itself unconfigured until the
 * credentials exist, and `createMailer` falls back to the simulated one rather than
 * handing back a transport that will throw on every send. Choosing a provider that
 * cannot send is a configuration mistake, and it should be visible on the health
 * screen rather than as a pile of failed deliveries.
 */
const mailers = new Map([['gmail', createGmailMailer]]);
export const registerMailer = (id, factory) => mailers.set(id, factory);

export function createMailer(settings = {}) {
  const chosen = settings.mailProvider ?? '';
  const factory = mailers.get(chosen);
  if (!chosen || !factory) return createSimulatedMailer();
  const mailer = factory(settings);
  if (!mailer.configured) {
    const simulated = createSimulatedMailer();
    return { ...simulated, requestedProvider: mailer.id, requires: mailer.requires ?? [] };
  }
  return mailer;
}

export const mailProviders = (settings = {}) => [
  { id: 'simulated', implemented: true, configured: false, note: 'Default: nothing is sent, the body is kept.' },
  ...[...mailers.entries()].map(([id, factory]) => {
    const probe = factory(settings);
    return { id, implemented: probe.implemented !== false, configured: Boolean(probe.configured), requires: probe.requires ?? [] };
  }),
];
