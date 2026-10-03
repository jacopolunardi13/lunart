/**
 * Who honours the Privilege Card, and what they give.
 *
 * Every partner states its own benefit. Nothing here assumes a house percentage:
 * a restaurant might take something off the table, a bar might pour a welcome
 * drink, a club might only put you on the list, and a spa might do none of those.
 * `benefit.kind` carries that difference instead of flattening it into a number.
 *
 * Only `active: true` partners are shown to guests or returned to a validating
 * venue. The inactive entries below are shapes, marked `example`, kept so the
 * model is visibly general — they are never rendered.
 */

export const PARTNER_CATEGORIES = {
  restaurant: { it: 'Ristoranti', en: 'Restaurants' },
  bar:        { it: 'Bar e aperitivo', en: 'Bars and aperitivo' },
  nightlife:  { it: 'Nightlife', en: 'Nightlife' },
  spa:        { it: 'SPA e benessere', en: 'Spa and wellness' },
  activity:   { it: 'Attività', en: 'Activities' },
};

/**
 * Benefit kinds. `value` means different things per kind, which is why the label
 * is authored rather than generated:
 *   percentage  value = percent off
 *   amount      value = eurocents off
 *   item        value = null; the label says what is included
 *   guestlist   value = null; access rather than money
 *   other       anything that does not fit, described in the label
 */
export const BENEFIT_KINDS = ['percentage', 'amount', 'item', 'guestlist', 'other'];

export const PARTNERS = [
  {
    id: 'opera-caffe',
    active: true,
    name: 'Opera Caffè',
    category: 'restaurant',
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
  { id: 'example-bar', active: false, example: true, name: 'Esempio — bar', category: 'bar',
    benefit: { kind: 'item', value: null, label: { it: 'Un calice di benvenuto', en: 'A welcome glass' } } },
  { id: 'example-restaurant', active: false, example: true, name: 'Esempio — ristorante', category: 'restaurant',
    benefit: { kind: 'amount', value: 1500, label: { it: '15 € sul conto', en: '€15 off the bill' } } },
  { id: 'example-club', active: false, example: true, name: 'Esempio — nightlife', category: 'nightlife',
    benefit: { kind: 'guestlist', value: null, label: { it: 'Ingresso in lista, tavolo su richiesta', en: 'On the list, table on request' } } },
  { id: 'example-spa', active: false, example: true, name: 'Esempio — SPA', category: 'spa',
    benefit: { kind: 'percentage', value: 10, label: { it: '10% sui trattamenti', en: '10% off treatments' } } },
];

export const activePartners = () => PARTNERS.filter((p) => p.active);
export const getPartner = (id) => PARTNERS.find((p) => p.id === id) ?? null;

/** What a venue is told when a card checks out, trimmed to what they need. */
export function benefitFor(partnerId) {
  const partner = getPartner(partnerId);
  if (!partner?.active) return null;
  return { partner: partner.name, category: partner.category, ...partner.benefit };
}
