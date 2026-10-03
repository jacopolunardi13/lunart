/**
 * Breakfast. Opera Caffè is the experience; the café downstairs is the shortcut.
 * The September 2026 corrections ask for exactly that emphasis, and for the in-room
 * option to read as something arranged in advance rather than a standing room service.
 */

export const breakfast = [
  {
    id: 'breakfast',
    section: 'breakfast',
    phase: ['staying'],
    icon: 'cup',
    priority: -15,
    title: { it: 'Dove si fa colazione', en: 'Where breakfast happens' },
    summary: {
      it: 'È inclusa nel soggiorno e si fa all’Opera Caffè, in Piazza del Duomo, ai piedi del Campanile di Giotto: colazione completa con servizio al tavolo, a una passeggiata di circa quindici minuti.',
      en: 'It is included in your stay and happens at Opera Caffè in Piazza del Duomo, at the foot of Giotto’s bell tower: a full breakfast served at the table, about a fifteen-minute walk away.',
    },
    detail: {
      it: 'Sì, non è sotto casa — ed è voluto. Fai colazione guardando il Duomo invece che un muro, e la strada per arrivarci è una delle più belle della città.\n\nMostra la conferma di prenotazione LunArt prima di ordinare.\n\nNello stesso posto puoi lasciare i bagagli, gratis, prima del check-in o dopo il check-out.',
      en: 'It is not downstairs — and that is the point. You have breakfast looking at the Duomo rather than a wall, and the walk there is one of the finest in the city.\n\nShow your LunArt booking confirmation before you order.\n\nThe same place stores your luggage, free, before check-in or after check-out.',
    },
    facts: [
      { label: { it: 'Dove', en: 'Where' }, value: 'Opera Caffè · Piazza del Duomo 62R' },
      { label: { it: 'A piedi', en: 'On foot' }, value: { it: '~15 minuti', en: '~15 minutes' } },
      { label: { it: 'Orari', en: 'Hours' }, value: { it: 'te li confermiamo all’arrivo', en: 'we confirm them on arrival' } },
    ],
    actions: [
      { kind: 'map', label: { it: 'Apri in Maps', en: 'Open in Maps' }, value: 'https://maps.app.goo.gl/uok3CmvHBLmwieoV9' },
      { kind: 'entry', label: { it: 'Il vantaggio per gli ospiti', en: 'The guest benefit' }, value: 'opera-benefit' },
    ],
    intents: ['breakfast'],
    verify: { level: 'volatile', field: 'orari',
      note: 'La knowledge storica indicava 8:30–11:00. Non è confermato dai documenti di settembre 2026, quindi la guida non pubblica un orario: va chiesto all’Opera Caffè e inserito qui se stabile.' },
  },
  {
    id: 'breakfast-light',
    section: 'breakfast',
    phase: ['staying'],
    icon: 'espresso',
    priority: -12,
    title: { it: 'Se hai poco tempo', en: 'If you are in a hurry' },
    summary: {
      it: 'C’è una colazione veloce all’italiana nella caffetteria all’angolo dell’edificio: caffè, brioche e via.',
      en: 'There is a quick Italian breakfast at the café on the corner of the building: coffee, pastry, done.',
    },
    detail: {
      it: 'È l’alternativa pratica per chi parte presto o preferisce non allontanarsi. L’esperienza vera però è quella in Piazza del Duomo: se hai una mattina libera, vale la camminata.',
      en: 'It is the practical option if you are leaving early or would rather not go far. The real experience is the one in Piazza del Duomo, though: if you have a free morning, it is worth the walk.',
    },
    intents: ['breakfast-light'],
  },
  {
    id: 'opera-benefit',
    section: 'breakfast',
    phase: ['staying'],
    icon: 'gift',
    priority: -10,
    title: { it: 'Il vantaggio riservato agli ospiti', en: 'The guest benefit' },
    summary: {
      it: 'Agli ospiti LunArt l’Opera Caffè riserva il 30% di sconto sul menù al tavolo. Mostra la conferma di prenotazione prima di ordinare.',
      en: 'Opera Caffè gives LunArt guests 30% off table orders. Show your booking confirmation before you order.',
    },
    detail: {
      it: 'Vale anche se torni per un pranzo, una cena o un aperitivo, non solo per la colazione.',
      en: 'It applies when you come back for lunch, dinner or an aperitivo too, not just at breakfast.',
    },
    actions: [{ kind: 'product', label: { it: 'La Privilege Card', en: 'The Privilege Card' }, value: 'privilege-card' }],
    intents: ['opera-benefit'],
  },
  {
    id: 'breakfast-room',
    section: 'breakfast',
    phase: ['staying'],
    icon: 'tray',
    priority: -5,
    title: { it: 'Colazione in camera', en: 'Breakfast in the room' },
    summary: {
      it: 'Si può organizzare, chiedendola almeno il giorno prima. Non è un servizio continuativo: va concordata di volta in volta.',
      en: 'It can be arranged, asked for at least the day before. It is not a standing service: it is agreed each time.',
    },
    actions: [
      { kind: 'product', label: { it: 'Ordina la colazione', en: 'Order breakfast' }, value: 'light-breakfast' },
      { kind: 'product', label: { it: 'Ordina il brunch', en: 'Order the brunch' }, value: 'brunch' },
      { kind: 'entry', label: { it: 'Oppure scrivici', en: 'Or message us' }, value: 'contacts' },
    ],
    intents: ['breakfast-room'],
  },
  {
    id: 'breakfast-early',
    section: 'breakfast',
    phase: ['staying', 'leaving'],
    icon: 'sunrise',
    priority: -3,
    title: { it: 'Se parti prestissimo', en: 'If you leave very early' },
    summary: {
      it: 'Per partenze prima dell’apertura dei bar si può organizzare qualcosa da portare via. Chiedilo la sera prima, non la mattina stessa.',
      en: 'For departures before the cafés open we can arrange something to take with you. Ask the evening before, not on the morning itself.',
    },
    actions: [{ kind: 'entry', label: { it: 'Organizziamola', en: 'Let’s arrange it' }, value: 'contacts' }],
    intents: ['breakfast-early'],
  },
  {
    id: 'dietary',
    section: 'breakfast',
    phase: ['before', 'staying'],
    icon: 'leaf',
    priority: 0,
    title: { it: 'Intolleranze e scelte alimentari', en: 'Allergies and dietary choices' },
    summary: {
      it: 'Vegano, vegetariano, senza glutine, allergie: dillo almeno il giorno prima e ci organizziamo.',
      en: 'Vegan, vegetarian, gluten-free, allergies: tell us at least a day ahead and we will sort it out.',
    },
    actions: [{ kind: 'entry', label: { it: 'Segnala un’esigenza', en: 'Tell us about it' }, value: 'contacts' }],
    intents: ['dietary'],
  },
];
