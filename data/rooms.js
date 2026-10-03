/**
 * The rooms, as a guest who has already booked needs them: which one am I in, what
 * does it look over, what is in it. Not a sales sheet.
 *
 * Category names follow the historic knowledge base (Standard / Deluxe / Superior),
 * which is what the room descriptions and photographs support. The InYourLife draft
 * uses a different ladder (Standard / Queen / Queen Deluxe / Superior) — that
 * mismatch is carried in `verify` rather than guessed at.
 */

export const rooms = [
  {
    id: '301',
    number: '301',
    category: { it: 'Standard', en: 'Standard' },
    view: { it: 'Vicolo e Arno', en: 'Lane and Arno' },
    summary: {
      it: 'La più raccolta della casa, affacciata sulla strada e sul fiume. Giusta per chi viaggia solo o in due.',
      en: 'The snuggest room here, looking onto the street and the river. Right for one or two travellers.',
    },
    photos: [
      { src: 'rooms/301-camera', alt: { it: 'Camera 301, letto matrimoniale e finestra sul vicolo', en: 'Room 301, double bed and window onto the lane' } },
      { src: 'rooms/301-bagno', alt: { it: 'Bagno privato della 301 con doccia', en: 'Private bathroom of room 301 with shower' } },
    ],
  },
  {
    id: '302',
    number: '302',
    category: { it: 'Deluxe', en: 'Deluxe' },
    view: { it: 'Arno e scorcio sugli Uffizi', en: 'Arno and a glimpse of the Uffizi' },
    summary: {
      it: 'Ampia, con scrivania e un affaccio che prende il fiume e, di lato, gli Uffizi.',
      en: 'Spacious, with a desk and an outlook that takes in the river and, to one side, the Uffizi.',
    },
    photos: [
      { src: 'rooms/302-camera', alt: { it: 'Camera 302 con letto matrimoniale', en: 'Room 302 with double bed' } },
      { src: 'rooms/302-scrivania', alt: { it: 'Scrivania e TV della camera 302', en: 'Desk and TV in room 302' } },
      { src: 'rooms/302-letti', alt: { it: 'Camera 302 allestita con due letti singoli', en: 'Room 302 set up with twin beds' } },
      { src: 'rooms/302-bagno', alt: { it: 'Bagno privato della 302', en: 'Private bathroom of room 302' } },
    ],
  },
  {
    id: '303',
    number: '303',
    category: { it: 'Superior', en: 'Superior' },
    view: { it: 'Arno e Uffizi, doppia esposizione', en: 'Arno and Uffizi, dual aspect' },
    highlight: true,
    summary: {
      it: 'Angolare, due finestre su due lati: il fiume da una parte, gli Uffizi dall’altra. Si può allestire come tripla.',
      en: 'A corner room with windows on two sides: the river on one, the Uffizi on the other. It can take a third bed.',
    },
    photos: [
      { src: 'rooms/303-camera', alt: { it: 'Camera 303 con testiera capitonné', en: 'Room 303 with tufted headboard' } },
      { src: 'rooms/303-bagno', alt: { it: 'Bagno privato della 303', en: 'Private bathroom of room 303' } },
    ],
  },
  {
    id: '304',
    number: '304',
    category: { it: 'Deluxe', en: 'Deluxe' },
    view: { it: 'Arno e Uffizi', en: 'Arno and Uffizi' },
    summary: {
      it: 'Spaziosa e luminosa, con vista sul fiume e sugli Uffizi.',
      en: 'Bright and roomy, looking over the river and the Uffizi.',
    },
    photos: [
      { src: 'rooms/304-camera', alt: { it: 'Camera Deluxe LunArt con scrivania e finestra', en: 'LunArt Deluxe room with desk and window' } },
      { src: 'rooms/304-bagno', alt: { it: 'Bagno privato LunArt con doccia', en: 'LunArt private bathroom with shower' } },
    ],
    verify: { level: 'confirm', field: 'foto',
      note: 'Il vecchio sito mostrava per la 304 le stesse due foto della 303. Qui usa invece due scatti generici della struttura, con didascalie che non attribuiscono la stanza: servono foto dedicate della 304.' },
  },
  {
    id: '305',
    number: '305',
    category: { it: 'Superior', en: 'Superior' },
    view: { it: 'Arno e Uffizi, doppia esposizione', en: 'Arno and Uffizi, dual aspect' },
    summary: {
      it: 'Ampia e luminosa, doppia esposizione sul fiume e sugli Uffizi. Si può allestire come tripla.',
      en: 'Large and light, dual aspect over the river and the Uffizi. It can take a third bed.',
    },
    photos: [
      { src: 'rooms/305-camera', alt: { it: 'Camera 305 con letto matrimoniale', en: 'Room 305 with double bed' } },
      { src: 'rooms/305-bagno', alt: { it: 'Bagno privato della 305', en: 'Private bathroom of room 305' } },
    ],
  },
  {
    id: '306',
    number: '306',
    category: { it: 'Familiare', en: 'Family' },
    comingSoon: true,
    view: null,
    summary: {
      it: 'Due ambienti separati e due bagni privati. Non è ancora prenotabile.',
      en: 'Two separate rooms and two private bathrooms. Not bookable yet.',
    },
    photos: [],
    verify: { level: 'confirm',
      note: 'Confermato: la soluzione Familiare resta “prossima apertura” e non prenotabile. Da aggiornare solo quando diventa effettivamente vendibile.' },
  },
];

/** Shared across every room, so it is stated once rather than six times. */
export const roomsCommon = {
  it: 'Tutte le camere sono al terzo piano, con bagno privato, climatizzazione, Smart TV, macchina Nespresso, bollitore, mini-frigo e cassaforte.',
  en: 'Every room is on the third floor, with a private bathroom, climate control, a Smart TV, a Nespresso machine, a kettle, a mini-fridge and a safe.',
};
