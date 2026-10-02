/**
 * Florence, as entries.
 *
 * These carry no addresses of their own: they point at `data/florence.js` through
 * `places`, so a recommendation is written once and shows up in the guide, in search
 * and in the Concierge together.
 */

export const florence = [
  {
    id: 'eat',
    section: 'florence',
    phase: ['staying'],
    icon: 'fork',
    priority: -20,
    title: { it: 'Dove mangiare', en: 'Where to eat' },
    summary: {
      it: 'Dalla bistecca alle trattorie di quartiere: i posti dove mandiamo gli ospiti, non i primi risultati di una ricerca.',
      en: 'From steak to neighbourhood trattorias: the places we send guests to, not the first results of a search.',
    },
    detail: {
      it: 'A Firenze si cena presto rispetto al resto d’Italia e i posti buoni si riempiono: una telefonata il giorno prima cambia la serata.',
      en: 'Florence eats early by Italian standards and the good places fill up: a phone call the day before changes your evening.',
    },
    places: ['dall-oste', 'paoli', 'perseus', 'cammillo', 'la-giostra', 'tre-panche'],
    intents: ['eat'],
  },
  {
    id: 'aperitivo',
    section: 'florence',
    phase: ['staying'],
    icon: 'wine',
    priority: -15,
    title: { it: 'Aperitivo', en: 'Aperitivo' },
    summary: {
      it: 'Un bicchiere prima di cena, che a Firenze è quasi un pasto.',
      en: 'A glass before dinner, which in Florence is nearly a meal in itself.',
    },
    places: ['il-santino', 'opera-aperitivo'],
    intents: ['aperitivo'],
  },
  {
    id: 'gelato',
    section: 'florence',
    phase: ['staying'],
    icon: 'icecream',
    priority: -12,
    title: { it: 'Gelato', en: 'Gelato' },
    summary: {
      it: 'Regola veloce: se è a montagnette colorate, cammina ancora un po’.',
      en: 'Quick rule: if it is piled in bright mounds, keep walking.',
    },
    places: ['sbrino', 'vivoli', 'carraia', 'edoardo'],
    intents: ['gelato'],
  },
  {
    id: 'museums',
    section: 'florence',
    phase: ['before', 'staying'],
    icon: 'museum',
    priority: -10,
    title: { it: 'Musei', en: 'Museums' },
    summary: {
      it: 'Uffizi e Accademia sono a pochi minuti. Prenota online prima di partire: senza biglietto si perde mezza mattina in fila.',
      en: 'The Uffizi and the Accademia are minutes away. Book online before you travel: without a ticket you lose half a morning queueing.',
    },
    places: ['uffizi', 'accademia'],
    intents: ['museums'],
  },
  {
    id: 'walks',
    section: 'florence',
    phase: ['staying'],
    icon: 'compass',
    priority: -5,
    title: { it: 'Giri e itinerari', en: 'Walks and itineraries' },
    summary: {
      it: 'Cosa fare con mezza giornata, con tre giorni, o con il tempo che manca al tramonto.',
      en: 'What to do with half a day, with three days, or with the time left before sunset.',
    },
    itineraries: true,
    intents: ['itinerary'],
  },
  {
    id: 'day-trips',
    section: 'florence',
    phase: ['staying'],
    icon: 'hills',
    priority: 0,
    title: { it: 'Fuori Firenze', en: 'Beyond Florence' },
    summary: {
      it: 'Siena, Pisa, il Chianti, San Gimignano. Con almeno 24 ore di preavviso possiamo organizzare un autista.',
      en: 'Siena, Pisa, Chianti, San Gimignano. With at least 24 hours’ notice we can arrange a driver.',
    },
    dayTrips: true,
    actions: [{ kind: 'entry', label: { it: 'Organizza un’uscita', en: 'Arrange a trip' }, value: 'transfer' }],
    intents: ['day-trip'],
  },
  {
    id: 'getting-around',
    section: 'florence',
    phase: ['staying'],
    icon: 'walk',
    priority: 3,
    title: { it: 'Muoversi in città', en: 'Getting around' },
    summary: {
      it: 'Il centro si fa a piedi: da LunArt quasi tutto è entro venti minuti. Per il resto c’è la tramvia, e i taxi si chiamano.',
      en: 'The centre is walkable: from LunArt almost everything is within twenty minutes. Beyond that there is the tram, and taxis are called, not hailed.',
    },
    detail: {
      it: 'Gli autobus urbani e la tramvia sono gestiti da Autolinee Toscane: il biglietto si compra in app, in tabaccheria o a bordo con carta.\n\nLa tramvia serve soprattutto l’aeroporto e le zone fuori dal centro; dentro il centro storico, a piedi fai prima.',
      en: 'City buses and the tram are run by Autolinee Toscane: buy a ticket in their app, at a tobacconist, or on board by card.\n\nThe tram mainly serves the airport and areas outside the centre; inside the historic centre, walking is quicker.',
    },
    actions: [{ kind: 'entry', label: { it: 'Chiamare un taxi', en: 'Call a taxi' }, value: 'taxi' }],
    intents: ['public-transport'],
    verify: { level: 'volatile',
      note: 'Le modalità di acquisto dei biglietti di Autolinee Toscane sono dati di terzi: controllare una volta che app, tabaccherie e pagamento a bordo con carta siano ancora validi.' },
  },
  {
    id: 'wellness',
    section: 'florence',
    phase: ['staying'],
    icon: 'spa',
    priority: 5,
    title: { it: 'Benessere', en: 'Wellness' },
    summary: {
      it: 'Spa, massaggi e yoga a pochi minuti, per quando le scale e i musei si fanno sentire.',
      en: 'Spa, massage and yoga a few minutes away, for when the stairs and the museums catch up with you.',
    },
    places: ['soulspace', 'silathai', 'yogaincentro'],
    intents: ['wellness'],
  },
];
