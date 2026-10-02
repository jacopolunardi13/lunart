/** When something is wrong, or a guest just needs a person. */

export const help = [
  {
    id: 'contacts',
    section: 'help',
    phase: ['before', 'staying', 'leaving'],
    icon: 'chat',
    priority: -20,
    title: { it: 'Parlare con qualcuno', en: 'Talk to someone' },
    summary: {
      it: 'Per il soggiorno, il check-in e qualsiasi problema scrivi a Diego su WhatsApp. Per prenotazioni e organizzazione, a Jacopo.',
      en: 'For your stay, check-in and anything that goes wrong, message Diego on WhatsApp. For bookings and arrangements, Jacopo.',
    },
    detail: {
      it: 'WhatsApp è il modo più veloce: lo leggiamo anche quando non possiamo rispondere al telefono.',
      en: 'WhatsApp is fastest: we see it even when we cannot pick up the phone.',
    },
    intents: ['contacts'],
  },
  {
    id: 'room-problem',
    section: 'help',
    phase: ['staying'],
    icon: 'wrench',
    priority: -10,
    title: { it: 'Qualcosa non funziona in camera', en: 'Something is not working' },
    summary: {
      it: 'Scrivici su WhatsApp dicendo il numero della camera e cosa succede. Le cose piccole si risolvono quasi sempre in giornata.',
      en: 'Message us on WhatsApp with your room number and what is happening. Small things are almost always sorted the same day.',
    },
    detail: {
      it: 'Prima di scrivere, due controlli che risolvono la metà dei casi:\n\n— clima spento? Guarda se una finestra è aperta: i sensori lo spengono.\n— scaldasalviette freddo? Tieni il + per 3–5 secondi.\n\nSe non è questo, scrivici e basta: ci pensiamo noi.',
      en: 'Before you write, two checks that solve half the cases:\n\n— climate off? See whether a window is open: the sensors switch it off.\n— towel rail cold? Hold + for 3–5 seconds.\n\nIf it is neither, just message us: we will take it from there.',
    },
    actions: [{ kind: 'entry', label: { it: 'Scrivi a Diego', en: 'Message Diego' }, value: 'contacts' }],
    intents: ['room-problem'],
  },
  {
    id: 'emergency',
    section: 'help',
    phase: ['staying'],
    icon: 'alert',
    priority: -5,
    title: { it: 'Emergenze', en: 'Emergencies' },
    summary: {
      it: 'Per un’emergenza chiama il 112: è il numero unico europeo e risponde anche in inglese.',
      en: 'In an emergency call 112: the single European number, answered in English too.',
    },
    detail: {
      it: 'Per una farmacia aperta adesso, apri la ricerca qui sotto: i turni cambiano ogni giorno.\n\nSe si tratta della struttura — una perdita, la porta che non apre, un allarme — scrivi o chiama Diego.',
      en: 'For a pharmacy open right now, use the search below: the rota changes daily.\n\nIf it concerns the building — a leak, a door that will not open, an alarm — message or call Diego.',
    },
    intents: ['emergency'],
  },
  {
    id: 'invoice',
    section: 'help',
    phase: ['staying', 'leaving'],
    icon: 'receipt',
    priority: 5,
    title: { it: 'Fattura', en: 'Invoice' },
    summary: {
      it: 'Se ti serve fattura, dillo prima che venga emesso lo scontrino: dopo non si può più cambiare.',
      en: 'If you need an invoice, say so before the receipt is issued: afterwards it cannot be changed.',
    },
    actions: [{ kind: 'entry', label: { it: 'Richiedila', en: 'Request one' }, value: 'contacts' }],
    intents: ['invoice'],
  },
  {
    id: 'booking-terms',
    section: 'help',
    phase: ['before'],
    icon: 'card',
    priority: 8,
    title: { it: 'Pagamento e cancellazioni', en: 'Payment and cancellations' },
    summary: {
      it: 'Le tariffe di norma non prevedono cancellazione gratuita. Con sufficiente anticipo si può valutare un cambio date, secondo disponibilità.',
      en: 'Rates do not normally include free cancellation. With enough notice a change of dates can be considered, subject to availability.',
    },
    detail: {
      it: 'Per le prenotazioni gestite a mano resta possibile il bonifico anticipato, con la camera bloccata per 24 ore in attesa della contabile.\n\nPer qualsiasi richiesta specifica, parlane direttamente con Jacopo.',
      en: 'For manually handled bookings, advance bank transfer remains possible, with the room held for 24 hours pending proof of payment.\n\nFor anything specific, speak to Jacopo directly.',
    },
    actions: [{ kind: 'entry', label: { it: 'Scrivi a Jacopo', en: 'Message Jacopo' }, value: 'contacts' }],
    intents: ['booking-terms'],
  },
];
