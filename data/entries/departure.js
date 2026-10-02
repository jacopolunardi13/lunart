/** The last morning, and getting out of the city. */

export const departure = [
  {
    id: 'checkout',
    section: 'departure',
    phase: ['leaving'],
    icon: 'clock',
    priority: -20,
    title: { it: 'A che ora devo lasciare la camera', en: 'When to leave the room' },
    summary: {
      it: 'Il check-out è entro le 11:00. Lascia la chiave in camera e avvisaci quando esci.',
      en: 'Check-out is by 11:00 AM. Leave the key in the room and let us know when you go.',
    },
    detail: {
      it: 'Se ti serve un po’ più di tempo, chiedilo la sera prima: dipende da chi arriva dopo di te, ma spesso si trova una soluzione.\n\nI bagagli non devono condizionarti: si lasciano in deposito.',
      en: 'If you need a little longer, ask the evening before: it depends on who arrives after you, but there is often a way.\n\nDo not let your bags dictate your day: you can leave them in storage.',
    },
    actions: [{ kind: 'entry', label: { it: 'Dove lascio i bagagli', en: 'Where to leave bags' }, value: 'luggage-late' }],
    intents: ['checkout'],
  },
  {
    id: 'luggage-late',
    section: 'departure',
    phase: ['leaving'],
    icon: 'suitcase',
    priority: -15,
    title: { it: 'Bagagli dopo il check-out', en: 'Bags after check-out' },
    summary: {
      it: 'Lasciali gratis all’Opera Caffè in Piazza del Duomo e tieniti la giornata libera. Accanto a LunArt c’è anche un luggage store a pagamento.',
      en: 'Leave them free of charge at Opera Caffè in Piazza del Duomo and keep your day free. There is also a paid luggage store next to LunArt.',
    },
    actions: [
      { kind: 'map', label: { it: 'Opera Caffè', en: 'Opera Caffè' }, value: 'https://maps.app.goo.gl/uok3CmvHBLmwieoV9' },
      { kind: 'map', label: { it: 'Luggage store', en: 'Luggage store' }, value: 'https://maps.app.goo.gl/NGxTxK96jRVvErwU9' },
    ],
    intents: ['luggage'],
  },
  {
    id: 'taxi',
    section: 'departure',
    phase: ['leaving'],
    icon: 'taxi',
    priority: -10,
    title: { it: 'Prendere un taxi', en: 'Getting a taxi' },
    summary: {
      it: 'A Firenze i taxi non si fermano per strada: si chiamano o si prendono ai posteggi. I numeri sono 055 4390 e 055 4242.',
      en: 'In Florence taxis are not hailed in the street: you call one or use a rank. The numbers are 055 4390 and 055 4242.',
    },
    detail: {
      it: 'Il posteggio più vicino è in Piazza Santa Trinita, a pochi minuti a piedi lungo il Lungarno.\n\nPer l’aeroporto vale la tariffa fissa comunale: chiedi conferma al conducente prima di partire.',
      en: 'The nearest rank is in Piazza Santa Trinita, a few minutes’ walk along the Lungarno.\n\nFor the airport a fixed municipal fare applies: confirm it with the driver before you set off.',
    },
    actions: [
      { kind: 'tel', label: { it: 'Chiama 055 4390', en: 'Call 055 4390' }, value: '+390554390' },
      { kind: 'tel', label: { it: 'Chiama 055 4242', en: 'Call 055 4242' }, value: '+390554242' },
    ],
    intents: ['taxi'],
    verify: { level: 'confirm',
      note: 'I due numeri radiotaxi fiorentini e il posteggio di Santa Trinita non erano nella knowledge LunArt: sono informazioni pubbliche aggiunte qui. Da controllare una volta prima della pubblicazione.' },
  },
  {
    id: 'transfer',
    section: 'departure',
    phase: ['before', 'leaving'],
    icon: 'car',
    priority: -5,
    title: { it: 'Transfer privato (NCC)', en: 'Private transfer' },
    summary: {
      it: 'Organizziamo auto con conducente da e per l’aeroporto o la stazione, e gite in Toscana. Serve preavviso di almeno 24 ore.',
      en: 'We arrange a car with driver to and from the airport or station, and trips across Tuscany. At least 24 hours’ notice is needed.',
    },
    detail: {
      it: 'Il preventivo arriva prima della conferma, e il pagamento è anticipato. Non siamo un’agenzia: è un servizio che organizziamo per i nostri ospiti quando serve.',
      en: 'You get a quote before confirming, and payment is in advance. We are not a travel agency: it is something we arrange for our guests when it helps.',
    },
    actions: [{ kind: 'entry', label: { it: 'Chiedi un preventivo', en: 'Ask for a quote' }, value: 'contacts' }],
    intents: ['transfer'],
  },
  {
    id: 'to-airport',
    section: 'departure',
    phase: ['leaving'],
    icon: 'plane',
    priority: 0,
    title: { it: 'Andare in aeroporto', en: 'Getting to the airport' },
    summary: {
      it: 'Taxi a tariffa fissa, oppure tramvia T2 da Santa Maria Novella. Con un volo molto presto, meglio un NCC prenotato prima.',
      en: 'A fixed-fare taxi, or tram T2 from Santa Maria Novella. For a very early flight, a pre-booked private driver is the safer bet.',
    },
    actions: [{ kind: 'entry', label: { it: 'Prenota un NCC', en: 'Book a driver' }, value: 'transfer' }],
    intents: ['to-airport'],
  },
  {
    id: 'to-station',
    section: 'departure',
    phase: ['leaving'],
    icon: 'train',
    priority: 2,
    title: { it: 'Andare alla stazione', en: 'Getting to the station' },
    summary: {
      it: 'Santa Maria Novella è a circa quindici minuti a piedi lungo l’Arno. Con i bagagli, meglio un taxi.',
      en: 'Santa Maria Novella is about a fifteen-minute walk along the Arno. With luggage, take a taxi.',
    },
    actions: [
      { kind: 'map', label: { it: 'Percorso a piedi', en: 'Walking route' },
        value: 'https://www.google.com/maps/dir/?api=1&origin=Vicolo+del+Canneto+2+Firenze&destination=Firenze+Santa+Maria+Novella&travelmode=walking' },
    ],
    intents: ['to-station'],
  },
];
