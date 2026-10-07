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
import { roomsIn } from '../commerce/rooms.js';
import { stayBenefits, cardBenefits, ENTITLEMENTS } from '../commerce/partners.js';
import { RESERVATION_STATUS } from './reservations.js';
import { cardState } from './card.js';

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
 * What a reservation is entitled to, by name.
 *
 * This is the other half of eligibility, and it is deliberately not the same
 * question as `passState`. A Pass can be perfectly live and entitled to nothing —
 * that is every guest who has not upgraded — and a revoked card entitles a guest to
 * nothing however live their stay is. Partner benefits ask for both, through
 * `benefitAccess` in `commerce/partners.js`, so neither half can be mistaken for
 * the whole answer.
 *
 * `card.add_ons` is the seam for an add-on bought on top of Privilege, on the same
 * card — the Shopping add-on, when it exists. Nothing writes it today: no product,
 * no SKU, no checkout path. It is read here so that activating one later is a
 * commercial decision rather than a refactor.
 */
export function entitlementsOf(card) {
  if (!card || card.status === 'revoked') return [];
  const addOns = Array.isArray(card.add_ons) ? card.add_ons.filter(Boolean) : [];
  return [...new Set([ENTITLEMENTS.privilege, ...addOns])];
}

/**
 * The same entitlements, narrowed to the ones that are actually running today.
 *
 * Owning Privilege and Privilege being in force are not the same day. The upgrade is
 * sold by the day — two, five or eight — and a stay can be longer than the card
 * bought for it: book 1–6 November, buy two days for the 3rd, and there are three
 * states inside one stay. On the 1st the card has not started; on the 3rd it is
 * running; on the 5th it is over, and the stay is still going.
 *
 * Which is why this is a second list rather than a narrower definition of the first.
 * Taking `privilege` out of `entitlements` on the 1st would be the easy fix and the
 * wrong one: the Pass would stop rendering as Privilege, the card the guest paid for
 * would disappear from their screen, and they would be offered the upgrade they
 * already own. Ownership is the first list and never moves; this one is what a door
 * would honour tonight.
 *
 * The date comes from `cardState`, the card's own clock, which is Florence's. There
 * is no second calendar here.
 */
export function liveEntitlementsOf(card, now = new Date()) {
  return cardState(card, now) === 'active' ? entitlementsOf(card) : [];
}

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
  const entitlements = entitlementsOf(card);
  const upgraded = entitlements.length > 0;
  const nights = Math.max(0, stayDates(reservation).length - 1);

  return {
    object: 'lunart_pass',
    tier: upgraded ? PASS_TIER.privilege : PASS_TIER.pass,
    state,
    /** True exactly when a paper voucher presented today is backed by this Pass. */
    live: state === PASS_STATE.active,

    /**
     * What this reservation has bought, by name. Ownership, and nothing else: it
     * does not narrow when the card's own dates have not started or have passed.
     * Empty on a Pass that was never upgraded — which is not the same as hiding
     * what the upgrade would unlock: see the Privilege section in
     * `src/commerce/ui/pass.js`, where the locked benefits are still shown.
     */
    entitlements,
    /**
     * And which of them a venue would honour tonight. The pair is what lets a
     * screen say "this is yours, and it starts on Tuesday" instead of having to
     * choose between the two halves of that sentence.
     */
    live_entitlements: liveEntitlementsOf(card, now),

    holder: upgraded && card.holder_name ? card.holder_name : (reservation.first_name ?? ''),
    /**
     * The room on the card, and the rooms on the booking.
     *
     * `room` stays null unless there is exactly one, so the card face shows the
     * dates alone for a group across four rooms rather than picking one of them.
     * The set travels alongside for the sheet underneath, which has room for a
     * line of text. Neither changes what the Pass is worth or what it unlocks.
     */
    room: reservation.room || null,
    rooms: roomsIn(reservation),
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
    /**
     * What the upgrade adds, and only once it has actually been bought.
     *
     * Still gated here, so nothing downstream can mistake a standard Pass for an
     * upgraded one. The guide discovers the locked ones from the published partner
     * register instead, which is a different question with a different answer.
     */
    privileges: upgraded ? cardBenefits() : [],

    /**
     * Present on an upgraded Pass, whether or not the card can be used yet.
     *
     * Owning the upgrade and being able to use it tonight are two different
     * questions, and the card's own `state` is the answer to the second one. A
     * guest who bought Privilege in September for a stay in November owns a card
     * that says `not-started`, and the screen that opens from here says so and
     * explains when the code appears — which is a great deal better than a Pass
     * that quietly pretends nothing was bought.
     *
     * No code travels with this. The QR is issued by `/api/card/:token` and only
     * for a card that is actually active; nothing here changes that.
     */
    card: upgraded
      ? {
        access_token: card.access_token,
        reference: card.public_ref,
        start_date: card.start_date,
        end_date: card.end_date,
        state: cardState(card, now),
      }
      : null,

    /** Today in Florence, so the phone does not have to be right about it. */
    today: propertyDate(now),
  };
}

/**
 * Every live card this stay owns, found two ways because there are two ways to
 * have been written down.
 *
 * The direct one is `card.reservation_id`, set when the card is issued. The other
 * is through the order: a card belongs to the order that paid for it, and an order
 * belongs to a reservation, so a card whose own binding is missing is still
 * unambiguously this stay's. That second route is not a nicety — cards issued
 * before the Pass existed were written with `reservation_id: null`, and the symptom
 * is nasty precisely because it is half-right: the purchase shows up in "I miei
 * acquisti" (orders *are* bound) while the Pass renders as a plain Pass, so a guest
 * is looking at a receipt for something their card says they do not have.
 *
 * Found that way, the binding is written back. The card really is owned by this
 * reservation; recording it is writing down a fact rather than inventing one, it
 * happens once per card, and leaving it would mean every future query that joins on
 * `reservation_id` rediscovering the same hole.
 */
export async function cardsForReservation({ store, reservation }) {
  if (!reservation?.id) return [];

  const orders = await store.orders.filter((order) => order.reservation_id === reservation.id);
  const orderIds = new Set(orders.map((order) => order.id));

  const cards = await store.cards.filter((card) => card.status !== 'revoked' && (
    card.reservation_id === reservation.id
    || (!card.reservation_id && card.order_id && orderIds.has(card.order_id))
  ));

  const repaired = [];
  for (const card of cards) {
    if (card.reservation_id === reservation.id) { repaired.push(card); continue; }
    console.warn('[pass] card', card.public_ref, 'was bound to no stay; binding it to', reservation.id);
    repaired.push(await store.cards.update(card.id, { reservation_id: reservation.id }) ?? card);
  }
  return repaired;
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
  const cards = await cardsForReservation({ store, reservation });
  // The longest-lived one, so an upgrade bought twice shows the one still running.
  const card = cards.sort((a, b) => String(b.end_date).localeCompare(String(a.end_date)))[0] ?? null;
  return passFor(reservation, { card, now });
}
