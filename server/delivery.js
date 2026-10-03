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
import { isLive } from './reservations.js';

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

/** Everything due to go out by `now`. */
export const dueDeliveries = ({ store, now = new Date() }) => store.deliveries.due(now.toISOString());

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

    const message = renderGuideEmail({ reservation, origin, lang: delivery.lang });
    try {
      const outcome = await mailer.send({ to: delivery.to, ...message });
      results.push(await store.deliveries.update(delivery.id, {
        status: outcome.simulated ? DELIVERY_STATUS.simulated : DELIVERY_STATUS.sent,
        sent_at: now.toISOString(),
        attempts: (delivery.attempts ?? 0) + 1,
        provider: mailer.id,
        subject: message.subject,
        /** Kept when nothing was really sent, so it can be read and checked. */
        body: outcome.simulated ? message.text : null,
        error: null,
      }));
      await store.reservations.update(reservation.id, {
        guide_email_status: outcome.simulated ? DELIVERY_STATUS.simulated : DELIVERY_STATUS.sent,
        guide_email_sent_at: now.toISOString(),
      });
    } catch (error) {
      results.push(await store.deliveries.update(delivery.id, {
        status: DELIVERY_STATUS.failed,
        attempts: (delivery.attempts ?? 0) + 1,
        error: String(error.message ?? error).slice(0, 300),
      }));
    }
  }

  return results;
}

/* ── The email itself ──────────────────────────────────────────────────── */

const COPY = {
  it: {
    subject: 'La tua LunArt Guest Guide',
    hello: (name) => (name ? `Ciao ${name},` : 'Ciao,'),
    lead: 'ecco la tua guida personale per il soggiorno a LunArt: come entrare, il Wi-Fi, la colazione, il parcheggio e Firenze — tutto in una pagina, da aprire dal telefono.',
    cta: 'Apri la tua LunArt Guest Guide',
    stay: (from, to) => `Soggiorno: ${from} → ${to}`,
    room: (room) => `Camera ${room}`,
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
    room: (room) => `Room ${room}`,
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
  const lines = [
    copy.hello(reservation.first_name),
    '',
    copy.lead,
    '',
    link,
    '',
    copy.stay(reservation.check_in, reservation.check_out),
    reservation.room ? copy.room(reservation.room) : '',
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
          ${esc(copy.stay(reservation.check_in, reservation.check_out))}${reservation.room ? `<br>${esc(copy.room(reservation.room))}` : ''}
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
    async send(message) {
      sent.push({ ...message, at: new Date().toISOString() });
      return { simulated: true, id: `sim_${sent.length}` };
    },
    outbox: () => [...sent],
  };
}

/**
 * Registry for real mail providers, so adding one is a registration rather than an
 * edit to this file. Nothing is registered: LunArt has given no mail credentials,
 * and an adapter that pretends to be configured is worse than none.
 */
const mailers = new Map();
export const registerMailer = (id, factory) => mailers.set(id, factory);

export function createMailer(settings = {}) {
  const chosen = settings.mailProvider ?? '';
  const factory = mailers.get(chosen);
  if (!chosen || !factory) return createSimulatedMailer();
  return factory(settings);
}

export const mailProviders = () => [
  { id: 'simulated', configured: false, note: 'Default: nothing is sent, the body is kept.' },
  ...[...mailers.keys()].map((id) => ({ id, configured: true })),
];
