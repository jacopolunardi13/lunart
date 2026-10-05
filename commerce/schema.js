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

/**
 * Where the thing itself is, tracked separately from the money.
 *
 * `not-required` means nothing has to be confirmed before it is owed — not that
 * nobody has to do anything. A paid breakfast sits there until staff pick it up,
 * which is why the Staff app derives its queues from this field rather than from
 * the payment status.
 */
export const FULFILMENT_STATUS = {
  'not-required': 'not-required',
  'awaiting-confirmation': 'awaiting-confirmation',
  confirmed: 'confirmed',
  declined: 'declined',
  /** Staff have picked it up: the kitchen is on it, the driver is briefed. */
  'in-preparation': 'in-preparation',
  /** The bottle is not in the cellar: the guest has to be offered something else. */
  'substitution-requested': 'substitution-requested',
  delivered: 'delivered',
  completed: 'completed',
  cancelled: 'cancelled',
};

/**
 * Which fulfilment states follow which. Staff act out of order constantly — an
 * order is marked completed without ever being marked in preparation, because it
 * went up with the breakfast trolley — so this is permissive by design. It exists
 * to refuse the moves that are genuinely wrong: reviving a cancelled order, or
 * walking a declined transfer back into preparation.
 */
const FULFILMENT_TRANSITIONS = {
  'not-required': ['in-preparation', 'substitution-requested', 'delivered', 'completed', 'cancelled'],
  'awaiting-confirmation': ['confirmed', 'declined', 'in-preparation', 'cancelled'],
  confirmed: ['in-preparation', 'substitution-requested', 'delivered', 'completed', 'cancelled'],
  'in-preparation': ['substitution-requested', 'delivered', 'completed', 'cancelled'],
  'substitution-requested': ['in-preparation', 'delivered', 'completed', 'cancelled'],
  delivered: ['completed'],
  completed: [],
  declined: [],
  cancelled: [],
};

export const canFulfilmentMove = (from, to) =>
  from === to || Boolean(FULFILMENT_TRANSITIONS[from]?.includes(to));

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

/** Build a run of windows between two wall-clock hours. */
function windows(prefix, fromHour, toHour, minutes) {
  const out = [];
  const pad = (n) => String(n).padStart(2, '0');
  for (let start = fromHour * 60; start + minutes <= toHour * 60; start += minutes) {
    const from = `${pad(Math.floor(start / 60))}:${pad(start % 60)}`;
    const end = start + minutes;
    const to = `${pad(Math.floor(end / 60))}:${pad(end % 60)}`;
    out.push({ id: `${prefix}-${from.replace(':', '')}`, from, to, label: { it: `${from} – ${to}`, en: `${from} – ${to}` } });
  }
  return out;
}

/** Delivery windows offered for anything brought to the room. */
export const DELIVERY_SLOTS = {
  /**
   * Breakfast in the room starts at nine.
   *
   * The owner's rule, and an operational one rather than a preference: nothing
   * LunArt carries to a room goes up before 09:00 or after 21:00. Breakfast at
   * Opera Caffè keeps its own earlier hours — that is a room downstairs, not a
   * tray carried up — and the sunrise takeaway is exactly the arrangement for
   * somebody leaving before any of this opens.
   */
  breakfast: [
    { id: 'b-0900', label: { it: '09:00 – 09:30', en: '9:00 – 9:30 am' }, from: '09:00', to: '09:30' },
    { id: 'b-0930', label: { it: '09:30 – 10:00', en: '9:30 – 10:00 am' }, from: '09:30', to: '10:00' },
  ],
  /** Wine goes up between 11:00 and 21:00; the last window ends at the latter. */
  wine: windows('w', 11, 21, 60),
  /** A set-up can be asked for at any half hour between noon and nine. */
  celebration: windows('c', 12, 21, 30),
};

/**
 * The hours anything LunArt carries to a room may be delivered in.
 *
 * One pair of numbers, so a service added later cannot quietly fall outside them,
 * and a test can check every in-room product against the same rule. Services with
 * a calendar of their own — a transfer, an appointment with the hairdresser — are
 * not bound by this: their availability is somebody else's working day.
 */
export const IN_ROOM_HOURS = { from: '09:00', to: '21:00' };

/** The last moment wine can still be delivered on the day it is ordered. */
export const WINE_DELIVERY_WINDOW = { from: '11:00', to: '21:00' };

/**
 * Cut-off shapes.
 *   dayBefore   — order by `hour` on the day before delivery
 *   leadMinutes — order at least N minutes before the end of the chosen window
 *
 * `leadMinutes` counts back from the end of the window rather than its start,
 * which is what makes the stated express rule true: ninety minutes before the end
 * of the last window — 20:00–21:00, since in-room delivery now stops at nine —
 * is 19:30, the last moment wine can be ordered for the same evening.
 *
 * `eveningBefore` is the old name for `dayBefore` and is still accepted, because
 * the shape is identical and a stored order should not break on a rename.
 */
export const CUTOFF_KINDS = {
  dayBefore: 'dayBefore',
  eveningBefore: 'dayBefore',
  leadMinutes: 'leadMinutes',
};

/**
 * When a guest can still call something off.
 *
 *   hoursBefore — up to N hours before the slot or appointment
 *   dayBefore   — up to `hour` on the day before
 *   none        — not cancellable once bought (the Privilege Card)
 *
 * These are service rules and have nothing to do with the accommodation booking,
 * whose terms come from LunArt's own policy or the OTA's contract.
 */
export const CANCELLATION_KINDS = {
  hoursBefore: 'hoursBefore',
  dayBefore: 'dayBefore',
  none: 'none',
};
