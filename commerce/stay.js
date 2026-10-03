/**
 * What a stay allows.
 *
 * The Privilege Card is sold inside a stay, so its validity cannot run past it:
 * a guest leaving on the 13th has no use for a card that works on the 15th, and
 * selling them one is selling them nothing. The calendar day of checkout counts in
 * full — they are in Florence until the afternoon, and the morning coffee is
 * exactly when the card is worth having.
 *
 * Stay 10–13 October therefore gives four usable days — 10, 11, 12, 13 — so a
 * 2-day card may start on the 10th, 11th or 12th, and the 5- and 8-day cards
 * cannot be sold at all.
 *
 * Imported by the browser so the date picker offers only what will be accepted,
 * and by the server, which decides.
 */

import { addDays, isValidDate, lastDayOf, propertyDate } from './time.js';

/** Every calendar day of a stay, checkout day included. */
export function stayDates(stay) {
  const from = stay?.check_in ?? stay?.checkIn;
  const to = stay?.check_out ?? stay?.checkOut;
  if (!isValidDate(from) || !isValidDate(to) || to < from) return [];
  const out = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    out.push(day);
    if (out.length > 60) break;   // a guard, not a policy: nobody stays two months
  }
  return out;
}

/** How many usable days a stay has, counting arrival and departure. */
export const stayLength = (stay) => stayDates(stay).length;

/** True when `date` is one of the stay's own days. */
export const isWithinStay = (stay, date) => stayDates(stay).includes(date);

/**
 * True when a card of `days` days can start on `startDate` without running past
 * the end of the stay.
 */
export function cardFitsStay(stay, startDate, days) {
  const dates = stayDates(stay);
  if (dates.length === 0) return false;
  if (!isValidDate(startDate) || !Number.isInteger(days) || days < 1) return false;
  if (!dates.includes(startDate)) return false;
  return lastDayOf(startDate, days) <= dates[dates.length - 1];
}

/**
 * The days a card of this length could start on.
 * `from` drops the days already gone: a card cannot start yesterday.
 */
export function cardStartDates(stay, days, { from = propertyDate() } = {}) {
  return stayDates(stay).filter((date) => date >= from && cardFitsStay(stay, date, days));
}

/**
 * Which card lengths are sellable for this stay at all.
 * Returns the variants untouched, so the caller keeps its own ordering and labels.
 */
export function cardVariantsForStay(variants = [], stay, { from = propertyDate() } = {}) {
  if (stayDates(stay).length === 0) return variants;   // no stay known: nothing to narrow
  return variants.filter((variant) => cardStartDates(stay, variant.meta?.days ?? 0, { from }).length > 0);
}

/** A stay object from whatever shape the caller has. Null when there is none. */
export function asStay(source) {
  if (!source) return null;
  const check_in = source.check_in ?? source.checkIn ?? null;
  const check_out = source.check_out ?? source.checkOut ?? null;
  if (!isValidDate(check_in) || !isValidDate(check_out)) return null;
  return { check_in, check_out };
}
