/**
 * The hair professional's calendar.
 *
 * Two jobs, and they are different:
 *
 *   reading   when is he free? That decides which slots a guest is ever shown.
 *   writing   a confirmed booking goes into a calendar he already looks at, so the
 *             appointment exists in his day rather than only in our database.
 *
 * Google Calendar is the right target even though he uses an iPhone: an Apple
 * Calendar subscribed to a Google account syncs both ways, so he carries on as he
 * is and the server talks to one API. A dedicated calendar — "LunArt Hair
 * Bookings" — keeps our writes out of his personal one and makes free/busy
 * answerable without reading anything private.
 *
 * None of it is connected. There is no service account, no calendar id and no
 * consent yet, so this reports `configured: false`, every call refuses, and the
 * schedule stays empty — which is why the guide offers no appointments rather than
 * a plausible grid. An adapter that invented availability would be the one failure
 * a guest cannot forgive: a professional turning up to a slot he never had.
 */

import { serviceMinutes } from '../../commerce/schedule.js';

/**
 * @typedef {object} ProviderCalendarAdapter
 * @property {string} id
 * @property {boolean} configured
 * @property {string[]} requires
 * @property {(range: {from: string, to: string}) => Promise<object[]>} freeBusy
 * @property {(booking: object) => Promise<object>} createEvent
 * @property {(eventId: string) => Promise<void>} [deleteEvent]
 */

export function createGoogleCalendarAdapter(settings = {}) {
  const {
    googleCalendarId,
    googleServiceAccountEmail,
    googleServiceAccountKey,
    googleCalendarWriteId,
  } = settings;

  const configured = Boolean(googleCalendarId && googleServiceAccountEmail && googleServiceAccountKey);

  const refuse = (what) => {
    throw Object.assign(
      new Error(`google calendar is not configured (${what})`),
      { code: 'source-not-configured' },
    );
  };

  return {
    id: 'google-calendar',
    configured,
    requires: [
      'GOOGLE_CALENDAR_ID',
      'GOOGLE_SERVICE_ACCOUNT_EMAIL',
      'GOOGLE_SERVICE_ACCOUNT_KEY',
      'GOOGLE_CALENDAR_WRITE_ID',
    ],
    /** Where confirmed LunArt appointments are written. */
    writeCalendar: googleCalendarWriteId ?? 'LunArt Hair Bookings',
    capabilities: ['free-busy', 'create-event', 'delete-event'],
    openQuestions: [
      'Which Google account owns the calendar LunArt may read and write?',
      'Is the provider willing to subscribe his Apple Calendar to it, or should we read his own calendar’s free/busy instead?',
      'What working hours and what notice does he want enforced, independently of the calendar?',
    ],

    /** The busy blocks in a range, so free slots can be computed around them. */
    async freeBusy() {
      if (!configured) refuse('free/busy');
      return refuse('free/busy not implemented');
    },

    /**
     * Write a confirmed booking.
     *
     * The event is built here rather than at the call site, so what lands in the
     * provider's calendar is consistent: who it is for, which room, and how long to
     * block out. The duration comes from the internal service table and is never
     * shown to the guest.
     */
    eventFor(booking) {
      const minutes = serviceMinutes(booking.variantId);
      return {
        summary: `LunArt · ${booking.serviceTitle ?? booking.variantId} · camera ${booking.room ?? '—'}`,
        description: [
          booking.guestName ? `Ospite: ${booking.guestName}` : null,
          booking.phone ? `Telefono: ${booking.phone}` : null,
          booking.orderId ? `Ordine: ${booking.orderId}` : null,
          booking.notes ? `Note: ${booking.notes}` : null,
        ].filter(Boolean).join('\n'),
        start: { dateTime: `${booking.date}T${booking.time}:00`, timeZone: 'Europe/Rome' },
        end: { dateTime: `${booking.date}T${booking.time}:00`, timeZone: 'Europe/Rome', addMinutes: minutes },
        minutes,
      };
    },

    async createEvent(booking) {
      const event = this.eventFor(booking);
      if (!configured) {
        // Recorded on the order instead, so the appointment is not lost and the
        // Staff app can say it has not reached a calendar.
        return { ok: false, reason: 'source-not-configured', event };
      }
      return refuse('createEvent not implemented');
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
    return { id, configured: adapter.configured, requires: adapter.requires };
  });
