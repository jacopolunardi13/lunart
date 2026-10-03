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

export function createStore({ dataDir = '' } = {}) {
  const file = dataDir ? join(dataDir, 'store.json') : '';
  let state = { orders: {}, cards: {}, events: {} };
  let writeChain = Promise.resolve();
  let loaded = !file;

  async function load() {
    if (loaded) return;
    loaded = true;
    if (!existsSync(file)) return;
    try {
      state = { orders: {}, cards: {}, events: {}, ...JSON.parse(await readFile(file, 'utf8')) };
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
  });

  const orders = records('orders');
  const cards = records('cards');

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
