/**
 * When the hair professional is actually free.
 *
 * Empty on purpose. Nobody has given us their hours, so the guide offers no
 * slots and the service cannot be booked — which is the honest state, and the
 * reason this file exists rather than a generated grid of plausible times.
 *
 * Fill `MANUAL_SCHEDULE` and the slots appear. It is the "manually managed slots"
 * source: the simplest real one, and the one that works before any calendar is
 * connected. When there is a provider calendar to read, register an adapter with
 * the same id in `availability.js` and this becomes the fallback.
 *
 *   export const MANUAL_SCHEDULE = {
 *     'hair-service': {
 *       '2026-10-06': ['10:00', '11:30', '15:00', '16:30'],
 *       '2026-10-07': ['09:30', '11:00'],
 *     },
 *   };
 *
 * A booked slot is removed from this list, or the same slot could be sold twice.
 */

export const MANUAL_SCHEDULE = {
  'hair-service': {},
};

/** How long each service takes, so a slot can be shown with an end time. */
export const SERVICE_MINUTES = {
  'men-cut': 45,
  'men-beard': 30,
  'men-cut-beard': 75,
  'women-blowdry': 45,
  'women-cut-blow': 90,
  'women-evening': 60,
  ceremony: 90,
};

/**
 * The schedule in force, which is not always the one written above.
 *
 * The server applies its configuration at boot — the preview loads a fortnight of
 * invented times, production loads nothing — and publishes the result through
 * `/api/catalog`, so the slots the guide offers and the ones the server will
 * accept are the same list rather than two that can drift.
 */
let inForce = MANUAL_SCHEDULE;
export const applySchedule = (schedule) => { inForce = schedule ?? MANUAL_SCHEDULE; };
export const scheduleInForce = () => inForce;

/** Slots a product offers on a given day, from whatever schedule is in force. */
export function slotsFor(productId, date, schedule = inForce) {
  const times = schedule?.[productId]?.[date];
  if (!Array.isArray(times)) return [];
  return [...times]
    .filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    .sort()
    .map((time) => ({ id: `${date}T${time}`, date, time, label: { it: time, en: time } }));
}

/** True when this exact slot is on offer. The check the server does before selling. */
export function isSlotOffered(productId, date, time, schedule = inForce) {
  return slotsFor(productId, date, schedule).some((slot) => slot.time === time);
}

/** Days with anything free, for the date picker. */
export function daysWithSlots(productId, schedule = inForce) {
  return Object.entries(schedule?.[productId] ?? {})
    .filter(([, times]) => Array.isArray(times) && times.length > 0)
    .map(([date]) => date)
    .sort();
}
