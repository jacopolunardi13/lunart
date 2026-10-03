/**
 * Dates, in Florence time.
 *
 * "By 9 pm the evening before" means nine in the evening in Florence. Not in UTC,
 * and not on the guest's phone — a guest ordering breakfast from a plane with the
 * device still on London time must get the same deadline as one standing in the
 * room. Every cut-off in the commerce layer is therefore computed in Europe/Rome,
 * which also makes it survive the two days a year the clocks move.
 */

export const PROPERTY_TIMEZONE = 'Europe/Rome';

/** Milliseconds a zone is ahead of UTC at a given instant. */
function zoneOffsetMs(utcMs, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  );
  // `hour` comes back as 24 at midnight in some runtimes; Date.UTC normalises it.
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return asIfUtc - utcMs;
}

/**
 * Turn a wall-clock date and time in the property's zone into a real instant.
 * Two passes, because the offset itself depends on the instant we are solving for.
 */
export function propertyTimeToInstant(dateStr, timeStr = '00:00', timeZone = PROPERTY_TIMEZONE) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const [hour, minute] = String(timeStr).split(':').map(Number);
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) return null;

  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let instant = naive;
  for (let pass = 0; pass < 2; pass++) instant = naive - zoneOffsetMs(instant, timeZone);
  return new Date(instant);
}

/** The property's calendar date for an instant, as YYYY-MM-DD. */
export function propertyDate(instant = new Date(), timeZone = PROPERTY_TIMEZONE) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(instant).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Shift a YYYY-MM-DD by whole days, staying on the calendar rather than the clock. */
export function addDays(dateStr, days) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** Inclusive last day of a stay that starts on `dateStr` and runs `days` days. */
export function lastDayOf(dateStr, days) {
  return addDays(dateStr, Math.max(1, days) - 1);
}

/** End of a calendar day in property time — the moment a card stops working. */
export function endOfPropertyDay(dateStr, timeZone = PROPERTY_TIMEZONE) {
  return propertyTimeToInstant(addDays(dateStr, 1), '00:00', timeZone);
}

/** True for a well-formed YYYY-MM-DD that is a real date. */
export function isValidDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr ?? ''))) return false;
  const [year, month, day] = dateStr.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

export const isValidTime = (timeStr) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(timeStr ?? ''));
