/**
 * Which three things to offer, and when.
 *
 * Most LunArt stays are one or two nights. That single fact rules out the obvious
 * design: anything that makes a product *disappear* because the guest is in the
 * wrong part of their stay would, on a one-night booking, hide most of the
 * catalogue for most of the time the guest is holding the phone. So nothing is
 * ever hidden. Every product stays one tap away in the shop, always, and the only
 * thing the moment changes is which three come first on the home.
 *
 * The order is a table, not an algorithm. A table can be read by somebody who was
 * not here when it was written, argued with over a coffee, and changed in one line
 * — which is what this will need, because the right answer is a merchandising
 * judgement that will move. An algorithm that scored products on recency and
 * margin would be harder to change and no better at guessing.
 *
 * Products not named in a list are not excluded; they sort after the named ones in
 * catalogue order. So adding a product to the shop puts it in the ranking
 * automatically, at the back, and naming it in a list is how it moves up.
 */

import { PRODUCTS } from './catalog.js';
import { isPurchasable } from './index.js';

/**
 * The four moments of a stay, as commerce sees them.
 *
 * One finer than the guide's own three: the day a guest actually arrives is not
 * the same selling moment as the fortnight before it. Somebody still at home is
 * thinking about getting here; somebody who just put their bag down is thinking
 * about this evening.
 */
export const MOMENTS = ['before', 'arrival', 'staying', 'leaving'];

/**
 * The order, per moment. First in the list is first on the home.
 *
 * — Before arriving, the useful things are the ones that need arranging in
 *   advance: how they get here, and anything waiting in the room when they
 *   walk in.
 * — On arrival day, the bottle in the room is the offer that lands, because it
 *   is tonight and it needs no planning.
 * — During the stay, the bottle still leads, then the things that take an
 *   appointment while there is still time to keep it.
 * — On the way out, bags come first; nothing else is going to happen today.
 */
export const PRIORITY = {
  before:   ['transfer-airport', 'celebration', 'wine-in-room', 'luggage-transfer', 'brunch', 'privilege-card'],
  arrival:  ['privilege-card', 'wine-in-room', 'celebration', 'brunch', 'hair-service', 'transfer-airport'],
  staying:  ['privilege-card', 'wine-in-room', 'hair-service', 'brunch', 'celebration', 'chianti-experience'],
  leaving:  ['luggage-transfer', 'transfer-airport', 'wine-in-room', 'brunch', 'privilege-card'],
};

/** How many the home shows. Three is a choice; four is a list. */
export const FEATURED = 3;

/**
 * Which moment a guest is in.
 *
 * From the dates rather than from a guess, and from LunArt's own day rather than
 * the phone's. Without a reservation — the public guide — there is nothing to
 * date it by, so it falls to `before`: somebody reading without a booking is, by
 * definition, not here yet.
 */
export function momentOf({ phase = 'before', checkIn = null, today = null } = {}) {
  if (checkIn && today && checkIn === today) return 'arrival';
  if (phase === 'staying' || phase === 'leaving') return phase;
  return 'before';
}

/**
 * The three to put on the home, for this moment.
 *
 * Only things that can actually be bought: a tile that opens a sheet saying "not
 * on sale yet" spends a guest's attention and gives nothing back. Coming-soon
 * products keep their own rules and their own place in the shop, greyed and
 * unpriced; they are simply not what the home leads with.
 */
export function featuredProducts({
  moment = 'before',
  products = PRODUCTS,
  limit = FEATURED,
  allowPlaceholders = true,
} = {}) {
  const order = PRIORITY[moment] ?? PRIORITY.before;
  const rank = (product) => {
    const at = order.indexOf(product.id);
    return at === -1 ? order.length + products.indexOf(product) : at;
  };

  return products
    .filter((product) => product.active && !product.comingSoon && product.status !== 'coming-soon')
    .filter((product) => isPurchasable(product, { allowPlaceholders }) || product.purchaseMode === 'request-only')
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, limit);
}

/**
 * The same, from a guest context.
 *
 * A convenience so the browser never has to work out the moment itself and get a
 * different answer from the one the tests check.
 */
export const featuredForGuest = (guest, options = {}) => featuredProducts({
  moment: momentOf({
    phase: guest?.phase,
    checkIn: guest?.check_in ?? null,
    today: guest?.today ?? null,
  }),
  ...options,
});
