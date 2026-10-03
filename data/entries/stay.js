/**
 * Life inside the room.
 *
 * Two claims from the old site are gone on purpose. "Camere 302, 303 e 305 le più
 * tranquille (cortile interno)" contradicted every room description, which places
 * all of them over the street and the Arno — so the noise entry now says what is
 * actually true. And "Bambini benvenuti / età minima 18 anni" was self-contradictory;
 * families are welcome per the September 2026 material, and the booking-side rule
 * about minors is left to the staff rather than half-stated here.
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
      it: 'Bagno privato, Smart TV con le tue app di streaming, macchina Nespresso con capsule di cortesia, bollitore con tè e tisane, mini-frigo, cassaforte e kit di benvenuto.',
      en: 'Private bathroom, a Smart TV with your own streaming apps, a Nespresso machine with complimentary capsules, a kettle with teas, a mini-fridge, a safe and a welcome kit.',
    },
    detail: {
      it: 'Il bagno ha doccia, bidet, accappatoi, pantofole e amenities.\n\nSulla Smart TV puoi accedere ai tuoi account di streaming: ricordati di uscire dalle app prima di partire.',
      en: 'The bathroom has a shower, bidet, bathrobes, slippers and toiletries.\n\nYou can sign in to your own streaming accounts on the Smart TV: remember to sign out again before you leave.',
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
    title: { it: 'Bambini, culle e lettini', en: 'Children, cots and extra beds' },
    summary: {
      it: 'Le famiglie sono benvenute. Culle e lettini si possono avere su richiesta: chiedili almeno il giorno prima, non all’arrivo.',
      en: 'Families are welcome. Cots and extra beds are available on request: ask at least the day before, not on arrival.',
    },
    detail: {
      it: 'Le camere 303 e 305 sono quelle che si possono allestire con un letto aggiuntivo.\n\nLa soluzione Familiare, con due ambienti separati, non è ancora prenotabile.',
      en: 'Rooms 303 and 305 are the ones that can take an extra bed.\n\nThe family suite, with two separate rooms, is not bookable yet.',
    },
    actions: [{ kind: 'entry', label: { it: 'Richiedi una culla', en: 'Request a cot' }, value: 'contacts' }],
    intents: ['children'],
    verify: { level: 'confirm',
      note: 'La knowledge storica diceva insieme «Bambini: sì» e «età minima 18 anni», che si contraddicono. Qui resta solo che le famiglie sono benvenute e che culle e lettini si chiedono prima: confermare se esiste davvero una regola sui minori e, se sì, quale.' },
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
