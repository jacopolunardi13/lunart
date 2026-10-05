/**
 * The LunArt Pass.
 *
 * Every guest with a reservation has one, and nobody buys it. That is the whole
 * idea: the Pass is not a product, it is the stay itself expressed as something a
 * guest can hold up — their name, their room, their dates, and whether it is live
 * right now. It is derived from the reservation on every read rather than stored,
 * so it cannot drift from the booking it describes: change the dates and the Pass
 * changes with them, cancel the stay and the Pass stops being valid, with nothing
 * to migrate and no second record to keep in step.
 *
 * It exists because of the breakfast vouchers. LunArt hands out paper tokens, one
 * per person per day, and Opera Caffè collects them — that system works and is not
 * being replaced here. There are no scanners, no counters and no camera at the
 * till. What the Pass adds is the second half of the check: a token is good when
 * the paper is good *and* the Pass is live. Somebody who kept a voucher from
 * August can still produce the paper; they cannot produce a Pass that says
 * "attivo", because theirs expired at the end of their last night.
 *
 * Privilege is the same Pass, unlocked. Not a second card: when a guest buys the
 * upgrade, the card issued by that order is bound to this reservation and the Pass
 * they already had starts rendering as Privilege, with whatever the paid tier adds
 * on top of what the stay already included. A guest should experience one card
 * that got better, because that is what happened.
 */

import { propertyDate, isValidDate, endOfPropertyDay, propertyTimeToInstant } from '../commerce/time.js';
import { stayDates } from '../commerce/stay.js';
import { stayBenefits, cardBenefits } from '../commerce/partners.js';
import { RESERVATION_STATUS } from './reservations.js';

/** The two tiers one Pass can be in. There is no third, and no second card. */
export const PASS_TIER = {
  /** Comes with the stay. Never sold, never not there. */
  pass: 'pass',
  /** The same card, after the upgrade was bought. */
  privilege: 'privilege',
};

export const PASS_STATE = {
  /** The stay has not begun. The Pass exists and says so. */
  notStarted: 'not-started',
  active: 'active',
  /** Past the last night. A voucher kept from this stay is no longer backed. */
  expired: 'expired',
  /** The booking was called off. */
  cancelled: 'cancelled',
  /** No dates to reason about. */
  unknown: 'unknown',
};

/**
 * Where a Pass is in its life.
 *
 * Measured in LunArt's own day, not the phone's: a guest in another time zone
 * reading their Pass at midnight gets Florence's answer, which is the one the
 * person behind the counter is also working from. It runs to the *end* of the
 * checkout day, so breakfast on the morning you leave is still covered — and the
 * minute after that it is not.
 */
export function passState(reservation, now = new Date()) {
  if (!reservation) return PASS_STATE.unknown;
  if (reservation.status === RESERVATION_STATUS.cancelled) return PASS_STATE.cancelled;
  if (!isValidDate(reservation.check_in) || !isValidDate(reservation.check_out)) return PASS_STATE.unknown;

  const nowMs = now.getTime();
  if (nowMs >= endOfPropertyDay(reservation.check_out).getTime()) return PASS_STATE.expired;
  if (nowMs < propertyTimeToInstant(reservation.check_in, '00:00').getTime()) return PASS_STATE.notStarted;
  return PASS_STATE.active;
}

/** True only while the Pass actually backs a paper voucher. */
export const passIsLive = (reservation, now = new Date()) =>
  passState(reservation, now) === PASS_STATE.active;

/**
 * A short reference a guest can read down the phone.
 *
 * The staff reference the reservation already carries, not a new identifier: one
 * number for one stay, which is what somebody looking it up expects. It is not a
 * credential — the guide token is — so it is safe on a screen anyone can see.
 */
const referenceOf = (reservation) => String(reservation.staff_ref ?? '').toUpperCase();

/**
 * The Pass, as the guest's phone should draw it.
 *
 * The holder is the first name only. Everything about the personal link is built
 * so the surname never travels in a URL or sits on a screen in a breakfast room,
 * and a card is not a reason to undo that. A Privilege card bought with a name the
 * guest typed themselves shows that name instead, because they chose it.
 *
 * @param {object} reservation  the stay this Pass belongs to
 * @param {object|null} card    the privilege card bound to it, when one was bought
 */
export function passFor(reservation, { card = null, now = new Date() } = {}) {
  if (!reservation) return null;

  const state = passState(reservation, now);
  const upgraded = Boolean(card && card.status !== 'revoked');
  const nights = Math.max(0, stayDates(reservation).length - 1);

  return {
    object: 'lunart_pass',
    tier: upgraded ? PASS_TIER.privilege : PASS_TIER.pass,
    state,
    /** True exactly when a paper voucher presented today is backed by this Pass. */
    live: state === PASS_STATE.active,

    holder: upgraded && card.holder_name ? card.holder_name : (reservation.first_name ?? ''),
    room: reservation.room || null,
    check_in: reservation.check_in,
    check_out: reservation.check_out,
    nights,
    guests: reservation.guest_count || reservation.adults || 1,
    reference: referenceOf(reservation),

    /**
     * What the stay already includes — the Opera Caffè 30% among it.
     *
     * It stays on this side of the line whatever tier the Pass is in. It is not a
     * reason to buy the upgrade and must never be listed as one: selling a guest
     * something they already have is the fastest way to stop being believed.
     */
    included: stayBenefits(),
    /** What the upgrade adds, and only once it has actually been bought. */
    privileges: upgraded ? cardBenefits() : [],

    /** Present only on an upgraded Pass, so the QR screen can be opened. */
    card: upgraded
      ? { access_token: card.access_token, reference: card.public_ref, end_date: card.end_date }
      : null,

    /** Today in Florence, so the phone does not have to be right about it. */
    today: propertyDate(now),
  };
}

/**
 * The Pass for a stay, with whatever upgrade was bought against it.
 *
 * The card is found through the reservation rather than through anything the
 * browser remembers, which is the point: a guest who upgraded on their laptop and
 * opens the link on their phone has a Privilege Pass on both.
 */
export async function passForReservation({ store, reservation, now = new Date() }) {
  if (!reservation) return null;
  const cards = await store.cards.filter((card) => (
    card.reservation_id === reservation.id && card.status !== 'revoked'
  ));
  // The longest-lived one, so an upgrade bought twice shows the one still running.
  const card = cards.sort((a, b) => String(b.end_date).localeCompare(String(a.end_date)))[0] ?? null;
  return passFor(reservation, { card, now });
}
