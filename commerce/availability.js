/**
 * Where "can I have this on Thursday at seven?" gets answered.
 *
 * Two of these are real and decide things today: `always` and `cutoff`. The rest
 * are seams, not implementations — a Google Calendar or a partner API cannot be
 * written before there is an account to talk to, and an adapter that invents
 * plausible slots is worse than one that admits it is not connected. The
 * unconfigured ones therefore return `configured: false` and the UI says the slot
 * has to be agreed with us, rather than selling a time nobody holds.
 *
 * @typedef {object} AvailabilityAdapter
 * @property {string} id
 * @property {boolean} configured
 * @property {(ctx: object) => Promise<{ok: boolean, slots?: object[], reason?: string}>} query
 */

import { cutoffFor } from './ordering.js';
import { isValidDate, propertyDate } from './time.js';

const adapters = new Map();

export function registerAvailabilityAdapter(adapter) {
  adapters.set(adapter.id, adapter);
  return adapter;
}

export const getAvailabilityAdapter = (id) => adapters.get(id) ?? adapters.get('unconfigured');

/** On the shelf. The only question is whether the date is a real one. */
registerAvailabilityAdapter({
  id: 'always',
  configured: true,
  async query({ date }) {
    if (date && !isValidDate(date)) return { ok: false, reason: 'invalid-date' };
    if (date && date < propertyDate()) return { ok: false, reason: 'past-date' };
    return { ok: true };
  },
});

/** Orderable until a deadline. The deadline is the whole of the availability. */
registerAvailabilityAdapter({
  id: 'cutoff',
  configured: true,
  async query({ product, variant, date, slotId, now = new Date() }) {
    const slots = product.deliverySlots ?? [];
    const usable = [];
    for (const slot of slots) {
      const { deadline } = cutoffFor(product, variant, { date, slotId: slot.id });
      if (deadline && now <= deadline) usable.push(slot);
    }
    if (slots.length === 0) {
      const { deadline } = cutoffFor(product, variant, { date, slotId });
      return deadline && now > deadline ? { ok: false, reason: 'past-cutoff' } : { ok: true };
    }
    return usable.length > 0
      ? { ok: true, slots: usable }
      : { ok: false, reason: 'past-cutoff', slots: [] };
  },
});

/**
 * Slots someone keeps by hand, in a configuration file or the order store. Real,
 * but empty until LunArt puts something in it.
 */
registerAvailabilityAdapter({
  id: 'manual',
  configured: true,
  async query({ product, date, manualSlots = {} }) {
    const slots = manualSlots?.[product.id]?.[date] ?? [];
    return slots.length > 0 ? { ok: true, slots } : { ok: false, reason: 'no-slots' };
  },
});

/** Needs a human or a provider to say yes. Bookable, just not confirmed. */
registerAvailabilityAdapter({
  id: 'manual-confirm',
  configured: true,
  async query() {
    return { ok: true, requiresConfirmation: true };
  },
});

/** Nothing to query: the guest asks and staff answer. */
registerAvailabilityAdapter({
  id: 'request',
  configured: true,
  async query() {
    return { ok: true, enquiryOnly: true };
  },
});

/**
 * The seam. Every integration that does not exist yet resolves here, and says so.
 * Replace by registering an adapter with the same id once there is a real source.
 */
registerAvailabilityAdapter({
  id: 'unconfigured',
  configured: false,
  async query() {
    return { ok: false, reason: 'source-not-configured' };
  },
});

for (const id of ['external', 'google-calendar', 'provider-calendar', 'partner-api', 'booking-engine']) {
  registerAvailabilityAdapter({
    id,
    configured: false,
    async query() {
      return { ok: false, reason: 'source-not-configured', source: id };
    },
  });
}

/** Ask whichever source a product declares. */
export async function checkAvailability(product, variant, context = {}) {
  const adapter = getAvailabilityAdapter(product.availabilityMode);
  const result = await adapter.query({ product, variant, ...context });
  return { ...result, adapter: adapter.id, configured: adapter.configured };
}

/** For the handover list: which sources are seams rather than integrations. */
export function availabilitySources() {
  return [...adapters.values()].map(({ id, configured }) => ({ id, configured }));
}
