/**
 * Who honours a LunArt Pass, and what they give.
 *
 * ── The product model this file encodes ──────────────────────────────────────
 *
 * The LunArt Pass comes with the stay. Nobody buys it, and what it already gets a
 * guest — the Opera Caffè 30% — is part of staying at LunArt, for everyone on the
 * reservation.
 *
 * LunArt Privilege is the paid upgrade to that same Pass. It is not a second card:
 * when a guest buys it, the card issued by that order is bound to their reservation
 * and the Pass they already had starts rendering as Privilege. What the upgrade adds
 * is the partner benefits reserved for it.
 *
 * So two things decide whether a guest can use a benefit today, and both have to be
 * true:
 *
 *   1. the Pass is temporally active — `passState(reservation) === 'active'`, which
 *      `server/pass.js` already computes in Florence's own day and is the only
 *      date engine in the codebase; and
 *   2. the reservation carries the entitlement the benefit asks for.
 *
 * Neither is "does a card row exist". A card that has not started, or a Pass whose
 * stay ended yesterday, is not a licence to walk into a club, and a guest with a
 * perfectly live Pass and no upgrade has not bought Le Firme or Blue Velvet.
 *
 * ── Why the data looks like this ─────────────────────────────────────────────
 *
 * Adding partner number three, four or twenty has to be adding data. There is no
 * component per partner, no stylesheet per partner and no conditional anywhere that
 * names one: a partner is a record with benefits, and every screen renders records.
 * `eligibility` is structured for the same reason — a benefit that is Privilege-only
 * says so in a field, not inside an Italian sentence that a renderer would have to
 * parse to know whether to lock it.
 *
 * One partner, many benefits. Blue Velvet is the proof: the entry and the table
 * discount are two separate things a guest claims on two separate nights, and
 * flattening them into one line would lose one of them.
 *
 * ── The Shopping add-on, modelled and not sold ───────────────────────────────
 *
 * `ENTITLEMENTS.shopping` exists so that the day a retail partner is reserved for a
 * paid Shopping add-on, the change is one line of data:
 *
 *     eligibility: { passState: 'active', entitlementsAll: ['privilege', 'shopping'] }
 *
 * Nothing sells it. There is no SKU, no price entry, no checkout path and no tile:
 * see `ENTITLEMENTS_ON_SALE`. Internal note for whoever picks this up — the
 * commercial hypothesis discussed was an add-on priced on top of Privilege, per the
 * same 2/5/8-day shape, and no figure has been set here because setting one in
 * `prices.js` is what would make it sellable. Le Firme is a plain `privilege`
 * partner today and must stay one until that decision is actually taken.
 *
 * ── Validation ───────────────────────────────────────────────────────────────
 *
 * Each active partner has its own page at `/partner/<id>`. A venue opens it once,
 * adds it to their home screen, and from then on taps an icon to get a scanner that
 * already knows which benefits are theirs — so nobody at a door has to pick
 * anything from a list before they can check a card.
 *
 * The inactive entries at the bottom are shapes, marked `example`, kept so the model
 * is visibly general across categories nobody has signed yet. They are never
 * rendered, never returned to a scanner, and have no page.
 */

/**
 * The entitlements a reservation can carry, by name.
 *
 * A closed set on purpose: a typo in an eligibility rule must fail a test rather
 * than quietly produce a benefit nobody can ever unlock.
 */
export const ENTITLEMENTS = {
  /** The paid upgrade. Bought today, as `privilege-card`. */
  privilege: 'privilege',
  /**
   * A future add-on to Privilege, on the same card. Modelled, not sold — see the
   * header. Its presence here is what makes moving a partner behind it a data
   * change instead of a code change.
   */
  shopping: 'shopping',
};

export const ENTITLEMENT_NAMES = Object.values(ENTITLEMENTS);

/**
 * Where a partnership is, which is not where a guest is.
 *
 * `active` is already taken and means something else: whether a record is
 * published at all. Half the register is inactive example shapes that no screen
 * ever draws, and overloading that flag to mean "we have a deal" would have made
 * one field answer two questions and eventually get one of them wrong.
 *
 *   active      LunArt has a real benefit here today, agreed and claimable.
 *   activating  the business is in the network being built. No benefit is
 *               promised, nothing is claimable, and nothing it carries may become
 *               so because a guest happens to hold Privilege.
 *
 * The firewall is `benefitPartners()` below: every selector that leads to a
 * claim — `cardPartners`, `stayPartners`, `cardBenefits`, `stayBenefits`,
 * `allGuestBenefits`, and through them `requiresPartners` and the scanner —
 * filters through it. An activating venue is reachable only through
 * `partnerNetwork()`, which is a catalogue and authorises nothing.
 */
export const PARTNERSHIP_STATUS = {
  active: 'active',
  activating: 'activating',
};

/** What a guest can actually buy. The list the catalogue is allowed to act on. */
export const ENTITLEMENTS_ON_SALE = [ENTITLEMENTS.privilege];

/**
 * The Pass states an eligibility rule may ask for.
 *
 * Mirrors `PASS_STATE` in `server/pass.js` by value, because this module is shared
 * with the browser and must not import the server. The test suite asserts the two
 * lists stay identical, which is cheaper than a second date engine.
 */
export const PASS_STATES = ['not-started', 'active', 'expired', 'cancelled', 'unknown'];

/** What a guest can do with a benefit right now. */
export const ACCESS = {
  /** Usable today: the Pass is in the right state and carries the entitlements. */
  available: 'available',
  /** Real, and not theirs yet. Shown, so it can be discovered rather than hidden. */
  locked: 'locked',
  /** Theirs or not, the Pass is not in a state where anything can be claimed. */
  unavailable: 'unavailable',
};

/** Comes with the stay: an active Pass and nothing bought. */
export const STAY_ELIGIBILITY = { passState: 'active', entitlementsAll: [] };

/** The paid tier: an active Pass plus the Privilege entitlement. */
export const PRIVILEGE_ELIGIBILITY = { passState: 'active', entitlementsAll: [ENTITLEMENTS.privilege] };

/**
 * Fields that never leave the server.
 *
 * `partnerView` builds the guest's copy field by field rather than spreading the
 * record, so nothing reaches a screen unless somebody wrote it down there — this
 * list is what a test walks to prove it, and the place to add to when a new
 * internal field appears.
 *
 * The register itself is a second route, and the one that was open: `/api/catalog`
 * publishes the partners in force so the browser renders from the same list the
 * server honours, and it was publishing them whole. Nobody saw a venue's
 * negotiation notes on a screen, but they were a view-source away. `publicPartner`
 * is what goes on the wire now.
 */
export const INTERNAL_PARTNER_FIELDS = ['notes', 'verify', 'staff_note'];

export const PARTNER_CATEGORIES = {
  restaurants: { it: 'Ristoranti', en: 'Restaurants' },
  bars: { it: 'Bar e aperitivo', en: 'Bars and aperitivo' },
  nightlife: { it: 'Nightlife', en: 'Nightlife' },
  /**
   * Shopping, as one category rather than eight.
   *
   * The intention is a retail network — moda, pelletteria, regali, souvenir,
   * design, artigianato, prodotti toscani, stampe — and when there is more than one
   * shop it will be worth splitting and grouping. With a single shop, category
   * navigation would be furniture around one item. Splitting this later is adding
   * keys to this map, which is the point.
   */
  shopping: { it: 'Moda e shopping', en: 'Fashion and shopping' },
  cafes: { it: 'Caffè e bistrot', en: 'Cafés and bistros' },
  spa: { it: 'SPA e benessere', en: 'Spa and wellness' },
  beauty: { it: 'Beauty', en: 'Beauty' },
  pharmacy: { it: 'Farmacia', en: 'Pharmacy' },
  tobacco: { it: 'Tabacchi', en: 'Tobacconist' },
  experiences: { it: 'Esperienze', en: 'Experiences' },
  other: { it: 'Altro', en: 'Other' },
};

/**
 * The shapes a benefit comes in.
 *
 * Nothing here assumes a house percentage: a shop takes something off the till, a
 * club puts you on the list at a capped price, a salon might do neither. `kind`
 * carries that difference instead of flattening it.
 */
export const BENEFIT_KINDS = ['percentage', 'amount', 'special', 'item', 'guestlist', 'other'];

/**
 * A business in the network that LunArt has not agreed terms with yet.
 *
 * Everything these carry is a fact about the business — its name, what it is,
 * where it is when that is certain — and nothing is a promise. `benefits` is
 * empty by construction rather than by discipline, so there is no percentage to
 * leak, no entry price to honour and nothing for a scanner to match: a record
 * made here cannot become claimable without somebody writing a benefit into it.
 *
 * `directions` follows the address, because that is the only thing a map link can
 * honestly be built from. A business whose exact branch is still in question gets
 * its name and no pin — a wrong pin sends a guest across Florence, which is worse
 * than no pin at all. The uncertainty itself is recorded in `verify`, internal.
 *
 * Activating one later is this record gaining `benefits`, an `eligibility` rule and
 * `partnership_status: 'active'`. No renderer changes.
 */
const activating = ({ id, name, category, address = null, area = null, notes = null, verify = null }) => ({
  partner_id: id,
  active: true,
  partnership_status: PARTNERSHIP_STATUS.activating,
  name,
  category,
  area: area ? { it: area, en: area } : null,
  address,
  directions: Boolean(address),
  logo: null,
  /** Nothing is promised. The firewall is this, not a flag somewhere else. */
  benefits: [],
  ...(notes ? { notes } : {}),
  ...(verify ? { verify } : {}),
});

export const PARTNERS = [
  // ── Included with the stay ───────────────────────────────────────────────
  {
    partner_id: 'opera-caffe',
    active: true,
    partnership_status: PARTNERSHIP_STATUS.active,
    /**
     * Everyone on the reservation, not two people, and not conditional on buying
     * anything. This is the line that must never move: listing Opera Caffè as
     * something the upgrade unlocks would be selling a guest something they already
     * have, which is the fastest way to stop being believed.
     */
    applies_to: 'all-guests',
    eligibility: STAY_ELIGIBILITY,
    name: 'L’Opera Caffè',
    category: 'restaurants',
    area: { it: 'Piazza del Duomo 62/R', en: 'Piazza del Duomo 62/R' },
    address: 'Piazza del Duomo 62/R, Firenze',
    maps: 'https://maps.app.goo.gl/uok3CmvHBLmwieoV9',
    logo: { src: 'assets/img/partners/opera-caffe-400.webp', width: 400, height: 170 },
    benefits: [
      {
        benefit_id: 'opera-caffe-table',
        kind: 'percentage',
        value: 30,
        emphasis: '30% OFF',
        headline: { it: '30% sul menù al tavolo', en: '30% off table orders' },
        subline: { it: 'Incluso nel soggiorno', en: 'Included with your stay' },
        note: {
          it: 'Dillo prima di ordinare e mostra la conferma di prenotazione LunArt. Vale sul menù al tavolo, per tutti gli ospiti della prenotazione.',
          en: 'Say so before ordering and show your LunArt booking confirmation. It applies to table orders, for everyone on the reservation.',
        },
      },
    ],
    /** Internal, never shown to a guest or a venue. */
    notes: 'Partner storico LunArt. Il 30% è confermato per tutti gli ospiti della prenotazione, indipendentemente da LunArt Privilege.',
    verify: {
      level: 'confirm',
      note: 'Il 30% all’Opera Caffè è incluso nel soggiorno LunArt e vale per tutti gli ospiti della prenotazione. Da confermare come il locale verifica l’ospite al tavolo (nome e camera dalla guida personale).',
    },
  },

  // ── Reserved for LunArt Privilege ────────────────────────────────────────
  {
    partner_id: 'le-firme',
    active: true,
    partnership_status: PARTNERSHIP_STATUS.active,
    eligibility: PRIVILEGE_ELIGIBILITY,
    /** No official asset supplied yet. The name carries the identity until one is. */
    logo: null,
    name: 'Le Firme',
    category: 'shopping',
    area: { it: 'Porta al Prato', en: 'Porta al Prato' },
    address: 'Via Il Prato 49R, Firenze',
    /** A verified address, so the guide can send a guest to the door. */
    directions: true,
    benefits: [
      {
        benefit_id: 'le-firme-discount',
        kind: 'percentage',
        value: 10,
        emphasis: '10% OFF',
        headline: { it: '10% di sconto', en: '10% off' },
        subline: {
          it: 'Moda e shopping a Porta al Prato.',
          en: 'Fashion and shopping near Porta al Prato.',
        },
      },
    ],
    /**
     * Internal. The gaps are listed because the absence of a fact is itself a fact
     * worth recording: nobody should fill one of these in from memory.
     */
    notes: 'Vantaggio confermato dalla proprietà: 10% di sconto per chi ha LunArt Privilege attiva. Non forniti, da non inventare: telefono, sito, orari, marchi trattati, esclusioni, spesa minima, cumulabilità con altre promozioni, modalità di contatto.',
  },

  {
    partner_id: 'blue-velvet',
    active: true,
    partnership_status: PARTNERSHIP_STATUS.active,
    eligibility: PRIVILEGE_ELIGIBILITY,
    /**
     * Traced from nothing: `assets/img/_src/partners/blue-velvet.pdf` is the
     * Illustrator vector the club supplied, converted path for path by
     * `pdftocairo -svg` and cropped to its own ink by moving the viewBox. No
     * redrawing, no approximation, and no request to anybody else's server.
     */
    logo: { src: 'assets/img/partners/blue-velvet.svg', width: 237, height: 283 },
    name: 'Blue Velvet',
    category: 'nightlife',
    /**
     * One venue, one record, one place on the map.
     *
     * 14R and 16R are two adjacent doors of the same club, and on a given night
     * only one of them may be open. Two partner records, two addresses or two map
     * pins would be three different ways of telling a guest there are two clubs.
     */
    address: 'Via del Castello d\'Altafronte 14R–16R, Firenze',
    directions: true,
    /**
     * Operational, and deliberately not on the guest's screen.
     *
     * Which of two doors is open on a Tuesday is LunArt's problem and the club's,
     * not something a guest should be reading on their phone — the address already
     * carries both numbers, and anything more is a caveat where a benefit should
     * be. It stays in the register because staff and a future partner sheet want
     * it. `staff_note` rather than `note` because `benefit.note` *is* guest-facing,
     * and two fields a letter apart meaning opposite things is how one of them
     * ends up in the wrong place.
     */
    staff_note: {
      it: '14R e 16R sono due ingressi adiacenti dello stesso locale: a volte è aperto solo uno dei due.',
      en: '14R and 16R are two adjacent entrances to the same venue: sometimes only one of them is open.',
    },
    benefits: [
      {
        benefit_id: 'blue-velvet-entry',
        kind: 'guestlist',
        value: null,
        /** A ceiling, not a discount: the most a guest pays. Eurocents. */
        cap: { amount: 1500, per: 'person' },
        emphasis: '€15 MAX + DRINK',
        headline: { it: '€15 MAX + DRINK', en: '€15 MAX + DRINK' },
        subline: { it: 'Tutta la notte · LunArt Privilege', en: 'All night · LunArt Privilege' },
        description: {
          it: 'Ingresso in lista a massimo €15 a persona, con una consumazione inclusa, a qualsiasi ora della serata.',
          en: 'Guest-list entry for no more than €15 per person, with one drink included, at any time of the night.',
        },
      },
      {
        benefit_id: 'blue-velvet-tables',
        kind: 'percentage',
        value: 20,
        emphasis: '20% OFF',
        headline: { it: '20% OFF', en: '20% OFF' },
        subline: { it: 'Tavoli e bottle service', en: 'Table service' },
        description: {
          it: '20% di sconto su tavoli / bottle service.',
          en: '20% off table / bottle service.',
        },
      },
    ],
    /**
     * Internal. The house prices are here as context for whoever negotiates the
     * next renewal — they are deliberately not a guest-facing price table, because
     * a guest with Privilege pays the capped price and does not need to be told
     * what somebody else would have paid.
     */
    notes: 'Vantaggi confermati dalla proprietà per chi ha LunArt Privilege attiva: ingresso in lista a massimo €15 a persona con una consumazione, a qualsiasi ora; 20% su tavoli / bottle service. Listino normale del locale, solo come contesto interno: fino all’01:00 donna €15 con consumazione, uomo €20 con consumazione; dopo l’01:00 €20 senza consumazione. Non forniti, da non inventare: telefono, sito, giorni e orari di apertura, dress code, spesa minima o numero minimo di persone per un tavolo, bottiglie incluse, modalità di prenotazione del tavolo, cumulabilità.',
  },


  // ── In attivazione ───────────────────────────────────────────────────────
  // The network being built. Every record below is guest-visible and promises
  // nothing: no benefit, no percentage, no terms, and no claim any screen or
  // scanner can honour. See `activating()` and `benefitPartners()`.
  activating({
    id: 'babylon-club', name: 'Babylon Club', category: 'nightlife',
    area: 'Firenze centro',
    verify: { level: 'address', note: 'Indirizzo civico da confermare prima dell’attivazione.' },
  }),
  activating({ id: 'la-petite', name: 'La Petite', category: 'bars', address: 'Via Pellicceria 30R, Firenze' }),
  activating({ id: 'bitter-bar', name: 'Bitter Bar', category: 'bars', address: 'Via di Mezzo 28R, Firenze' }),

  activating({
    id: 'giotto-smn', name: 'Giotto Pizzeria-Bistrot', category: 'restaurants',
    area: 'Santa Maria Novella', address: 'Via Panzani 57, Firenze',
    notes: 'Locale d’angolo: l’altro affaccio è Piazza Santa Maria Novella 24R. Pubblichiamo un solo civico.',
  }),
  activating({ id: 'antica-porta', name: 'Pizzeria Antica Porta', category: 'restaurants', address: 'Via Senese 23, Firenze' }),
  activating({
    id: 'braceria-all-11', name: 'Braceria All’11', category: 'restaurants',
    area: 'Santo Spirito', address: 'Via Sant’Agostino 11/R, Firenze',
  }),
  activating({ id: 'obica-firenze', name: 'Obicà Mozzarella Bar', category: 'restaurants', address: 'Via de’ Tornabuoni 16, Firenze' }),
  activating({
    id: 'tre-panche', name: 'Osteria delle Tre Panche', category: 'restaurants',
    verify: { level: 'address', note: 'Più indirizzi fiorentini in circolazione, storici e attuali, in conflitto fra loro. Confermare la sede partecipante prima di pubblicare un civico.' },
  }),
  activating({
    id: 'la-giostra', name: 'La Giostra', category: 'restaurants', area: 'Borgo Pinti',
    verify: { level: 'address', note: 'Zona confermata, civico no.' },
  }),
  activating({
    id: 'osteria-fulvio', name: 'Osteria Fulvio', category: 'restaurants',
    verify: { level: 'identity', note: 'Exact public identity/address to confirm.' },
  }),
  activating({
    id: 'vecchia-bettola', name: 'La Vecchia Betola', category: 'restaurants',
    verify: { level: 'address', note: 'Civico da confermare.' },
  }),
  activating({ id: 'neromo', name: 'Neromo', category: 'restaurants', address: 'Borgo San Frediano 23R–25R, Firenze' }),
  activating({
    id: 'la-cupola', name: 'Ristorante La Cupola', category: 'restaurants', address: 'Piazza del Duomo 47/R, Firenze',
    notes: 'Referente interno: Mirko.',
  }),
  activating({
    id: 'quattro-leoni', name: 'Trattoria 4 Leoni', category: 'restaurants', area: 'Piazza della Passera',
    verify: { level: 'address', note: 'Piazza confermata, civico no.' },
  }),
  activating({
    id: 'le-mossacce', name: 'Le Mossacce', category: 'restaurants', address: 'Via del Proconsolo 55R, Firenze',
    notes: 'Referente interno: Massimiliano.',
  }),
  activating({ id: 'fuor-d-acqua', name: 'Fuor d’Acqua', category: 'restaurants', address: 'Via Pisana 37R, Firenze' }),
  activating({
    id: 'caffe-maioli', name: 'Caffè Maioli', category: 'cafes',
    verify: { level: 'identity', note: 'Più risultati fiorentini in conflitto. Confermare quale sede è quella partecipante.' },
  }),
  activating({
    id: 'caffe-amerini', name: 'Caffè Amerini', category: 'cafes',
    verify: { level: 'address', note: 'Civico da confermare senza ambiguità prima di pubblicarlo.' },
  }),

  activating({
    id: 'alessi', name: 'Alessi', category: 'shopping',
    verify: { level: 'identity', note: 'Quale attività fiorentina di nome Alessi è ancora da confermare. Non sostituire con un’altra con lo stesso nome.' },
  }),
  activating({ id: 'ditta-braschi', name: 'Ditta Braschi', category: 'shopping', address: 'Via del Corso 67R, Firenze' }),
  activating({ id: 'cose-cosi', name: 'Cose Così', category: 'shopping', address: 'Borgo la Croce 23, Firenze' }),
  activating({
    id: 'pasquinucci', name: 'Pasquinucci', category: 'shopping',
    verify: { level: 'address', note: 'Sede fiorentina e indirizzo attuale da confermare.' },
  }),
  activating({
    id: 'wycon-calzaiuoli', name: 'WYCON Cosmetics', category: 'beauty',
    area: 'Via dei Calzaiuoli', address: 'Via dei Calzaiuoli 88, Firenze',
    notes: 'Filiale partecipante: Via dei Calzaiuoli, non le altre sedi fiorentine. Referente interno: Mary.',
  }),
  activating({
    id: 'via-del-te-condotta', name: 'La Via del Tè', category: 'shopping',
    area: 'Via della Condotta', address: 'Via della Condotta 26/28R, Firenze',
    notes: 'Negozio dietro Piazza della Signoria. Non usare la sede di Santo Spirito né le altre fiorentine.',
  }),
  activating({
    id: 'erbolario', name: 'L’Erbolario', category: 'beauty',
    verify: { level: 'address', note: 'Confirm exact participating Florence branch with Jacopo before activation. Jacopo ricorda una sede verso Via de’ Tornabuoni; le fonti pubbliche indicano un altro negozio fiorentino. Non scegliere Via del Corso o un’altra filiale d’ufficio.' },
  }),
  activating({
    id: 'farmacia-insegna-del-moro', name: 'Farmacia All’Insegna del Moro', category: 'pharmacy',
    area: 'Piazza San Giovanni',
    verify: { level: 'address', note: 'Angolo di fronte a Scudieri, verso il Battistero. Civico da confermare.' },
  }),
  activating({
    id: 'tabacchi-san-giovanni', name: 'Tabacchi — Piazza San Giovanni', category: 'tobacco',
    area: 'Piazza San Giovanni',
    notes: 'Referente interno: Mauro — riferimento operativo, non il nome pubblico dell’attività.',
    verify: { level: 'identity', note: 'Insegna pubblica da verificare: fino ad allora si usa un’etichetta neutra. Accanto alla farmacia, verso il Battistero.' },
  }),
  activating({
    id: 'benheart-vigna-nuova', name: 'Benheart', category: 'shopping',
    area: 'Via della Vigna Nuova', address: 'Via della Vigna Nuova 85/R, Firenze',
    notes: 'Filiale partecipante: Via della Vigna Nuova, non le altre sedi fiorentine.',
  }),
  activating({ id: 'sartoria-rossi', name: 'Sartoria Rossi', category: 'shopping', address: 'Via della Vigna Nuova 37, Firenze' }),

  // ── Shapes, not partners. Never shown: `active` is false. ────────────────
  {
    partner_id: 'example-bar', active: false, example: true, name: 'Esempio — bar', category: 'bars',
    eligibility: PRIVILEGE_ELIGIBILITY,
    benefits: [{
      benefit_id: 'example-bar-welcome', kind: 'item', value: null,
      headline: { it: 'Un calice di benvenuto', en: 'A welcome glass' },
      subline: { it: 'Esempio di struttura', en: 'An example of the shape' },
    }],
  },
  {
    partner_id: 'example-restaurant', active: false, example: true, name: 'Esempio — ristorante', category: 'restaurants',
    eligibility: PRIVILEGE_ELIGIBILITY,
    benefits: [{
      benefit_id: 'example-restaurant-amount', kind: 'amount', value: 1500,
      headline: { it: '15 € sul conto', en: '€15 off the bill' },
      subline: { it: 'Esempio di struttura', en: 'An example of the shape' },
    }],
  },
  {
    partner_id: 'example-spa', active: false, example: true, name: 'Esempio — SPA', category: 'spa',
    eligibility: PRIVILEGE_ELIGIBILITY,
    benefits: [{
      benefit_id: 'example-spa-treatments', kind: 'percentage', value: 15,
      headline: { it: '15% sui trattamenti', en: '15% off treatments' },
      subline: { it: 'Esempio di struttura', en: 'An example of the shape' },
    }],
  },
  {
    partner_id: 'example-beauty', active: false, example: true, name: 'Esempio — beauty', category: 'beauty',
    eligibility: PRIVILEGE_ELIGIBILITY,
    benefits: [{
      benefit_id: 'example-beauty-rate', kind: 'special', value: null,
      headline: { it: 'Prezzo dedicato agli ospiti LunArt', en: 'A price reserved for LunArt guests' },
      subline: { it: 'Esempio di struttura', en: 'An example of the shape' },
    }],
  },
];

/**
 * The register in force, which is not always the one written above.
 *
 * The server decides at boot and publishes the result through `/api/catalog`; the
 * browser applies that same list before it renders anything. Same mechanism as the
 * price table: one source, published, rather than two copies that drift.
 */
let inForce = PARTNERS;
export const applyPartners = (list) => { inForce = Array.isArray(list) && list.length ? list : PARTNERS; };
export const partnersInForce = () => inForce;

export const activePartners = () => inForce.filter((p) => p.active);
export const getPartner = (id) => inForce.find((p) => p.partner_id === id) ?? null;

/**
 * A partner record as the browser may hold it: everything the rendering needs,
 * nothing LunArt wrote down for itself.
 *
 * A subtraction rather than a reconstruction, because the browser applies this list
 * through `applyPartners` and then runs the same selectors the server does — so it
 * has to be the same shape, minus the prose.
 */
export function publicPartner(partner) {
  const copy = { ...partner };
  for (const field of INTERNAL_PARTNER_FIELDS) delete copy[field];
  return copy;
}

/** The register in force, as it is published. */
export const publicPartners = () => activePartners().map(publicPartner);

/* ── Eligibility ─────────────────────────────────────────────────────────── */

/**
 * An eligibility rule, in a known shape.
 *
 * Unknown entitlement names are kept rather than dropped: a rule asking for
 * something that does not exist locks the benefit for everybody, which is the safe
 * direction to fail, and a test names the typo.
 */
function normaliseEligibility(rule) {
  const names = Array.isArray(rule?.entitlementsAll) ? rule.entitlementsAll : [];
  return {
    passState: rule?.passState ?? 'active',
    entitlementsAll: [...new Set(names.filter((name) => typeof name === 'string' && name))],
  };
}

/**
 * What a guest must have for this benefit, taking the benefit's own rule when it
 * states one and the partner's otherwise.
 *
 * Almost every partner is one rule for everything they give. The override exists
 * because the general case is real — a venue could give every LunArt guest one thing
 * and Privilege holders another — and because it costs a line here instead of a
 * second register later.
 *
 * A record with benefits and no rule falls back to the paid tier, not the free one.
 * Every partner in the register states its rule and a test refuses one that does
 * not, so this only fires on a mistake — and of the two ways to be wrong about a
 * mistake, locking a benefit that should have been free is visible and fixable,
 * while giving away one that was meant to be paid for is neither.
 */
export const eligibilityOf = (partner, benefit = null) =>
  normaliseEligibility(benefit?.eligibility ?? partner?.eligibility ?? PRIVILEGE_ELIGIBILITY);

/** Every entitlement any of this partner's benefits asks for. */
export const entitlementsRequiredBy = (partner) => [...new Set(
  (partner?.benefits ?? []).flatMap((benefit) => eligibilityOf(partner, benefit).entitlementsAll),
)];

/**
 * The commercial scope, derived rather than written down.
 *
 * A partner whose benefits need an entitlement belongs to the paid card; one whose
 * benefits need nothing but an active Pass comes with the stay. Writing this in the
 * data as well as in `eligibility` would be two truths about the same partner, and
 * the one thing this codebase has learned the hard way is that two copies of a fact
 * drift and the drift is silent.
 */
export const inclusionOf = (partner) => (entitlementsRequiredBy(partner).length ? 'card' : 'stay');

/**
 * A Pass, reduced to the two things eligibility asks about.
 *
 * It exists because the two sides of this question name the same thing
 * differently — a Pass has a `state`, a rule wants a `passState` — and one
 * adapter in the module that owns the rule is safer than every caller writing the
 * translation out and one of them getting it wrong. Nothing here works out what day
 * it is: `pass.state` was computed once, on the server, in Florence's own day.
 */
export const passContextOf = (pass) => ({
  passState: pass?.state ?? 'unknown',
  entitlements: pass?.entitlements ?? [],
  /**
   * Which of them are running today.
   *
   * A context that states only ownership is read as stating both, because the one
   * screen that builds such a context — the card's own, where `passState` *is* the
   * card's state — has already answered the question by the time it gets here. A
   * Pass from the server always carries the pair, and a test insists on it.
   */
  liveEntitlements: pass?.live_entitlements ?? pass?.entitlements ?? [],
});

/**
 * Whether a guest can use a benefit right now.
 *
 * The Pass state is passed in, never computed here: `passState()` in
 * `server/pass.js` is the only thing in the codebase that decides what day it is in
 * Florence, and this module is shared with the browser. So the question asked here
 * is the narrow one — does the state it was handed match the state the rule wants,
 * and are the entitlements present.
 *
 * Three things can be wrong, and they are reported separately because they lead to
 * different sentences on a screen:
 *
 *   passState   the stay is not under way — not started, over, or called off.
 *   missing     the entitlement was never bought. This is the one that locks a
 *               benefit and offers the upgrade.
 *   dormant     it was bought and is not in force today. The Privilege Card is sold
 *               by the day and a stay can be longer than the card: a guest on a
 *               1–6 November booking holding two days for the 3rd owns Privilege on
 *               the 1st and cannot use it until the 3rd, and cannot use it again
 *               after the 4th.
 *
 * `missing` and `dormant` both come back even when the Pass state already fails, so
 * a screen can say two true things at once instead of picking one.
 *
 * Dormant is not missing. Collapsing them would take the upgrade away from a guest
 * who paid for it — no gold card, no card screen, and the shop offering them a
 * second one — which is the expensive half of this distinction.
 */
export function benefitAccess(eligibility, {
  passState = 'unknown', entitlements = [], liveEntitlements,
} = {}) {
  const needs = normaliseEligibility(eligibility);
  const held = Array.isArray(entitlements) ? entitlements : [];
  const live = Array.isArray(liveEntitlements) ? liveEntitlements : held;

  const missing = needs.entitlementsAll.filter((name) => !held.includes(name));
  const dormant = needs.entitlementsAll.filter((name) => held.includes(name) && !live.includes(name));
  const verdict = { missing, dormant, passState, requires: needs };

  if (passState !== needs.passState) return { ...verdict, state: ACCESS.unavailable };
  if (missing.length) return { ...verdict, state: ACCESS.locked };
  // Owned, and not in force today. Not usable, and not a reason to sell it again.
  if (dormant.length) return { ...verdict, state: ACCESS.unavailable };
  return { ...verdict, state: ACCESS.available };
}

/** The same question asked about a whole partner, from a Pass rather than a context. */
export const partnerAccess = (partner, pass) =>
  benefitAccess(eligibilityOf(partner), passContextOf(pass));

/* ── Selections ──────────────────────────────────────────────────────────── */

/** Where a partnership stands. Absent means not agreed, which is the safe way to be wrong. */
export const statusOf = (partner) => partner?.partnership_status ?? PARTNERSHIP_STATUS.activating;

/**
 * The partners LunArt actually has a benefit with — the one gate every claim
 * passes through.
 *
 * `active` says a record is published; this says there is a deal behind it. The
 * thirty businesses in the network being built are published and have no deal, and
 * the distance between those two facts is the whole point of this function: put it
 * in front of `cardPartners`, `stayPartners` and `allGuestBenefits` and an
 * activating venue cannot reach a Pass, a card, a scanner or the rail that decides
 * whether Privilege is worth selling. It would have to grow a benefit first, and
 * growing one is a commercial act with a person's signature on it.
 */
export const benefitPartners = () =>
  activePartners().filter((p) => statusOf(p) === PARTNERSHIP_STATUS.active);

/** The network being built: visible, and claimable by nobody. */
export const activatingPartners = () =>
  activePartners().filter((p) => statusOf(p) === PARTNERSHIP_STATUS.activating);

/** Venues whose benefits are the paid upgrade's reason to exist. */
export const cardPartners = () => benefitPartners().filter((p) => inclusionOf(p) === 'card');

/** Venues whose benefits come with the stay, upgrade or no upgrade. */
export const stayPartners = () => benefitPartners().filter((p) => inclusionOf(p) === 'stay');

/** Partners whose benefits need a given entitlement. The future Shopping seam. */
export const partnersRequiring = (entitlement) =>
  benefitPartners().filter((p) => entitlementsRequiredBy(p).includes(entitlement));

/* ── Links ───────────────────────────────────────────────────────────────── */

/** Each partner's own scanner. Opened once, then added to the home screen. */
export const validationPath = (partnerId) => `/partner/${encodeURIComponent(partnerId)}`;
export const validationUrl = (origin, partnerId) => `${String(origin).replace(/\/$/, '')}${validationPath(partnerId)}`;

/**
 * Directions to a partner, built from the address and nothing else.
 *
 * No phone number, no website, no booking link: where none of those was given,
 * inventing one is worse than leaving the guest with a map. A partner opts in with
 * `directions: true`, which is only honest where there is an address to send them
 * to — the test suite refuses the combination of one without the other.
 */
export const directionsUrl = (partner) => (
  partner?.directions && partner?.address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(partner.address)}`
    : null
);

/* ── The guest's view ────────────────────────────────────────────────────── */

/** One benefit, as every screen receives it. Internal fields do not travel. */
function benefitView(partner, benefit) {
  return {
    benefit_id: benefit.benefit_id,
    kind: benefit.kind,
    value: benefit.value ?? null,
    cap: benefit.cap ?? null,
    /** The short token, for a compact display. Never the only copy of the fact. */
    emphasis: benefit.emphasis ?? null,
    headline: benefit.headline,
    subline: benefit.subline ?? null,
    description: benefit.description ?? null,
    note: benefit.note ?? null,
    eligibility: eligibilityOf(partner, benefit),
  };
}

/**
 * A partner and everything it gives, as a guest's phone or a venue's scanner
 * receives it.
 *
 * `benefits` is a list because a partner really can give more than one thing, and
 * the internal `notes` and `verify` fields really must never leave the server — a
 * venue reading its own scanner page must not be shown LunArt's notes about them.
 */
export function partnerView(partnerId, origin = '') {
  const partner = getPartner(partnerId);
  if (!partner?.active) return null;

  return {
    partner_id: partner.partner_id,
    partner: partner.name,
    category: partner.category,
    category_label: PARTNER_CATEGORIES[partner.category] ?? PARTNER_CATEGORIES.other,
    partnership_status: statusOf(partner),
    /**
     * The official mark, where the business gave us one, served from this origin.
     * Never a link to somebody else's server, and never a substitute for the name:
     * the renderer draws both, and a test refuses a logo without one.
     */
    logo: partner.logo ?? null,
    inclusion: inclusionOf(partner),
    applies_to: partner.applies_to ?? 'card-holder-and-companion',
    area: partner.area ?? null,
    address: partner.address ?? null,
    short_description: partner.shortDescription ?? null,
    maps: partner.maps ?? null,
    directions_url: directionsUrl(partner),
    eligibility: eligibilityOf(partner),
    entitlements_required: entitlementsRequiredBy(partner),
    benefits: (partner.benefits ?? []).map((benefit) => benefitView(partner, benefit)),
    /**
     * A scanner page exists where there is something to scan for. A business in
     * the network with no agreed benefit has no door to validate at, and giving it
     * a page would be inviting somebody to check a card against nothing.
     */
    validation_url: statusOf(partner) !== PARTNERSHIP_STATUS.active
      ? null
      : (origin ? validationUrl(origin, partner.partner_id) : validationPath(partner.partner_id)),
  };
}

/**
 * The guest view of a partner that actually honours a card.
 *
 * A scanner scoped to a business LunArt is only talking to would otherwise be
 * handed a partner object with an empty benefits list — a green screen with
 * nothing on it, at a door that agreed to nothing. There is no view to give it.
 */
export const benefitPartnerView = (partnerId, origin = '') => {
  const partner = getPartner(partnerId);
  return statusOf(partner) === PARTNERSHIP_STATUS.active ? partnerView(partnerId, origin) : null;
};

const viewsOf = (partners, origin) =>
  partners.map((p) => partnerView(p.partner_id, origin)).filter(Boolean);

export const allGuestBenefits = (origin = '') => viewsOf(benefitPartners(), origin);

/**
 * The network, as one list a guest scrolls through: what works today, then what is
 * being set up, in the order LunArt curated them.
 *
 * One list and not two sections, because that is how it reads — a guest sees who
 * LunArt works with, and the ones not ready yet are further down and quieter, the
 * way an unavailable restaurant sits at the foot of a delivery app rather than
 * disappearing. It authorises nothing: it is a catalogue, and the claimable half of
 * it is reachable through `cardBenefits` and `stayBenefits` as before.
 */
export const partnerNetwork = (origin = '') => [
  ...viewsOf(benefitPartners(), origin),
  ...viewsOf(activatingPartners(), origin),
];

/** What the paid upgrade gets a holder. Empty until a venue reserves something. */
export const cardBenefits = (origin = '') => viewsOf(cardPartners(), origin);

/** What every guest gets for staying, whatever else they buy. */
export const stayBenefits = (origin = '') => viewsOf(stayPartners(), origin);
