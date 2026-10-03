/**
 * A fortnight of invented availability, for the preview only.
 *
 * Loaded only when LUNART_DEV_PRICES is set, alongside the preview prices. It
 * exists so the booking flow can be walked through and tested; it is not a
 * guess at anybody's real hours, and a production server never sees it.
 */

import { propertyDate, addDays } from './time.js';

const TIMES = ['10:00', '11:30', '15:00', '16:30', '18:00'];

export function devSchedule(from = propertyDate()) {
  const days = {};
  for (let offset = 1; offset <= 14; offset++) {
    const date = addDays(from, offset);
    // Sunday off, and fewer slots on a Saturday: enough variation that the UI is
    // exercised rather than always finding the same five times.
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday === 0) continue;
    days[date] = weekday === 6 ? TIMES.slice(0, 2) : TIMES;
  }
  return { 'hair-service': days };
}
