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

import { slotsFor, daysWithSlots, serviceMinutes, isSlotOffered } from '../../commerce/schedule.js';
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

/**
 * True when this exact appointment can still be made, for browsing.
 *
 * Tolerant in the same way `freeSlots` is: an unreachable calendar leaves the
 * schedule standing and says the calendar did not confirm it. Good enough to decide
 * what a form offers; not good enough to take money — see `verifySlotForCheckout`.
 */
export async function slotIsFree({ calendar, productId, date, time, variantId }) {
  const { slots, calendarError } = await freeSlots({ calendar, productId, date, variantId });
  return {
    free: slots.some((slot) => slot.time === time),
    checkedCalendar: Boolean(calendar?.configured) && !calendarError,
    calendarError: calendarError ?? null,
  };
}

/**
 * The check immediately before money moves. This one fails closed.
 *
 * Showing a tentative time and charging for it are different promises, so they get
 * different rules. Browsing may fall back to the schedule when Google is
 * unreachable; a payment may not. Once a real calendar is configured, the only way
 * to take money for an appointment is to have just confirmed it against free/busy:
 *
 *   no calendar configured   the schedule is authoritative, exactly as before
 *   free                     allowed
 *   busy                     refused: slot-taken
 *   cannot be read           refused: availability-temporarily-unavailable
 *
 * The last line is the point of this function. Selling an hour we could not verify
 * means a professional arriving to a room where somebody else is already booked, a
 * refund, and a guest who was told a time that never existed. Asking them to try
 * again in a minute is a far smaller cost than that.
 */
export async function verifySlotForCheckout({ calendar, productId, date, time, variantId = null }) {
  // Whatever the calendar says, LunArt has to be offering the hour in the first place.
  if (!isSlotOffered(productId, date, time)) {
    return { ok: false, reason: 'slot-taken', verified: false, source: 'schedule' };
  }

  if (!calendar?.configured) {
    return { ok: true, verified: false, source: 'schedule' };
  }

  let busy;
  try {
    busy = await calendar.freeBusy({ from: date, to: date });
  } catch (error) {
    return {
      ok: false,
      reason: 'availability-temporarily-unavailable',
      verified: false,
      source: 'calendar',
      code: error.code ?? 'unavailable',
      message: error.message,
    };
  }

  const window = appointmentWindow({ date, time, variantId });
  if (!window) return { ok: false, reason: 'slot-taken', verified: true, source: 'calendar' };

  // With no service chosen the longest is assumed, so nothing is sold a slot it
  // would overrun.
  const minutes = variantId ? serviceMinutes(variantId) : 90;
  const end = new Date(window.start.getTime() + minutes * 60_000);

  if (overlapsBusy(window.start, end, busy)) {
    return { ok: false, reason: 'slot-taken', verified: true, source: 'calendar' };
  }
  return { ok: true, verified: true, source: 'calendar' };
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
