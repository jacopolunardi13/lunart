/**
 * Who LunArt is and how a guest reaches a person.
 *
 * Contact details are deliberately conservative. The InYourLife September 2026
 * draft introduced a reception landline (+39 055 0134317) and an info@lunartfirenze.com
 * address; the client's own corrections document asks for both to be verified before
 * publication, so neither is published here. They are carried in `unverifiedContacts`
 * so the review screen can surface them without the guide ever showing them.
 */

export const property = {
  name: 'LunArt',
  longName: 'LunArt Firenze',
  tagline: {
    it: 'Bed & Breakfast · Vicolo del Canneto 2, Firenze',
    en: 'Bed & Breakfast · Vicolo del Canneto 2, Florence',
  },
  /* Short enough to sit on one line over the hero photograph at 360px. */
  shortTagline: {
    it: 'Bed & Breakfast · Firenze',
    en: 'Bed & Breakfast · Florence',
  },
  address: {
    street: 'Vicolo del Canneto 2',
    postcode: '50125',
    city: { it: 'Firenze', en: 'Florence' },
    floor: { it: '3° piano', en: '3rd floor' },
    maps: 'https://maps.app.goo.gl/mQsN2cY8eihAXVjb8',
  },
  /**
   * The story, told once. The corrections document asks for the position to be
   * narrated with force a single time rather than repeated across the page, so the
   * guide quotes this in exactly one place.
   */
  intro: {
    it: 'LunArt sta al terzo piano di un palazzo fiorentino, a pochi passi dal Lungarno '
      + 'e da Ponte Vecchio — nel punto in cui la Firenze dei monumenti incontra '
      + 'l’Oltrarno che sale verso Costa San Giorgio e il Piazzale Michelangelo. '
      + 'Il nome unisce Lunardi, il cognome di famiglia, e Art: alle pareti ci sono '
      + 'alcune opere della moglie di Jacopo.',
    en: 'LunArt occupies the third floor of a Florentine palazzo, a few steps from the '
      + 'Lungarno and Ponte Vecchio — where monumental Florence meets the Oltrarno '
      + 'climbing towards Costa San Giorgio and Piazzale Michelangelo. The name joins '
      + 'Lunardi, the family surname, and Art: a few works by Jacopo’s wife hang on '
      + 'the walls.',
  },

  /**
   * Said once, in the guide, and no further.
   *
   * LunArt is not an art gallery and the guide must not grow into claiming it is:
   * there are a few paintings by Jacopo's wife, which is a nice detail and not a
   * collection. If that changes, this is where it changes.
   */
  art: {
    it: 'Qualche opera della moglie di Jacopo, appesa dove serviva qualcosa di vero.',
    en: 'A few works by Jacopo’s wife, hung where the walls needed something real.',
  },
};

/** Who to message, in the order a guest should try them. */
export const contacts = [
  {
    id: 'diego',
    name: 'Diego',
    role: { it: 'Check-in e assistenza', en: 'Check-in and guest support' },
    phone: '+393342115505',
    display: '+39 334 211 5505',
    whatsapp: true,
    primary: true,
  },
  {
    id: 'jacopo',
    name: 'Jacopo',
    role: { it: 'Prenotazioni e organizzazione', en: 'Reservations and arrangements' },
    phone: '+393924725263',
    display: '+39 392 472 5263',
    whatsapp: true,
  },
  {
    id: 'email',
    name: 'Email',
    role: { it: 'Per cose non urgenti', en: 'For anything not urgent' },
    email: 'lunartfirenze@gmail.com',
  },
];

/**
 * Introduced by the InYourLife draft, not yet confirmed by LunArt. Never rendered
 * in the guide; the review screen lists them so they can be confirmed or dropped.
 */
export const unverifiedContacts = [
  { label: 'Telefono reception', value: '+39 055 0134317',
    note: 'Numero introdotto dalla bozza InYourLife. Non pubblicato finché non è confermato che sia attivo e presidiato.' },
  { label: 'Email', value: 'info@lunartfirenze.com',
    note: 'Indirizzo presente nella bozza InYourLife; le correzioni del 18-09-2026 ne chiedono la verifica. In guida resta lunartfirenze@gmail.com.' },
];

/**
 * Deliberately short. 112 is certain and covers every emergency in Italy; a
 * specific out-of-hours medical number would have to be verified before it could
 * be published, and a wrong one is worse than none — so the pharmacy entry opens a
 * live Maps search rather than naming a place that may since have closed.
 */
export const emergency = [
  { id: 'eu', label: { it: 'Emergenze — numero unico europeo', en: 'Emergencies — EU-wide number' },
    number: '112' },
  { id: 'pharmacy', label: { it: 'Farmacia di turno più vicina', en: 'Nearest on-duty pharmacy' },
    maps: 'https://www.google.com/maps/search/?api=1&query=farmacia+di+turno+Firenze+centro' },
  { id: 'staff', label: { it: 'Per tutto il resto, scrivi a Diego', en: 'For anything else, message Diego' },
    entry: 'contacts' },
];
