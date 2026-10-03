/**
 * Who honours the Privilege Card, and what they give.
 *
 * Every partner states its own benefit. Nothing here assumes a house percentage:
 * a restaurant might take something off the table, a bar might pour a welcome
 * drink, a club might only put you on the list, and a salon might do none of
 * those. `benefit.kind` carries that difference instead of flattening it.
 *
 * Each partner has its own validation page at `/partner/<id>`. A venue opens it
 * once, adds it to their home screen, and from then on taps an icon to get a
 * scanner that already knows which benefit is theirs — so nobody at a bar has to
 * choose anything from a list before they can check a card.
 *
 * Only `active: true` partners are shown to guests or returned to a scanner. The
 * inactive entries at the bottom are shapes, marked `example`, kept so the model
 * is visibly general. They are never rendered and have no page.
 */

export const PARTNER_CATEGORIES = {
  restaurants: { it: 'Ristoranti',       en: 'Restaurants' },
  bars:        { it: 'Bar e aperitivo',  en: 'Bars and aperitivo' },
  nightlife:   { it: 'Nightlife',        en: 'Nightlife' },
  spa:         { it: 'SPA e benessere',  en: 'Spa and wellness' },
  beauty:      { it: 'Beauty',           en: 'Beauty' },
  experiences: { it: 'Esperienze',       en: 'Experiences' },
  other:       { it: 'Altro',            en: 'Other' },
};

/**
 * Benefit kinds. `value` means something different in each, which is why the
 * label is written rather than generated:
 *   percentage  value = percent off
 *   amount      value = eurocents off
 *   special     value = null; a dedicated price, described in the label
 *   item        value = null; something included
 *   guestlist   value = null; access rather than money
 *   other       anything else, described in the label
 */
export const BENEFIT_KINDS = ['percentage', 'amount', 'special', 'item', 'guestlist', 'other'];

export const PARTNERS = [
  {
    partner_id: 'opera-caffe',
    active: true,
    name: 'Opera Caffè',
    category: 'restaurants',
    area: { it: 'Piazza del Duomo 62R', en: 'Piazza del Duomo 62R' },
    benefit: {
      kind: 'percentage',
      value: 30,
      label: { it: '30% sul menù al tavolo', en: '30% off table orders' },
      conditions: {
        it: 'Mostra la card prima di ordinare. Vale sul menù al tavolo.',
        en: 'Show the card before ordering. Applies to table orders.',
      },
    },
    maps: 'https://maps.app.goo.gl/uok3CmvHBLmwieoV9',
    /** Internal, never shown to a guest or a venue. */
    notes: 'Partner storico LunArt. Il 30% è confermato per gli ospiti.',
    /**
     * The 30% is confirmed for LunArt guests. What is not confirmed is whether the
     * card becomes the way to claim it, or whether it stays tied to showing the
     * booking confirmation. Surfaced for review rather than quietly assumed.
     */
    verify: {
      level: 'confirm',
      note: 'Il 30% all’Opera Caffè è confermato per gli ospiti LunArt. Da confermare che la Privilege Card sia il canale con cui si richiede, al posto (o oltre) alla conferma di prenotazione.',
    },
  },

  // ── Shapes, not partners. Never shown: `active` is false. ────────────────
  { partner_id: 'example-bar', active: false, example: true, name: 'Esempio — bar', category: 'bars',
    benefit: { kind: 'item', value: null, label: { it: 'Un calice di benvenuto', en: 'A welcome glass' } } },
  { partner_id: 'example-restaurant', active: false, example: true, name: 'Esempio — ristorante', category: 'restaurants',
    benefit: { kind: 'amount', value: 1500, label: { it: '15 € sul conto', en: '€15 off the bill' } } },
  { partner_id: 'example-club', active: false, example: true, name: 'Esempio — nightlife', category: 'nightlife',
    benefit: { kind: 'guestlist', value: null, label: { it: 'Ingresso in lista, tavolo su richiesta', en: 'On the list, table on request' } } },
  { partner_id: 'example-spa', active: false, example: true, name: 'Esempio — SPA', category: 'spa',
    benefit: { kind: 'percentage', value: 15, label: { it: '15% sui trattamenti', en: '15% off treatments' } } },
  { partner_id: 'example-beauty', active: false, example: true, name: 'Esempio — beauty', category: 'beauty',
    benefit: { kind: 'special', value: null, label: { it: 'Prezzo dedicato agli ospiti LunArt', en: 'A price reserved for LunArt guests' } } },
];

export const activePartners = () => PARTNERS.filter((p) => p.active);
export const getPartner = (id) => PARTNERS.find((p) => p.partner_id === id) ?? null;

/** Each partner's own scanner. Opened once, then added to the home screen. */
export const validationPath = (partnerId) => `/partner/${encodeURIComponent(partnerId)}`;
export const validationUrl = (origin, partnerId) => `${String(origin).replace(/\/$/, '')}${validationPath(partnerId)}`;

/** What a guest sees under "View your privileges". */
export function guestBenefit(partnerId, origin = '') {
  const partner = getPartner(partnerId);
  if (!partner?.active) return null;
  return {
    partner_id: partner.partner_id,
    partner: partner.name,
    category: partner.category,
    area: partner.area ?? null,
    maps: partner.maps ?? null,
    kind: partner.benefit.kind,
    value: partner.benefit.value ?? null,
    label: partner.benefit.label,
    conditions: partner.benefit.conditions ?? null,
    validation_url: origin ? validationUrl(origin, partner.partner_id) : validationPath(partner.partner_id),
  };
}

/** What a scanner is told once a card checks out. Internal notes never travel. */
export const benefitFor = (partnerId) => guestBenefit(partnerId);

export const allGuestBenefits = (origin = '') =>
  activePartners().map((p) => guestBenefit(p.partner_id, origin)).filter(Boolean);
