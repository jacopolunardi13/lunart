/**
 * The hair professional's calendar.
 *
 * Two jobs, and they are different:
 *
 *   reading   when is he busy? Free/busy only — the API returns blocks of time with
 *             no titles, no guests and no detail, which is all we need and the least
 *             we can ask for. Reading his actual events would mean reading his life.
 *   writing   a confirmed booking goes into a calendar he already looks at, so the
 *             appointment exists in his day rather than only in our database.
 *
 * Google rather than Apple even though he uses an iPhone: an Apple Calendar
 * subscribed to a Google account syncs both ways, so he carries on exactly as he is
 * and the server talks to one documented API. A dedicated calendar — "LunArt Hair
 * Bookings" — keeps our writes out of his personal one.
 *
 * What this does NOT do is invent working hours. Free/busy says when he is *not*
 * free; it never says when he is working. The hours still come from the schedule
 * LunArt configures, and this only removes from them. With no schedule and a
 * connected calendar, the answer is still no slots — because "not busy" at four in
 * the morning is not an offer.
 */

import { createServiceAccountClient, GoogleError } from '../google.js';
import { serviceMinutes } from '../../commerce/schedule.js';
import { propertyTimeToInstant, addDays } from '../../commerce/time.js';

const API = 'https://www.googleapis.com/calendar/v3';
export const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar'];
export const PROPERTY_TIMEZONE = 'Europe/Rome';

/**
 * @typedef {object} ProviderCalendarAdapter
 * @property {string} id
 * @property {boolean} configured
 * @property {string[]} requires
 * @property {(range: {from: string, to: string}) => Promise<object[]>} freeBusy
 * @property {(booking: object) => Promise<object>} createEvent
 * @property {(eventId: string) => Promise<object>} deleteEvent
 */

/** An appointment's start and end as real instants, in Florence time. */
export function appointmentWindow({ date, time, variantId }) {
  const minutes = serviceMinutes(variantId);
  const start = propertyTimeToInstant(date, time);
  if (!start) return null;
  return { start, end: new Date(start.getTime() + minutes * 60_000), minutes };
}

/** True when an appointment overlaps any busy block. Touching edges do not overlap. */
export const overlapsBusy = (start, end, busy = []) =>
  busy.some((block) => start < new Date(block.end) && end > new Date(block.start));

export function createGoogleCalendarAdapter(settings = {}) {
  const {
    googleCalendarId,
    googleCalendarWriteId,
    googleServiceAccountEmail,
    googleServiceAccountKey,
    googleCalendarSubject = '',
    fetchImpl = fetch,
  } = settings;

  const client = createServiceAccountClient({
    email: googleServiceAccountEmail,
    privateKey: googleServiceAccountKey,
    scopes: CALENDAR_SCOPES,
    subject: googleCalendarSubject,
    fetchImpl,
  });

  const readCalendar = googleCalendarId ?? '';
  const writeCalendar = googleCalendarWriteId || googleCalendarId || '';
  const configured = Boolean(readCalendar && client.configured);
  const state = { lastError: null, lastSuccessAt: null, reads: 0, writes: 0 };

  const refuse = (what) => {
    throw new GoogleError(`google calendar is not configured (${what})`, { code: 'source-not-configured' });
  };

  return {
    id: 'google-calendar',
    implemented: true,
    configured,
    requires: [
      'GOOGLE_CALENDAR_ID',
      'GOOGLE_SERVICE_ACCOUNT_EMAIL',
      'GOOGLE_SERVICE_ACCOUNT_KEY',
      'GOOGLE_CALENDAR_WRITE_ID',
    ],
    scopes: CALENDAR_SCOPES,
    timeZone: PROPERTY_TIMEZONE,
    readCalendar,
    writeCalendar: writeCalendar || 'LunArt Hair Bookings',
    capabilities: ['free-busy', 'create-event', 'delete-event'],
    state: () => ({ ...state }),
    openQuestions: [
      'Which Google account owns the calendar LunArt may read and write?',
      'Is the provider willing to subscribe his Apple Calendar to it, or should we read his own calendar’s free/busy instead?',
      'What working hours and what notice does he want enforced, independently of the calendar?',
    ],

    /**
     * The busy blocks in a range.
     *
     * `from` and `to` are calendar dates in Florence time; the API wants instants,
     * and gets them from the same wall-clock conversion the rest of the commerce
     * layer uses, so a booking at 09:00 means nine in Florence in both halves of the
     * system — including on the two days a year the clocks move.
     */
    async freeBusy({ from, to }) {
      if (!configured) refuse('free/busy');
      const timeMin = propertyTimeToInstant(from, '00:00');
      const timeMax = propertyTimeToInstant(addDays(to, 1), '00:00');
      if (!timeMin || !timeMax) throw new GoogleError('free/busy needs two valid dates', { code: 'bad-range' });

      try {
        const payload = await client.call(`${API}/freeBusy`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            timeZone: PROPERTY_TIMEZONE,
            items: [{ id: readCalendar }, ...(writeCalendar && writeCalendar !== readCalendar ? [{ id: writeCalendar }] : [])],
          }),
        });

        const calendars = payload.calendars ?? {};
        const busy = Object.values(calendars).flatMap((entry) => entry.busy ?? []);
        const errors = Object.entries(calendars).flatMap(([id, entry]) =>
          (entry.errors ?? []).map((error) => ({ calendar: id, reason: error.reason })));
        if (errors.length > 0) {
          // A calendar we cannot read is not an empty calendar. Say so loudly rather
          // than offering slots that may already be taken.
          throw new GoogleError(`free/busy refused: ${errors.map((e) => `${e.calendar} ${e.reason}`).join(', ')}`, {
            code: 'calendar-unreadable',
            status: 403,
          });
        }

        state.reads += 1;
        state.lastSuccessAt = new Date().toISOString();
        state.lastError = null;
        return busy;
      } catch (error) {
        state.lastError = error.message;
        throw error;
      }
    },

    /**
     * The event body for a booking.
     *
     * Built here rather than at the call site so what lands in his calendar is
     * consistent: who it is for, which room, and how long to block out. The duration
     * comes from the internal table and is never shown to the guest.
     */
    eventFor(booking) {
      const window = appointmentWindow(booking);
      const minutes = window?.minutes ?? serviceMinutes(booking.variantId);
      return {
        summary: `LunArt · ${booking.serviceTitle ?? booking.variantId} · camera ${booking.room ?? '—'}`,
        description: [
          booking.guestName ? `Ospite: ${booking.guestName}` : null,
          booking.phone ? `Telefono: ${booking.phone}` : null,
          booking.orderId ? `Ordine: ${booking.orderId}` : null,
          booking.notes ? `Note: ${booking.notes}` : null,
          'Niente lavaggio: l’ospite arriva con i capelli già lavati dove serve.',
        ].filter(Boolean).join('\n'),
        location: `LunArt · Vicolo del Canneto 2, Firenze · camera ${booking.room ?? '—'}`,
        start: { dateTime: window ? window.start.toISOString() : null, timeZone: PROPERTY_TIMEZONE },
        end: { dateTime: window ? window.end.toISOString() : null, timeZone: PROPERTY_TIMEZONE },
        minutes,
        /**
         * Google's own de-duplication: the same order sent twice produces one event.
         * The id has to be base32hex-ish and at least five characters.
         */
        id: booking.orderId ? `lunart${String(booking.orderId).replace(/[^a-v0-9]/gi, '').toLowerCase().slice(0, 40)}` : undefined,
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }] },
      };
    },

    /**
     * Write a confirmed booking.
     *
     * With no calendar connected this returns `{ ok: false, reason }` rather than
     * throwing: the appointment exists and is paid for either way, and the order
     * records that it has not reached a calendar so staff can see it.
     */
    async createEvent(booking) {
      const event = this.eventFor(booking);
      if (!configured) return { ok: false, reason: 'source-not-configured', event };
      if (!event.start.dateTime) return { ok: false, reason: 'bad-appointment-time', event };

      const { minutes, ...body } = event;
      try {
        const created = await client.call(`${API}/calendars/${encodeURIComponent(writeCalendar)}/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        state.writes += 1;
        state.lastSuccessAt = new Date().toISOString();
        state.lastError = null;
        return { ok: true, id: created.id, htmlLink: created.htmlLink ?? null, event };
      } catch (error) {
        // An id that already exists means we have written this booking before.
        if (error.status === 409) return { ok: true, id: event.id, duplicate: true, event };
        state.lastError = error.message;
        return { ok: false, reason: error.code ?? 'calendar-failed', message: error.message, event };
      }
    },

    /** Take a cancelled appointment back out. A gone event is a success, not an error. */
    async deleteEvent(eventId) {
      if (!configured) return { ok: false, reason: 'source-not-configured' };
      if (!eventId) return { ok: false, reason: 'no-event-id' };
      try {
        await client.call(`${API}/calendars/${encodeURIComponent(writeCalendar)}/events/${encodeURIComponent(eventId)}`, {
          method: 'DELETE',
        });
        state.lastSuccessAt = new Date().toISOString();
        return { ok: true };
      } catch (error) {
        if (error.status === 404 || error.status === 410) return { ok: true, alreadyGone: true };
        state.lastError = error.message;
        return { ok: false, reason: error.code ?? 'calendar-failed', message: error.message };
      }
    },

    async check() {
      if (!client.configured) return { ok: false, reason: 'credentials-missing' };
      if (!readCalendar) return { ok: false, reason: 'credentials-missing' };
      try {
        await client.accessToken({ force: true });
        return { ok: true };
      } catch (error) {
        state.lastError = error.message;
        return { ok: false, reason: error.code ?? 'unavailable', message: error.message };
      }
    },
  };
}

/** Registry, so a different provider's calendar is a registration rather than an edit. */
const calendars = new Map([['google-calendar', createGoogleCalendarAdapter]]);
export const registerProviderCalendar = (id, factory) => calendars.set(id, factory);

export function createProviderCalendar(settings = {}) {
  const chosen = settings.providerCalendar ?? 'google-calendar';
  const factory = calendars.get(chosen) ?? createGoogleCalendarAdapter;
  return factory(settings);
}

export const providerCalendars = (settings = {}) =>
  [...calendars.entries()].map(([id, factory]) => {
    const adapter = factory(settings);
    return {
      id,
      implemented: adapter.implemented !== false,
      configured: adapter.configured,
      requires: adapter.requires,
    };
  });
