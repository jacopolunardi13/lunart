/**
 * What a sellable thing is.
 *
 * The same modules are imported by the browser and by the server. That is on
 * purpose: the catalogue has one definition, so the two cannot disagree about what
 * exists. Money is the exception — see `prices.js`. The browser is shown prices so
 * it can render them, but it never sends one: a cart line carries ids, quantities
 * and dates, and the server prices it from scratch.
 *
 * All amounts are integer minor units (eurocents). Floating point has no business
 * anywhere near a total.
 */

/** How we know whether a thing can be bought right now. */
export const AVAILABILITY_MODES = {
  /** On the shelf. Nothing to check. */
  always: 'always',
  /** Orderable until a deadline relative to the delivery date (breakfast, wine). */
  cutoff: 'cutoff',
  /** Discrete slots from an availability source (experiences, transfers). */
  timeslots: 'timeslots',
  /** Bookable, but a human or partner confirms before it is owed (NCC). */
  'manual-confirm': 'manual-confirm',
  /** Lives in someone else's system; we hand the guest over. */
  external: 'external',
  /** No calendar at all: the guest asks, staff answer. */
  request: 'request',
};

/** How money moves. */
export const PURCHASE_MODES = {
  /** Charged on checkout. */
  instant: 'instant',
  /** Authorised on checkout, captured only once the provider confirms. */
  'authorize-then-capture': 'authorize-then-capture',
  /** Paid on the partner's own checkout; we only hand over. */
  'external-checkout': 'external-checkout',
  /** Nothing is charged; it creates an enquiry. */
  'request-only': 'request-only',
};

/** What happens after the money. */
export const FULFILMENT_TYPES = {
  /** Issues something digital the guest holds — the Privilege Card. */
  'digital-entitlement': 'digital-entitlement',
  /** Delivered to the room by LunArt or a partner. */
  'in-room': 'in-room',
  /** Carried out by an external provider (driver, guide, cellar). */
  provider: 'provider',
  /** Redeemed at a partner's premises. */
  partner: 'partner',
  /** Handled by LunArt staff, no third party. */
  staff: 'staff',
};

/**
 * Publication state, kept apart from `active` on purpose.
 *
 * `to-configure` is the honest state for a product whose commercial terms nobody
 * has set yet. It is built, it renders, it is testable — it just cannot be sold,
 * and the server refuses it rather than inventing a number.
 */
export const PRODUCT_STATUS = {
  active: 'active',
  'to-configure': 'to-configure',
  'coming-soon': 'coming-soon',
  inactive: 'inactive',
};

/** Payment lifecycle. One order carries exactly one of these at a time. */
export const PAYMENT_STATUS = {
  /** Checkout started, nothing has happened yet. */
  pending: 'pending',
  /** Funds held on the card, not taken. Waits on a provider. */
  authorized: 'authorized',
  /** The provider said yes; capture is in flight. */
  confirmed: 'confirmed',
  /** Money taken. */
  paid: 'paid',
  /** Called off before capture, or the authorisation was released. */
  cancelled: 'cancelled',
  /** Money given back after capture. */
  refunded: 'refunded',
  /** The payment did not go through. */
  failed: 'failed',
};

/** What the provider says, tracked separately from the money. */
export const FULFILMENT_STATUS = {
  'not-required': 'not-required',
  'awaiting-confirmation': 'awaiting-confirmation',
  confirmed: 'confirmed',
  declined: 'declined',
  delivered: 'delivered',
  cancelled: 'cancelled',
};

/** Shop sections, in the order they are shown. */
export const COMMERCE_CATEGORIES = [
  { id: 'card', icon: 'card',
    title: { it: 'Privilege Card', en: 'Privilege Card' },
    blurb: { it: 'Vantaggi riservati nei locali con cui lavoriamo.',
             en: 'Reserved benefits at the places we work with.' } },
  { id: 'breakfast', icon: 'tray',
    title: { it: 'Colazione in camera', en: 'Breakfast in your room' },
    blurb: { it: 'Da ordinare entro la sera prima.',
             en: 'Ordered by the evening before.' } },
  { id: 'wine', icon: 'wine',
    title: { it: 'Wine in your room', en: 'Wine in your room' },
    blurb: { it: 'Bottiglie intere, consegnate in camera.',
             en: 'Full bottles, brought to your room.' } },
  { id: 'transfer', icon: 'car',
    title: { it: 'Transfer privato', en: 'Private transfer' },
    blurb: { it: 'Auto con conducente da e per l’aeroporto.',
             en: 'A car with a driver, to and from the airport.' } },
  { id: 'hair', icon: 'scissors',
    title: { it: 'Hair & barber in camera', en: 'Hair and barber in your room' },
    blurb: { it: 'Un professionista viene da te, nella tua camera.',
             en: 'A professional comes to you, in your room.' } },
  { id: 'celebration', icon: 'glass',
    title: { it: 'Occasioni speciali', en: 'Special occasions' },
    blurb: { it: 'Allestimenti e sorprese, su misura.',
             en: 'Arrangements and surprises, made to fit.' } },
  { id: 'experience', icon: 'compass',
    title: { it: 'Esperienze', en: 'Experiences' },
    blurb: { it: 'Firenze e la Toscana, organizzate da noi.',
             en: 'Florence and Tuscany, arranged by us.' } },
];

export const CATEGORY_IDS = COMMERCE_CATEGORIES.map((c) => c.id);

/** Delivery windows offered for anything brought to the room. */
export const DELIVERY_SLOTS = {
  breakfast: [
    { id: 'b-0730', label: { it: '07:30 – 08:00', en: '7:30 – 8:00 am' }, from: '07:30', to: '08:00' },
    { id: 'b-0800', label: { it: '08:00 – 08:30', en: '8:00 – 8:30 am' }, from: '08:00', to: '08:30' },
    { id: 'b-0830', label: { it: '08:30 – 09:00', en: '8:30 – 9:00 am' }, from: '08:30', to: '09:00' },
    { id: 'b-0900', label: { it: '09:00 – 09:30', en: '9:00 – 9:30 am' }, from: '09:00', to: '09:30' },
    { id: 'b-0930', label: { it: '09:30 – 10:00', en: '9:30 – 10:00 am' }, from: '09:30', to: '10:00' },
  ],
  wine: [
    { id: 'w-1800', label: { it: '18:00 – 19:00', en: '6 – 7 pm' }, from: '18:00', to: '19:00' },
    { id: 'w-1900', label: { it: '19:00 – 20:00', en: '7 – 8 pm' }, from: '19:00', to: '20:00' },
    { id: 'w-2000', label: { it: '20:00 – 21:00', en: '8 – 9 pm' }, from: '20:00', to: '21:00' },
    { id: 'w-2100', label: { it: '21:00 – 22:00', en: '9 – 10 pm' }, from: '21:00', to: '22:00' },
  ],
};

/**
 * Cut-off shapes.
 *   eveningBefore — order by `hour` on the day before delivery
 *   leadMinutes   — order at least N minutes before the delivery slot starts
 */
export const CUTOFF_KINDS = { eveningBefore: 'eveningBefore', leadMinutes: 'leadMinutes' };
