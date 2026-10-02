/**
 * Everything a guest needs between leaving home and standing in the room.
 *
 * Source precedence, where the materials disagree:
 *   1. LunArt's current operating knowledge (September 2026)
 *   2. The InYourLife September 2026 documents
 *   3. The historic knowledge base
 *
 * The old site advertised "check-in 15:00–21:00" and a ZTL procedure stated as
 * certainty. Both are corrected here: the welcome window is described as it actually
 * works, and anything that depends on a third party points at that third party.
 */

export const arrival = [
  {
    id: 'checkin',
    section: 'arrival',
    phase: ['before'],
    icon: 'key',
    priority: -10,
    title: { it: 'A che ora posso arrivare', en: 'When you can arrive' },
    summary: {
      it: 'Il check-in è dalle 15:00. Nella normale fascia di arrivo trovi qualcuno ad accoglierti; più tardi entri con il tuo codice personale, sempre con assistenza.',
      en: 'Check-in is from 3:00 PM. Within the usual arrival window someone is there to welcome you; later on you let yourself in with your personal code, always with support available.',
    },
    detail: {
      it: 'Facci sapere un orario indicativo di arrivo: ci aiuta a esserci. Un messaggio quando sei a circa mezz’ora da Firenze è perfetto.\n\nL’accoglienza di persona copre la normale fascia di arrivo, orientativamente fino alle 20:00–20:30. Se arrivi dopo, ricevi comunque il codice e le istruzioni, e qualcuno resta raggiungibile al telefono.',
      en: 'Let us know roughly when you expect to arrive — it helps us be there. A message when you are about half an hour away is ideal.\n\nThe in-person welcome covers the usual arrival window, broadly until 8:00–8:30 PM. If you arrive later you still receive your code and instructions, and someone stays reachable by phone.',
    },
    facts: [
      { label: { it: 'Check-in', en: 'Check-in' }, value: { it: 'dalle 15:00', en: 'from 3:00 PM' } },
      { label: { it: 'Check-out', en: 'Check-out' }, value: { it: 'entro le 11:00', en: 'by 11:00 AM' } },
    ],
    actions: [{ kind: 'entry', label: { it: 'Avvisa del tuo arrivo', en: 'Tell us when you arrive' }, value: 'contacts' }],
    intents: ['checkin'],
  },
  {
    id: 'late-arrival',
    section: 'arrival',
    phase: ['before'],
    icon: 'moon',
    priority: -5,
    title: { it: 'Se arrivi tardi la sera', en: 'If you arrive late' },
    summary: {
      it: 'Nessun problema: entri con un codice personale che ricevi prima dell’arrivo, e se qualcosa non torna puoi chiamarci anche a tarda ora.',
      en: 'Not a problem: you let yourself in with a personal code sent before you arrive, and if anything is unclear you can call us even late.',
    },
    detail: {
      it: 'Il codice è tuo e vale per il tuo soggiorno. Arriva via messaggio insieme alle istruzioni per il portone e per la porta di LunArt.\n\nSe non ti è ancora arrivato, o se il volo slitta, scrivici: è il genere di cosa che si risolve in un minuto.',
      en: 'The code is yours and lasts for your stay. It arrives by message together with instructions for the street door and the LunArt door.\n\nIf you have not received it yet, or your flight slips, message us: this is the kind of thing that takes a minute to sort out.',
    },
    actions: [{ kind: 'entry', label: { it: 'Scrivici', en: 'Message us' }, value: 'contacts' }],
    intents: ['late-arrival'],
  },
  {
    id: 'access',
    section: 'arrival',
    phase: ['before', 'staying'],
    icon: 'door',
    priority: -8,
    title: { it: 'Come si entra', en: 'Getting in' },
    summary: {
      it: 'Vicolo del Canneto 2. Dal portone si salgono circa sei gradini, poi c’è l’ascensore: LunArt è al terzo piano, la porta ha la targa.',
      en: 'Vicolo del Canneto 2. About six steps up from the street door, then the lift: LunArt is on the third floor and the door is signed.',
    },
    detail: {
      it: 'Il vicolo è stretto e si imbocca dal Lungarno: se il navigatore ti porta davanti a un portone senza insegna, sei nel posto giusto.\n\nI codici per il portone e per la porta arrivano via messaggio prima dell’arrivo. Se non li trovi, cercali nella chat con Diego prima di suonare da qualcun altro.',
      en: 'The lane is narrow and opens off the Lungarno: if your map app leaves you in front of an unmarked door, you are in the right place.\n\nThe codes for the street door and the apartment door arrive by message before you travel. If you cannot find them, check your chat with Diego before ringing anyone else’s bell.',
    },
    facts: [
      { label: { it: 'Indirizzo', en: 'Address' }, value: 'Vicolo del Canneto 2, 50125 Firenze' },
      { label: { it: 'Piano', en: 'Floor' }, value: { it: '3° — ascensore dopo ~6 gradini', en: '3rd — lift after ~6 steps' } },
    ],
    actions: [
      { kind: 'map', label: { it: 'Apri in Maps', en: 'Open in Maps' }, value: 'https://maps.app.goo.gl/mQsN2cY8eihAXVjb8' },
      { kind: 'entry', label: { it: 'Non trovo il codice', en: 'I can’t find my code' }, value: 'contacts' },
    ],
    intents: ['access', 'pin'],
  },
  {
    id: 'luggage-early',
    section: 'arrival',
    phase: ['before'],
    icon: 'suitcase',
    priority: -3,
    title: { it: 'Bagagli prima del check-in', en: 'Bags before check-in' },
    summary: {
      it: 'Puoi lasciarli gratuitamente all’Opera Caffè, in Piazza del Duomo, negli orari di apertura. Accanto alla struttura c’è anche un luggage store a pagamento.',
      en: 'You can leave them free of charge at Opera Caffè in Piazza del Duomo, during opening hours. There is also a paid luggage store next to the building.',
    },
    detail: {
      it: 'Il deposito all’Opera Caffè vale sia prima del check-in sia dopo il check-out, ed è lo stesso posto della colazione: molti ospiti lasciano le valigie e si siedono a fare colazione.\n\nSe arrivi molto presto o molto tardi rispetto agli orari del locale, il luggage store accanto a LunArt è l’alternativa comoda.',
      en: 'Storage at Opera Caffè works both before check-in and after check-out, and it is the same place as breakfast: plenty of guests drop their bags and sit down to eat.\n\nIf you arrive well outside the café’s hours, the luggage store next to LunArt is the convenient alternative.',
    },
    actions: [
      { kind: 'map', label: { it: 'Opera Caffè', en: 'Opera Caffè' }, value: 'https://maps.app.goo.gl/uok3CmvHBLmwieoV9' },
      { kind: 'map', label: { it: 'Luggage store', en: 'Luggage store' }, value: 'https://maps.app.goo.gl/NGxTxK96jRVvErwU9' },
    ],
    intents: ['luggage'],
    verify: { level: 'volatile', field: 'orari',
      note: 'Gli orari del deposito all’Opera Caffè cambiano con la stagione. La guida dice “negli orari di apertura” invece di fissare 8:30–20:00 come faceva il vecchio sito.' },
  },
  {
    id: 'parking',
    section: 'arrival',
    phase: ['before'],
    icon: 'car',
    priority: 0,
    title: { it: 'Arrivare in auto e parcheggiare', en: 'Arriving by car and parking' },
    summary: {
      it: 'LunArt non ha parcheggio e si trova in ZTL. La soluzione consigliata è il Garage Lungarno, a pochi passi: vai direttamente lì, non sotto casa.',
      en: 'LunArt has no parking and sits inside the ZTL. The recommended option is Garage Lungarno, a few steps away: drive straight there, not to the door.',
    },
    detail: {
      it: 'Garage Lungarno, in Borgo San Jacopo, applica una tariffa giornaliera indicativa intorno ai 35 € ed è prenotabile sul loro sito.\n\nPoco distante c’è anche il Garage Ponte Vecchio, ancora più vicino alla struttura ma in genere più caro, con tariffa che dipende dal veicolo.\n\nConferma sempre la tariffa con il garage: dipende dall’auto e dal periodo.',
      en: 'Garage Lungarno, on Borgo San Jacopo, charges an indicative daily rate of around €35 and can be booked on their site.\n\nGarage Ponte Vecchio is also close by, nearer still to the building but generally more expensive, with a rate that depends on the vehicle.\n\nAlways confirm the rate with the garage: it varies by car and by season.',
    },
    facts: [
      { label: { it: 'Garage Lungarno', en: 'Garage Lungarno' }, value: { it: 'Borgo San Jacopo 10 · ~35 €/giorno', en: 'Borgo San Jacopo 10 · ~€35/day' } },
      { label: { it: 'Garage Ponte Vecchio', en: 'Garage Ponte Vecchio' }, value: { it: 'Via de’ Bardi 45 · tariffa per veicolo', en: 'Via de’ Bardi 45 · rate by vehicle' } },
    ],
    actions: [
      { kind: 'url', label: { it: 'Prenota Garage Lungarno', en: 'Book Garage Lungarno' }, value: 'https://www.garagelungarno.it' },
      { kind: 'map', label: { it: 'Garage Lungarno in Maps', en: 'Garage Lungarno in Maps' }, value: 'https://www.google.com/maps/place/?q=place_id:ChIJBc7V_f9TKhMRtW96OwvnE-Q' },
      { kind: 'entry', label: { it: 'Come funziona la ZTL', en: 'How the ZTL works' }, value: 'ztl' },
    ],
    intents: ['parking'],
    verify: { level: 'volatile', field: 'tariffe',
      note: 'Le tariffe dei garage sono dati di terzi. La guida le dà come indicative e rimanda al garage; il vecchio sito pubblicava un listino preciso (35/45-55/70 €) e gli orari di apertura, ora rimossi.' },
  },
  {
    id: 'ztl',
    section: 'arrival',
    phase: ['before'],
    icon: 'camera',
    priority: 1,
    title: { it: 'ZTL — come funziona', en: 'The ZTL — how it works' },
    summary: {
      it: 'Il centro è a traffico limitato e LunArt è dentro la zona. Per entrare legalmente vai in garage: è il garage a registrare la tua targa secondo le procedure vigenti.',
      en: 'The centre is a restricted traffic zone and LunArt is inside it. To enter legally, drive to the garage: the garage registers your plate under the procedures in force.',
    },
    detail: {
      it: 'In pratica: imposta il navigatore sul garage, non su LunArt. Passando i varchi la telecamera leggerà la targa, e la registrazione fatta dal garage è ciò che autorizza quel transito.\n\nNon perdere tempo in giro prima di arrivare al garage: la registrazione va fatta a ridosso dell’ingresso in zona. L’indicazione operativa che abbiamo parla di una finestra di circa due ore e mezza, ma è il garage a conoscere la procedura aggiornata.\n\nAnche in uscita segui il percorso che ti indica il garage: è il momento in cui è più facile sbagliare varco.',
      en: 'In practice: set your navigation to the garage, not to LunArt. As you pass the gates a camera reads your plate, and the registration the garage performs is what authorises that passage.\n\nDo not wander before reaching the garage: registration belongs close to the moment you enter the zone. Our operating note mentions a window of roughly two and a half hours, but the garage knows the current procedure.\n\nOn the way out, follow the route the garage gives you: that is when it is easiest to cross the wrong gate.',
    },
    actions: [
      { kind: 'url', label: { it: 'Sito Garage Lungarno', en: 'Garage Lungarno site' }, value: 'https://www.garagelungarno.it' },
      { kind: 'entry', label: { it: 'Hai un dubbio? Scrivici', en: 'Not sure? Message us' }, value: 'contacts' },
    ],
    intents: ['ztl'],
    verify: { level: 'blocker', field: 'finestra 2h30',
      note: 'Confermare con Garage Lungarno la finestra temporale per la registrazione targa (la conoscenza storica dice ~2h30) e la procedura in uscita. La guida la presenta come indicazione e non come garanzia; va confermata o riformulata prima della pubblicazione.' },
  },
  {
    id: 'from-station',
    section: 'arrival',
    phase: ['before'],
    icon: 'train',
    priority: 4,
    title: { it: 'Dalla stazione di Santa Maria Novella', en: 'From Santa Maria Novella station' },
    summary: {
      it: 'Circa 15 minuti a piedi lungo l’Arno, se non hai troppi bagagli. In alternativa il taxi è comodo e breve.',
      en: 'About a 15-minute walk along the Arno, if you are not loaded with luggage. Otherwise a taxi is quick and easy.',
    },
    actions: [
      { kind: 'map', label: { it: 'Percorso a piedi', en: 'Walking route' },
        value: 'https://www.google.com/maps/dir/?api=1&origin=Firenze+Santa+Maria+Novella&destination=Vicolo+del+Canneto+2+Firenze&travelmode=walking' },
    ],
    intents: ['from-station'],
  },
  {
    id: 'from-airport',
    section: 'arrival',
    phase: ['before'],
    icon: 'plane',
    priority: 5,
    title: { it: 'Dall’aeroporto di Firenze', en: 'From Florence airport' },
    summary: {
      it: 'Tramvia T2 fino a Santa Maria Novella e poi a piedi o in taxi; oppure taxi diretto. Su richiesta organizziamo un NCC privato.',
      en: 'Tram line T2 to Santa Maria Novella, then on foot or by taxi; or a taxi straight here. On request we can arrange a private driver.',
    },
    detail: {
      it: 'Il taxi dall’aeroporto al centro ha una tariffa fissa comunale: chiedi conferma al conducente prima di partire.\n\nPer un NCC serve preavviso: chiedilo con almeno 24 ore e, se possibile, al momento della prenotazione.',
      en: 'Taxis from the airport into the centre run on a fixed municipal fare: confirm it with the driver before setting off.\n\nA private driver needs notice: ask at least 24 hours ahead, and ideally when you book.',
    },
    actions: [{ kind: 'entry', label: { it: 'Richiedi un NCC', en: 'Request a private driver' }, value: 'transfer' }],
    intents: ['from-airport'],
  },
  {
    id: 'city-tax',
    section: 'arrival',
    phase: ['before', 'leaving'],
    icon: 'receipt',
    priority: 8,
    title: { it: 'Tassa di soggiorno', en: 'City tax' },
    summary: {
      it: 'È un’imposta del Comune di Firenze, non inclusa nella tariffa: 6 € a persona per notte, per un massimo di 7 notti consecutive. Si paga in struttura.',
      en: 'A City of Florence tax, not included in the room rate: €6 per person per night, for a maximum of 7 consecutive nights. Paid at the property.',
    },
    facts: [
      { label: { it: 'Importo', en: 'Amount' }, value: { it: '6 € a persona, a notte', en: '€6 per person, per night' } },
      { label: { it: 'Limite', en: 'Capped at' }, value: { it: '7 notti consecutive', en: '7 consecutive nights' } },
    ],
    intents: ['city-tax'],
    verify: { level: 'confirm',
      note: 'Importo e tetto delle 7 notti vengono dalle FAQ InYourLife (settembre 2026). È una tariffa comunale: va riconfermata prima della pubblicazione e ricontrollata a ogni delibera.' },
  },
];
