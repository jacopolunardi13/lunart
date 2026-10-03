/**
 * The personal guide link.
 *
 * `/g/<token>` is the whole mechanism. The token is 24 random bytes and means
 * nothing: no name, no room, no dates, no booking number, nothing that could be
 * read off it or guessed from a neighbouring one. The server turns it into a
 * reservation; the browser is told only what the guide needs to use it.
 *
 * That constraint is not decoration. These links travel by email, through OTA relay
 * addresses, into screenshots and group chats. A link that encoded "Venturi, room
 * 303, 12–15 October" would be telling everyone who ever sees it exactly that.
 *
 * Recovery exists because links get lost. Surname plus booking number, rate limited,
 * with one answer for every failure: a guest who cannot find their email gets back
 * in, and somebody working through booking numbers learns nothing from the
 * difference between a wrong number and a right one.
 */

import { guestContext, isLive, rotateGuideToken, stayOf, propertyDate } from './reservations.js';
import { guideUrl } from './delivery.js';

/** Resolve a token. Null for anything that is not a live token, without saying why. */
export async function resolveGuideLink({ store, token, now = new Date() }) {
  const clean = String(token ?? '').trim();
  if (clean.length < 16) return null;
  const reservation = await store.reservations.findByGuideToken(clean);
  if (!reservation) return null;
  return {
    reservation,
    context: guestContext(reservation, { now }),
    stay: stayOf(reservation),
    live: isLive(reservation),
  };
}

/**
 * What the browser gets for a personal link.
 *
 * A cancelled stay still resolves — the guest may have paid for something against
 * it, and a page that simply fails tells them nothing. It comes back marked
 * cancelled, with the dates, and nothing new can be bought against it.
 */
export function guideContextView(resolved) {
  if (!resolved) return null;
  const { context, reservation } = resolved;
  return {
    ...context,
    /** Staff reference, so a guest on the phone can be found without the token. */
    reference: reservation.staff_ref,
    /** Purchases are allowed only while the stay is live. */
    can_purchase: isLive(reservation),
  };
}

/**
 * Give a lost link back.
 *
 * Deliberately uniform: every failure is `{ ok: false, reason: 'not-found' }`,
 * whether the surname was wrong, the number was wrong, the stay was cancelled or
 * the reservation never existed. The caller turns that into one message.
 */
export async function recoverGuideLink({ store, lastName, reference, origin = '', now = new Date(), rotate = false }) {
  const reservation = await store.reservations.findForRecovery(lastName, reference);
  if (!reservation) return { ok: false, reason: 'not-found' };
  if (!isLive(reservation)) return { ok: false, reason: 'not-found' };

  // Past stays are not recovered: there is nothing left to use the link for, and a
  // finished reservation that stays reachable is a record left lying around. The
  // nightly sweep normally marks these completed; this is the belt to its braces.
  if (reservation.check_out && reservation.check_out < propertyDate(now)) {
    return { ok: false, reason: 'not-found' };
  }

  const current = rotate ? await rotateGuideToken({ store, reservation }) : reservation;
  return {
    ok: true,
    link: guideUrl(origin, current),
    first_name: current.first_name,
    check_in: current.check_in,
    check_out: current.check_out,
  };
}

export { guideUrl, rotateGuideToken };
