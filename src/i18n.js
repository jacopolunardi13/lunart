/**
 * Language handling.
 *
 * Content strings live beside the content, in the data layer. Only interface
 * chrome — the words that are not facts about LunArt — lives here.
 */

const STORAGE_KEY = 'lunart.lang';

export const UI = {
  it: {
    skip: 'Vai al contenuto',
    guide: 'Guida',
    florence: 'Firenze',
    concierge: 'Concierge',
    help: 'Aiuto',
    search: 'Cerca qualcosa…',
    searchTitle: 'Cerca',
    close: 'Chiudi',
    back: 'Indietro',
    copy: 'Copia',
    copied: 'Copiato',
    quickTitle: 'Le cose che servono subito',
    phaseLabel: 'A che punto sei?',
    rooms: 'Le camere',
    roomsAll: 'In ogni camera',
    comingSoon: 'Prossima apertura',
    noResults: 'Nessun risultato. Prova con un’altra parola, o chiedi al Concierge.',
    conciergeSub: 'Risponde su LunArt e su Firenze',
    conciergeOpening: 'Buongiorno. Chiedimi pure: Wi-Fi, check-in, colazione, parcheggio, dove mangiare.',
    conciergeUnknown: 'Questa non la so, e preferisco non inventare. Scrivi a Diego: ti risponde una persona.',
    conciergeChoice: 'Posso intenderla in due modi. Quale ti serve?',
    conciergePlaceholder: 'Scrivi qui…',
    send: 'Invia',
    openMaps: 'Apri in Maps',
    website: 'Sito',
    writeToStaff: 'Scrivi su WhatsApp',
    callStaff: 'Chiama',
    emailStaff: 'Manda una mail',
    emergencyTitle: 'Numeri utili',
    itineraries: 'Itinerari',
    dayTrips: 'Gite fuori città',
    reviewTitle: 'Da verificare prima della pubblicazione',
    reviewNote: 'Schermata di revisione — non visibile agli ospiti.',
    slideOf: 'Foto {n} di {total}',
    about: 'Dove sei',
    footer: 'LunArt · Vicolo del Canneto 2, Firenze',
  },
  en: {
    skip: 'Skip to content',
    guide: 'Guide',
    florence: 'Florence',
    concierge: 'Concierge',
    help: 'Help',
    search: 'Search for something…',
    searchTitle: 'Search',
    close: 'Close',
    back: 'Back',
    copy: 'Copy',
    copied: 'Copied',
    quickTitle: 'What you need first',
    phaseLabel: 'Where are you up to?',
    rooms: 'The rooms',
    roomsAll: 'In every room',
    comingSoon: 'Opening soon',
    noResults: 'Nothing found. Try another word, or ask the Concierge.',
    conciergeSub: 'Answers about LunArt and Florence',
    conciergeOpening: 'Good morning. Ask me anything: Wi-Fi, check-in, breakfast, parking, where to eat.',
    conciergeUnknown: 'I don’t know this one, and I would rather not invent it. Message Diego — a person will answer.',
    conciergeChoice: 'I can read that two ways. Which did you mean?',
    conciergePlaceholder: 'Type here…',
    send: 'Send',
    openMaps: 'Open in Maps',
    website: 'Website',
    writeToStaff: 'Message on WhatsApp',
    callStaff: 'Call',
    emailStaff: 'Send an email',
    emergencyTitle: 'Useful numbers',
    itineraries: 'Itineraries',
    dayTrips: 'Trips out of town',
    reviewTitle: 'To verify before publication',
    reviewNote: 'Review screen — not visible to guests.',
    slideOf: 'Photo {n} of {total}',
    about: 'Where you are',
    footer: 'LunArt · Vicolo del Canneto 2, Florence',
  },
};

/** Browser preference first, then whatever the guest last chose. */
export function initialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'it' || saved === 'en') return saved;
  } catch { /* private browsing: fall through to the browser preference */ }
  return navigator.language?.toLowerCase().startsWith('it') ? 'it' : 'en';
}

export function saveLang(lang) {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* nothing to do */ }
}
