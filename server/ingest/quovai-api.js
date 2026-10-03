/**
 * QuoVai as an API, when there is one.
 *
 * We do not know yet whether QuoVai exposes the push or pull that would make the
 * email adapter unnecessary. So what exists here is the part that can be decided
 * now — the interface, the configuration it would read, and the route that will
 * carry it — and nothing that would have to be guessed: no endpoint URL, no
 * authentication scheme, no field names.
 *
 * That boundary is the point. When QuoVai answers, this file is the only one that
 * changes: `toEvent` maps their payload onto the canonical event, `verify` checks
 * whatever signature they send, and the reservation model, the guide links, the
 * emails and the Staff app carry on as they are.
 *
 * Until then every call refuses with `source-not-configured`, which is an answer,
 * and the webhook route says so with a 503 rather than accepting a reservation
 * nobody can account for.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * @typedef {object} ReservationSourceAdapter
 * @property {string} id
 * @property {boolean} configured
 * @property {string[]} requires           environment variables it needs
 * @property {string[]} capabilities       what it can do once configured
 * @property {(raw: object) => object} toEvent          their payload → canonical event
 * @property {(raw: string, signature: string) => boolean} verify  is this really them
 * @property {() => Promise<object[]>} [fetchChanges]   pull, if they offer one
 */

export const QUOVAI_API_CAPABILITIES = ['create', 'modify', 'cancel'];

/**
 * The one mapping decision that can be made without an answer from QuoVai: their
 * words for the three things that can happen. Everything else about their payload
 * is unknown, and `toEvent` says so rather than inventing field names.
 */
const KIND_WORDS = {
  new: 'new', created: 'new', booking: 'new', NEW: 'new',
  modified: 'modified', modify: 'modified', update: 'modified', updated: 'modified', MODIFIED: 'modified',
  cancelled: 'cancelled', canceled: 'cancelled', cancel: 'cancelled', CANCELLED: 'cancelled',
};

export function createQuovaiApiAdapter(settings = {}) {
  const { quovaiApiKey, quovaiWebhookSecret, quovaiApiBase } = settings;
  const configured = Boolean(quovaiWebhookSecret || (quovaiApiKey && quovaiApiBase));

  return {
    id: 'quovai-api',
    configured,
    requires: ['QUOVAI_API_BASE', 'QUOVAI_API_KEY', 'QUOVAI_WEBHOOK_SECRET'],
    capabilities: QUOVAI_API_CAPABILITIES,
    /** Open questions, carried in the code so they reach the handover report. */
    openQuestions: [
      'Does QuoVai push webhooks for create/modify/cancel, or must we poll?',
      'If webhooks: what signs them, and over what — the raw body, or a canonical string?',
      'Which field is the stable booking identifier across a modification?',
      'Is the OTA guest email supplied in full, including the @guest.booking.com alias?',
      'Is the room/unit identified by LunArt’s own numbering (301–305) or by a QuoVai id?',
    ],

    /**
     * Is this really them?
     *
     * Written against the shape nearly everyone uses — an HMAC over the raw body,
     * compared in constant time — because that is cheap to adjust and the
     * alternative is a verification step bolted on in a hurry later. With no secret
     * configured it refuses, and the route refuses with it.
     */
    verify(rawBody, signature) {
      if (!quovaiWebhookSecret) return false;
      const expected = createHmac('sha256', quovaiWebhookSecret).update(String(rawBody ?? '')).digest('hex');
      const given = String(signature ?? '').trim().replace(/^sha256=/, '');
      if (given.length !== expected.length) return false;
      return timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(expected, 'utf8'));
    },

    /**
     * Their payload, as a canonical event.
     *
     * The mapping is left to the moment there is a payload to map. What is already
     * decided is that it must produce `{ kind, source, booking_reference, ... }` and
     * that anything missing stays missing: a field we cannot read must not be filled
     * in with something plausible.
     */
    toEvent(raw = {}) {
      const kind = KIND_WORDS[String(raw.kind ?? raw.type ?? raw.event ?? '').trim()] ?? null;
      const reference = raw.booking_reference ?? raw.bookingReference ?? raw.reference ?? '';
      if (!kind || !reference) {
        throw Object.assign(new Error('quovai payload shape is not agreed yet'), { code: 'mapping-not-agreed' });
      }
      return {
        kind,
        source: 'quovai',
        booking_reference: String(reference),
        message_id: raw.id ? `quovai-api:${raw.id}` : undefined,
        raw_kept_for_mapping: true,
      };
    },

    async fetchChanges() {
      throw Object.assign(new Error('quovai api adapter is not configured'), { code: 'source-not-configured' });
    },
  };
}

/** Every reservation source, and whether it can actually be used. */
export function reservationSources(settings = {}) {
  const api = createQuovaiApiAdapter(settings);
  return [
    { id: 'quovai-email', configured: true, note: 'Verified: QuoVai already emails these notifications.' },
    { id: api.id, configured: api.configured, requires: api.requires, note: 'Interface agreed, waiting on QuoVai.' },
    { id: 'quovai-ical', configured: Boolean(settings.icalFeeds?.length), requires: ['QUOVAI_ICAL_FEEDS'], note: 'Reconciliation only, not a rich source.' },
    { id: 'manual', configured: true, note: 'Staff app, for when nothing arrives.' },
  ];
}
