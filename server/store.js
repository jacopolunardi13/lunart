/**
 * Where orders and cards live.
 *
 * Deliberately an interface with a modest implementation rather than a database.
 * LunArt has five rooms; a JSON file is the right size, and everything that talks
 * to the store goes through these methods, so swapping in Postgres later is one
 * file rather than a search for `orders` across the codebase.
 *
 * Writes are serialised through a promise chain. The server is a single process,
 * so this is enough to stop two concurrent webhooks interleaving a read-modify-write
 * and losing one of them — which, with payments, is the failure that matters.
 */

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';

/** Short, unambiguous, no look-alike characters: no I, L, O, U. */
const REF_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function randomRef(length = 6) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
  return out;
}

export const opaqueToken = (bytes = 24) => randomBytes(bytes).toString('base64url');

function collection(state, name) {
  state[name] ??= {};
  return state[name];
}

const EMPTY = () => ({
  orders: {}, cards: {}, events: {},
  /** Reservations are the spine the rest hangs from. See `server/reservations.js`. */
  reservations: {},
  /** Things staff have to look at: an iCal occupancy with no reservation behind it. */
  alerts: {},
  /** Every ingested message id, so the same QuoVai email cannot land twice. */
  messages: {},
  /** Push endpoints staff devices registered. */
  subscriptions: {},
  /** Guest emails: when they are due, and what happened to them. */
  deliveries: {},
});

export function createStore({ dataDir = '' } = {}) {
  const file = dataDir ? join(dataDir, 'store.json') : '';
  let state = EMPTY();
  let writeChain = Promise.resolve();
  let loaded = !file;

  async function load() {
    if (loaded) return;
    loaded = true;
    if (!existsSync(file)) return;
    try {
      state = { ...EMPTY(), ...JSON.parse(await readFile(file, 'utf8')) };
    } catch {
      // A corrupt store must not take the server down; it starts empty and says so.
      console.error(`[store] ${file} could not be read; starting empty`);
    }
  }

  /** Serialise every write, and never leave a half-written file behind. */
  function persist() {
    if (!file) return Promise.resolve();
    writeChain = writeChain.then(async () => {
      await mkdir(dataDir, { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(state, null, 2));
      await rename(temp, file);
    }).catch((error) => console.error('[store] write failed:', error.message));
    return writeChain;
  }

  const now = () => new Date().toISOString();

  const records = (name) => ({
    async create(record) {
      await load();
      const id = record.id ?? randomUUID();
      const saved = { ...record, id, created_at: now(), updated_at: now() };
      collection(state, name)[id] = saved;
      await persist();
      return saved;
    },
    async get(id) {
      await load();
      return collection(state, name)[id] ?? null;
    },
    async update(id, patch) {
      await load();
      const current = collection(state, name)[id];
      if (!current) return null;
      const next = { ...current, ...patch, id, updated_at: now() };
      collection(state, name)[id] = next;
      await persist();
      return next;
    },
    async list({ limit = 100 } = {}) {
      await load();
      return Object.values(collection(state, name))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, limit);
    },
    async findBy(predicate) {
      await load();
      return Object.values(collection(state, name)).find(predicate) ?? null;
    },
    async filter(predicate) {
      await load();
      return Object.values(collection(state, name)).filter(predicate);
    },
    async remove(id) {
      await load();
      const current = collection(state, name)[id];
      if (!current) return false;
      delete collection(state, name)[id];
      await persist();
      return true;
    },
  });

  const orders = records('orders');
  const cards = records('cards');
  const reservations = records('reservations');
  const alerts = records('alerts');
  const subscriptions = records('subscriptions');
  const deliveries = records('deliveries');

  /** One reservation per source and booking reference. The key the upsert turns on. */
  const bookingKey = (source, reference) =>
    `${String(source ?? '').toLowerCase()}:${String(reference ?? '').trim().toUpperCase()}`;

  return {
    orders: {
      ...orders,
      findBySession: (sessionId) => orders.findBy((o) => o.stripe_session_id === sessionId),
      findByPaymentIntent: (intentId) => orders.findBy((o) => o.stripe_payment_intent_id === intentId),
      findByAccessToken: (token) => orders.findBy((o) => o.access_token === token),
    },
    cards: {
      ...cards,
      findByPublicRef: (ref) => cards.findBy((c) => c.public_ref === String(ref ?? '').toUpperCase()),
      findByAccessToken: (token) => cards.findBy((c) => c.access_token === token),
      findByOrder: (orderId) => cards.findBy((c) => c.order_id === orderId),
    },

    reservations: {
      ...reservations,
      findByBooking: (source, reference) =>
        reservations.findBy((r) => bookingKey(r.source, r.booking_reference) === bookingKey(source, reference)),
      findByGuideToken: (token) => reservations.findBy((r) => r.guide_token && r.guide_token === token),
      /**
       * Recovery: surname plus the booking number. Both are compared loosely on
       * case and spacing, because a guest reading them off an email will not match
       * our storage exactly, and strictly on content.
       */
      findForRecovery: (lastName, reference) => {
        const name = String(lastName ?? '').trim().toLowerCase();
        const ref = String(reference ?? '').replace(/\s+/g, '').toLowerCase();
        if (!name || !ref) return null;
        const nameMatches = (r) => {
          const stored = String(r.last_name ?? '').trim().toLowerCase();
          if (!stored) return false;
          if (stored === name) return true;
          // A guest with two surnames may type both, or the system may have split
          // them the other way round. Either reading is accepted; the booking
          // number is what actually guards this.
          const full = `${String(r.first_name ?? '')} ${stored}`.trim().toLowerCase();
          return full.endsWith(name) || name.split(/\s+/).pop() === stored;
        };
        return reservations.findBy((r) => (
          nameMatches(r)
          && [r.booking_reference, r.source_reference].some(
            (candidate) => String(candidate ?? '').replace(/\s+/g, '').toLowerCase() === ref,
          )
        ));
      },
      overlapping: (from, to) => reservations.filter(
        (r) => String(r.check_in) <= String(to) && String(r.check_out) >= String(from),
      ),
    },

    alerts: {
      ...alerts,
      open: () => alerts.filter((a) => a.status === 'open'),
      findByKey: (key) => alerts.findBy((a) => a.key === key),
    },

    subscriptions: {
      ...subscriptions,
      findByEndpoint: (endpoint) => subscriptions.findBy((s) => s.endpoint === endpoint),
    },

    deliveries: {
      ...deliveries,
      findByReservation: (reservationId) => deliveries.findBy((d) => d.reservation_id === reservationId),
      /**
       * Everything that should go out by `atIso`.
       *
       * A delivery that failed is due again: the transport was down, the guest still
       * has no guide, and the attempt counter is what stops it retrying for ever.
       * Without this one Gmail hiccup would quietly cost somebody their link.
       */
      due: (atIso, { maxAttempts = 5 } = {}) => deliveries.filter((d) => (
        String(d.send_at) <= String(atIso)
        && (d.status === 'scheduled' || (d.status === 'failed' && (d.attempts ?? 0) < maxAttempts))
      )),
    },

    /**
     * Ingestion de-duplication, the same idea as the Stripe one below and for the
     * same reason: QuoVai can send the same notification twice, and a guest must
     * not receive two guide emails because a mailbox was polled twice.
     */
    messages: {
      async seen(messageId) {
        await load();
        return Boolean(collection(state, 'messages')[messageId]);
      },
      async remember(messageId, meta = {}) {
        await load();
        collection(state, 'messages')[messageId] = { at: now(), ...meta };
        await persist();
      },
    },

    /**
     * Webhook de-duplication. Stripe retries, and will happily deliver the same
     * event twice; processing a payment twice is not an acceptable way to find out.
     */
    events: {
      async seen(eventId) {
        await load();
        return Boolean(collection(state, 'events')[eventId]);
      },
      async remember(eventId, meta = {}) {
        await load();
        collection(state, 'events')[eventId] = { at: now(), ...meta };
        await persist();
      },
    },

    /** For tests and diagnostics. */
    async snapshot() {
      await load();
      return structuredClone(state);
    },
    async flush() { await writeChain; },
  };
}
