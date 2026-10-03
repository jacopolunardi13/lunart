/**
 * What the calendar is allowed to decide.
 *
 * Exactly one thing: it removes. The hours a guest can book come from the schedule
 * LunArt configures, and free/busy only takes away the ones the professional is
 * already committed to. That direction is deliberate — "not busy at 04:00" is not
 * an offer, and a calendar that could *add* availability would be inventing it.
 *
 * With no calendar connected the schedule is the whole answer, which is what has
 * been true until now. With one connected, the same list comes back minus the
 * conflicts. If the calendar is configured but cannot be read, the slots are left
 * alone and the failure is reported: offering a slot that might be taken is a bad
 * morning, but refusing every booking because Google had a wobble is worse, and the
 * professional confirms his own day either way.
 */

import { slotsFor, daysWithSlots, serviceMinutes } from '../../commerce/schedule.js';
import { appointmentWindow, overlapsBusy } from './google.js';

/**
 * The slots actually on offer for one day.
 *
 * `variantId` matters because the services are not the same length: a 90-minute
 * blow-dry can collide with something a 30-minute beard trim would have fitted
 * around. When no service has been chosen yet the longest is assumed, so the
 * picker never offers a time that the service the guest then picks cannot fit.
 */
export async function freeSlots({ calendar, productId, date, variantId = null }) {
  const offered = slotsFor(productId, date);
  if (offered.length === 0) return { slots: [], source: 'schedule' };
  if (!calendar?.configured) return { slots: offered, source: 'schedule' };

  let busy;
  try {
    busy = await calendar.freeBusy({ from: date, to: date });
  } catch (error) {
    return { slots: offered, source: 'schedule', calendarError: error.code ?? 'unavailable', message: error.message };
  }

  const minutes = variantId ? serviceMinutes(variantId) : longestService();
  const slots = offered.filter((slot) => {
    const window = appointmentWindow({ date, time: slot.time, variantId: variantId ?? longestServiceId() });
    if (!window) return false;
    const end = new Date(window.start.getTime() + minutes * 60_000);
    return !overlapsBusy(window.start, end, busy);
  });

  return { slots, source: 'calendar', busy: busy.length };
}

/** True when this exact appointment can still be made. The check before money moves. */
export async function slotIsFree({ calendar, productId, date, time, variantId }) {
  const { slots, calendarError } = await freeSlots({ calendar, productId, date, variantId });
  return {
    free: slots.some((slot) => slot.time === time),
    checkedCalendar: Boolean(calendar?.configured) && !calendarError,
    calendarError: calendarError ?? null,
  };
}

/** The days with anything left on them, after the calendar has had its say. */
export async function freeDays({ calendar, productId, variantId = null }) {
  const days = daysWithSlots(productId);
  if (!calendar?.configured || days.length === 0) return days;

  const out = [];
  for (const day of days) {
    const { slots } = await freeSlots({ calendar, productId, date: day, variantId });
    if (slots.length > 0) out.push(day);
  }
  return out;
}

/** The longest service, so an unchosen one cannot be promised a slot it will overrun. */
const longestService = () => 90;
const longestServiceId = () => 'women-evening';

export { freeSlots as slotsOnOffer };
