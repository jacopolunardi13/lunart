/**
 * What a guest can ask, expressed over concepts rather than words.
 *
 * `anchors` is the important field: at least one anchor concept must be present
 * for an intent to be considered at all. An intent can never be reached by its
 * supporting concepts alone, which is what stops "si può fumare in camera?" from
 * being answered as a question about rooms, and "quale autobus prendo?" from being
 * answered as a question about parking — the latter also carries an explicit
 * blocker, because a bus is not a car no matter how the word is spelled.
 *
 * `entry` names a row in the knowledge layer. The engine never writes prose.
 */

export const INTENTS = [
  // ── Arrival ──────────────────────────────────────────────────────────────
  { id: 'checkin', entry: 'checkin', anchors: ['checkin', 'arrival'],
    support: { room: 0.5 }, blockers: ['checkout', 'airport', 'station'] },

  { id: 'late-arrival', entry: 'late-arrival', anchors: ['late'],
    support: { checkin: 2, arrival: 2, access: 1 }, blockers: ['checkout', 'dining'] },

  { id: 'access', entry: 'access', anchors: ['access'], support: { arrival: 0.5 } },

  { id: 'address', entry: 'access', anchors: ['address'] },

  { id: 'luggage', answersPrice: true, entry: 'luggage-early', anchors: ['luggage'],
    refine: [{ concept: 'checkout', entry: 'luggage-late' }] },

  { id: 'parking', answersPrice: true, entry: 'parking', anchors: ['parking', 'car'],
    support: { ztl: 1 }, blockers: ['publicTransport', 'taxi', 'transfer'] },

  { id: 'ztl', entry: 'ztl', anchors: ['ztl'], support: { car: 1, parking: 1 } },

  { id: 'public-transport', entry: 'getting-around', anchors: ['publicTransport'] },

  { id: 'from-station', entry: 'from-station', anchors: ['station'],
    entryByPhase: { leaving: 'to-station' }, support: { arrival: 1 } },

  { id: 'airport', entry: 'from-airport', anchors: ['airport'],
    entryByPhase: { staying: 'to-airport', leaving: 'to-airport' } },

  { id: 'city-tax', answersPrice: true, entry: 'city-tax', anchors: ['cityTax'] },

  // ── The room ─────────────────────────────────────────────────────────────
  { id: 'wifi', entry: 'wifi', anchors: ['wifi'] },

  { id: 'climate', entry: 'climate', anchors: ['climate'], support: { problem: 1, room: 0.5 } },

  { id: 'towel-rail', entry: 'towel-rail', anchors: ['towelRail'] },

  { id: 'cleaning', answersPrice: true, entry: 'cleaning', anchors: ['cleaning', 'towels'] },

  { id: 'amenities', entry: 'amenities', anchors: ['amenities', 'bathroom'], support: { room: 1 } },

  { id: 'room-info', entry: 'amenities', anchors: ['room'] },

  { id: 'welcome', entry: 'welcome', anchors: ['welcomeGift'] },

  { id: 'noise', entry: 'noise', anchors: ['noise'] },

  { id: 'smoking', entry: 'smoking', anchors: ['smoking'] },

  { id: 'pets', entry: 'pets', anchors: ['pets'] },

  { id: 'children', entry: 'children', anchors: ['children'] },

  { id: 'accessibility', entry: 'accessibility', anchors: ['accessibility'] },

  // ── Breakfast ────────────────────────────────────────────────────────────
  { id: 'breakfast', answersPrice: true, entry: 'breakfast', anchors: ['breakfast'],
    blockers: ['dietary', 'discount'] },

  { id: 'breakfast-room', entry: 'breakfast-room', anchors: ['breakfast'],
    support: { room: 3 }, blockers: ['dietary'] },

  { id: 'breakfast-light', entry: 'breakfast-light', anchors: ['breakfast'],
    support: { quick: 3 }, blockers: ['dietary'] },

  { id: 'breakfast-early', entry: 'breakfast-early', anchors: ['early'],
    support: { breakfast: 3, checkout: 1 } },

  { id: 'dietary', entry: 'dietary', anchors: ['dietary'] },

  { id: 'opera-benefit', answersPrice: true, entry: 'opera-benefit', anchors: ['discount'] },

  // ── Help ─────────────────────────────────────────────────────────────────
  // Naming what you want to call beats the generic "call someone".
  { id: 'contacts', entry: 'contacts', anchors: ['contact'],
    blockers: ['emergency', 'taxi', 'transfer'] },

  // A broken thing is a problem first and an amenity second: "il frigo non funziona"
  // must reach the help entry, not the list of what the room contains.
  { id: 'room-problem', entry: 'room-problem', anchors: ['problem'],
    support: { room: 1, amenities: 2, bathroom: 1 }, blockers: ['climate', 'towelRail', 'wifi'] },

  { id: 'emergency', entry: 'emergency', anchors: ['emergency'] },

  { id: 'invoice', answersPrice: true, entry: 'invoice', anchors: ['invoice'] },

  { id: 'booking-terms', answersPrice: true, entry: 'booking-terms', anchors: ['booking'] },

  /**
   * "Quanto costa?" is a facet, not a subject. This intent only speaks when nothing
   * else does, or when the intent that did cannot answer about money — so "quanto
   * costa il parcheggio" stays on the parking entry, which carries the rate, while
   * "quanto costa la camera" leaves the amenities list and goes to the staff.
   */
  { id: 'price', entry: 'booking-terms', anchors: ['price'], weak: true, qualifier: 'price' },

  // ── Departure ────────────────────────────────────────────────────────────
  { id: 'checkout', entry: 'checkout', anchors: ['checkout'],
    blockers: ['luggage', 'airport', 'station', 'taxi'] },

  { id: 'taxi', answersPrice: true, entry: 'taxi', anchors: ['taxi'] },

  { id: 'transfer', answersPrice: true, entry: 'transfer', anchors: ['transfer'] },

  // ── Florence ─────────────────────────────────────────────────────────────
  { id: 'eat', entry: 'eat', anchors: ['dining', 'steak'], support: { advice: 0.5 }, blockers: ['breakfast'] },

  { id: 'gelato', entry: 'gelato', anchors: ['gelato'] },

  { id: 'aperitivo', entry: 'aperitivo', anchors: ['aperitivo'], blockers: ['dining'] },

  { id: 'museums', entry: 'museums', anchors: ['museum'] },

  { id: 'itinerary', entry: 'walks', anchors: ['itinerary'], support: { advice: 1 } },

  { id: 'day-trip', entry: 'day-trips', anchors: ['dayTrip'] },

  { id: 'wellness', entry: 'wellness', anchors: ['wellness'] },
];

/** Offered on a fallback, and as the opening suggestions, per guest phase. */
export const QUICK_REPLIES = {
  before:  ['checkin', 'access', 'parking', 'luggage'],
  staying: ['wifi', 'breakfast', 'eat', 'room-problem'],
  leaving: ['checkout', 'luggage', 'taxi', 'airport'],
};
