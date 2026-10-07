/**
 * Life inside the room.
 *
 * Two claims from the old site are gone on purpose. "Camere 302, 303 e 305 le più
 * tranquille (cortile interno)" contradicted every room description, which places
 * all of them over the street and the Arno — so the noise entry now says what is
 * actually true. And "Bambini benvenuti / età minima 18 anni" was self-contradictory;
 * the operational rule is now explicit: families are welcome, 0–2 can share the
 * parents' bed, cots and extra beds have fixed supplements, and unaccompanied
 * minors need prior written parental or guardian authorisation.
 */

export const stay = [
  {
    id: 'wifi',
    section: 'stay',
    phase: ['staying'],
    icon: 'wifi',
    priority: -20,
    title: { it: 'Wi-Fi', en: 'Wi-Fi' },
    summary: {
      it: 'La rete è LunArt-Guest ed è gratuita in tutte le camere.',
      en: 'The network is LunArt-Guest and it is free in every room.',
    },
    facts: [
      { label: { it: 'Rete', en: 'Network' }, value: 'LunArt-Guest', mono: true, copy: true },
      { label: 'Password', value: 'LOPERACAFFE62R', mono: true, copy: true },
    ],
    intents: ['wifi'],
    verify: { level: 'confirm',
      note: 'Rete e password vengono dalla knowledge storica. Da confermare che siano ancora quelle attive: è il primo dato che un ospite usa.' },
  },
  {
    id: 'climate',
    section: 'stay',
    phase: ['staying'],
    icon: 'thermometer',
    priority: -6,
    title: { it: 'Clima e riscaldamento', en: 'Climate control' },
    summary: {
      it: 'Ogni camera ha aria condizionata e riscaldamento. Dopo l’accensione passano circa due minuti prima che l’aria parta: è normale, non è guasto.',
      en: 'Every room has air conditioning and heating. After you switch it on it takes about two minutes for air to start moving: that is normal, not a fault.',
    },
    detail: {
      it: 'La camera ha sensori per non sprecare energia, e spiegano quasi tutti i “non funziona”:\n\n— se apri una finestra o la porta, clima e riscaldamento si spengono;\n— se esci e la porta si richiude senza che venga rilevata presenza, il sistema si spegne da solo.\n\nIn entrambi i casi basta richiudere, rientrare e riaccendere normalmente.',
      en: 'The room has energy-saving sensors, and they explain nearly every “it isn’t working”:\n\n— open a window or the door and the climate system switches off;\n— leave, and once the door closes with nobody detected, it switches itself off.\n\nEither way, close up, come back in and switch it on again as normal.',
    },
    intents: ['climate'],
  },
  {
    id: 'towel-rail',
    section: 'stay',
    phase: ['staying'],
    icon: 'towel',
    priority: 2,
    title: { it: 'Scaldasalviette', en: 'Heated towel rail' },
    summary: {
      it: 'Il pannello touch è sotto il cappuccio grigio. Tieni il + per 3–5 secondi: diventa caldo in una decina di minuti.',
      en: 'The touch panel sits under the grey cap. Hold + for 3–5 seconds: it warms up in about ten minutes.',
    },
    detail: {
      it: 'Se non parte: stacca la spina per un minuto, riattacca, tieni premuto il − per 5 secondi e poi il +.\n\nSe dopo questo resta freddo, scrivici e veniamo a vederlo.',
      en: 'If it does not start: unplug it for a minute, plug it back in, hold − for 5 seconds and then +.\n\nIf it is still cold after that, message us and we will come and look at it.',
    },
    actions: [{ kind: 'entry', label: { it: 'Resta freddo', en: 'Still cold' }, value: 'room-problem' }],
    intents: ['towel-rail'],
  },
  {
    id: 'amenities',
    section: 'stay',
    phase: ['staying'],
    icon: 'home',
    priority: -4,
    title: { it: 'Cosa trovi in camera', en: 'What’s in the room' },
    summary: {
      it: 'Bagno privato, clima, Smart TV con le tue app di streaming, macchina Nespresso con capsule di cortesia, bollitore con tè e caffè, mini-frigo, cassaforte e kit di benvenuto.',
      en: 'Private bathroom, climate control, a Smart TV with your own streaming apps, a Nespresso machine with complimentary capsules, a kettle with tea and coffee, a mini-fridge, a safe and a welcome kit.',
    },
    detail: {
      it: 'Il bagno ha doccia, bidet, pantofole e le amenities. Nel kit trovi anche i tappi per le orecchie, che in centro a volte servono. Gli accappatoi non sono previsti.\n\nSulla Smart TV puoi accedere ai tuoi account di streaming: ricordati di uscire dalle app prima di partire.',
      en: 'The bathroom has a shower, a bidet, slippers and the usual toiletries. The kit includes earplugs, which the city centre occasionally calls for. Bathrobes are not provided.\n\nYou can sign in to your own streaming accounts on the Smart TV: remember to sign out again before you leave.',
    },
    intents: ['amenities'],
  },
  {
    id: 'welcome',
    section: 'stay',
    phase: ['staying'],
    icon: 'glass',
    priority: 6,
    title: { it: 'Il benvenuto', en: 'Your welcome' },
    summary: {
      it: 'All’arrivo trovi un prosecco di benvenuto e acqua fresca.',
      en: 'A welcome prosecco and chilled water are waiting when you arrive.',
    },
    intents: ['welcome'],
  },
  {
    id: 'cleaning',
    section: 'stay',
    phase: ['staying'],
    icon: 'broom',
    priority: 3,
    title: { it: 'Pulizia e biancheria', en: 'Cleaning and linen' },
    summary: {
      it: 'Sono due cose diverse: la camera viene riordinata e pulita ogni giorno, mentre teli e biancheria si cambiano ogni tre giorni — o prima, se ce lo chiedi.',
      en: 'Two different things: the room is tidied and cleaned every day, while towels and linen are changed every three days — or sooner, if you ask.',
    },
    detail: {
      it: 'Ogni lavaggio consuma acqua ed energia, perciò il cambio non è automatico tutti i giorni — ma basta dirlo.\n\nSe ti servono teli in più: 5 € al pezzo, oppure 15 € per un set completo (due grandi, due medi e il tappetino).',
      en: 'Every wash uses water and energy, so linen is not changed automatically each day — but you only have to ask.\n\nIf you need extra towels: €5 each, or €15 for a full set (two large, two medium and a bath mat).',
    },
    actions: [{ kind: 'entry', label: { it: 'Chiedi un cambio', en: 'Ask for a change' }, value: 'contacts' }],
    intents: ['cleaning', 'towels'],
    verify: { level: 'confirm', field: 'prezzi teli extra',
      note: 'Pulizia quotidiana e cambio biancheria ogni 3 giorni sono confermati come servizi distinti. Resta da confermare che i teli extra costino ancora 5 € al pezzo e 15 € il set.' },
  },
  {
    id: 'accessibility',
    section: 'stay',
    phase: ['before', 'staying'],
    icon: 'accessibility',
    priority: 7,
    title: { it: 'Scale, ascensore e dislivelli', en: 'Steps, lift and thresholds' },
    summary: {
      it: 'Dall’ingresso si salgono circa sei gradini per raggiungere l’ascensore, che arriva al terzo piano. All’ingresso di alcune camere, bagni o docce possono esserci piccoli dislivelli.',
      en: 'About six steps lead from the entrance to the lift, which serves the third floor. Some rooms, bathrooms and showers have small thresholds at the door.',
    },
    detail: {
      it: 'Se hai difficoltà motorie, o viaggi con un passeggino o bagagli pesanti, dicci qualcosa prima di arrivare: ti spieghiamo cosa aspettarti e, dove possiamo, ti diamo una mano.',
      en: 'If you have limited mobility, or are travelling with a pushchair or heavy luggage, tell us before you arrive: we will explain what to expect and help where we can.',
    },
    actions: [{ kind: 'entry', label: { it: 'Chiedici com’è', en: 'Ask us about access' }, value: 'contacts' }],
    intents: ['accessibility'],
  },
  {
    id: 'noise',
    section: 'stay',
    phase: ['staying'],
    icon: 'ear',
    priority: 9,
    title: { it: 'Rumore', en: 'Noise' },
    summary: {
      it: 'Le camere affacciano sul Lungarno e sul vicolo: è il centro di Firenze, qualche rumore di città arriva. Se ti dà fastidio dillo, vediamo cosa si può fare.',
      en: 'The rooms face the Lungarno and the lane: this is central Florence, so some city noise reaches you. If it bothers you, say so and we will see what we can do.',
    },
    intents: ['noise'],
  },
  {
    id: 'smoking',
    section: 'stay',
    phase: ['staying'],
    icon: 'no-smoking',
    priority: 11,
    title: { it: 'Fumare', en: 'Smoking' },
    summary: {
      it: 'In camera non si fuma, bagno compreso.',
      en: 'Smoking is not allowed in the rooms, bathrooms included.',
    },
    intents: ['smoking'],
  },
  {
    id: 'pets',
    section: 'stay',
    phase: ['before'],
    icon: 'paw',
    priority: 12,
    title: { it: 'Animali', en: 'Pets' },
    summary: {
      it: 'Li valutiamo caso per caso: scrivici prima di prenotare o di arrivare con un animale.',
      en: 'We consider pets case by case: message us before booking or before turning up with one.',
    },
    actions: [{ kind: 'entry', label: { it: 'Chiedi', en: 'Ask us' }, value: 'contacts' }],
    intents: ['pets'],
  },
  {
    id: 'children',
    section: 'stay',
    phase: ['before', 'staying'],
    icon: 'child',
    priority: 10,
    title: { it: 'Bambini, culle e terzo letto', en: 'Children, cots and a third bed' },
    summary: {
      it: 'Le famiglie sono benvenute. Fino a 2 anni i bambini possono dormire gratuitamente nel letto con i genitori; la culla costa 20 € a notte e va richiesta almeno il giorno prima.',
      en: 'Families are welcome. Up to age 2, children may share their parents’ bed free of charge; a cot is €20 per night and should be requested at least the day before.',
    },
    detail: {
      it: 'Dai 3 anni serve un posto letto. Le camere 303 e 305, entrambe Superior, sono quelle che si allestiscono normalmente come triple.\n\nSe la camera è stata prenotata come tripla, il terzo letto è incluso. Se una prenotazione doppia aggiunge dopo un terzo letto nelle Superior, il supplemento è 30 € a notte.\n\nLa 304 può accettare un letto aggiuntivo solo quando è operativamente possibile: va chiesto prima e la sistemazione viene confermata dallo staff.\n\nI minori non accompagnati non soggiornano autonomamente senza preventiva autorizzazione scritta di un genitore o tutore.',
      en: 'From age 3, a separate bed is required. Rooms 303 and 305, both Superior, are the rooms normally set up as triples.\n\nIf the room was booked as a triple, the third bed is included. If a double booking later adds a third bed in a Superior room, the supplement is €30 per night.\n\nRoom 304 can take an extra bed only when operationally practical: ask first and staff will confirm the arrangement.\n\nUnaccompanied minors cannot stay independently without prior written authorisation from a parent or legal guardian.',
    },
    actions: [{ kind: 'entry', label: { it: 'Richiedi una culla', en: 'Request a cot' }, value: 'contacts' }],
    intents: ['children'],
  },
  {
    id: 'hair-in-room',
    section: 'stay',
    phase: ['staying'],
    icon: 'scissors',
    priority: 8,
    title: { it: 'Parrucchiere e barbiere in camera', en: 'Hairdresser and barber in your room' },
    summary: {
      it: 'Taglio, barba o piega nella tua camera, da un professionista che viene da te. Si prenota dalla guida, scegliendo giorno e ora.',
      en: 'A cut, a beard or a blow-dry in your own room, from a professional who comes to you. Booked from the guide, picking a day and a time.',
    },
    detail: {
      it: 'Gli orari che vedi sono quelli realmente liberi: se un giorno non compare, quel giorno non c’è.\n\nNon è previsto il lavaggio: vieni con i capelli già lavati dove il servizio lo richiede. Colore e colpi di sole al momento non li facciamo.',
      en: 'The times you see are the ones actually free: if a day is not there, it is not available.\n\nThere is no wash service: come with your hair already washed where the service needs it. Colour and highlights are not something we do at the moment.',
    },
    actions: [{ kind: 'product', label: { it: 'Prenota il servizio', en: 'Book the service' }, value: 'hair-service' }],
    intents: ['hair'],
  },
  {
    id: 'celebration-in-room',
    section: 'stay',
    phase: ['before', 'staying'],
    icon: 'glass',
    priority: 13,
    title: { it: 'Compleanni, anniversari, proposte', en: 'Birthdays, anniversaries, proposals' },
    summary: {
      it: 'Prepariamo la camera prima che rientriate: fiori, una bottiglia, un biglietto scritto a mano. Si ordina entro mezzogiorno del giorno prima.',
      en: 'We set the room up before you come back: flowers, a bottle, a handwritten card. Ordered by noon the day before.',
    },
    detail: {
      it: 'Tre allestimenti, dal più semplice al più scenografico. Possiamo farlo trovare pronto all’arrivo o durante il soggiorno, all’ora che indicate.\n\nNiente candele a fiamma viva e niente petali sul letto: usiamo luci e candele LED dove servono, e la camera resta pulita e ordinata.',
      en: 'Three set-ups, from the simplest to the most theatrical. We can have it ready when you arrive, or during the stay at the time you choose.\n\nNo open-flame candles and no petals on the bed: we use LED candles and lights where they belong, and the room stays clean and uncluttered.',
    },
    actions: [{ kind: 'product', label: { it: 'Vedi gli allestimenti', en: 'See the set-ups' }, value: 'celebration' }],
    intents: ['celebration'],
  },
  {
    id: 'water',
    section: 'stay',
    phase: ['staying'],
    icon: 'drop',
    priority: 14,
    title: { it: 'Un pensiero all’acqua', en: 'A thought for the water' },
    summary: {
      it: 'Chiudi il rubinetto mentre non lo usi e usa il mezzo scarico quando basta. Firenze ti ringrazia.',
      en: 'Turn the tap off while you are not using it, and use the half flush when that is enough. Florence thanks you.',
    },
    intents: [],
  },
];
