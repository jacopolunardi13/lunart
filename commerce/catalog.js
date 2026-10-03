/**
 * Everything LunArt sells, or will sell.
 *
 * Products with no commercial terms yet are present and complete apart from the
 * price. They render, they can be looked at, and they say plainly that they are not
 * on sale — which is more useful than hiding them, and avoids a second place where
 * someone has to remember a product exists.
 *
 * No photographs: LunArt has no product photography, and dressing a wine listing
 * with a picture of a bedroom would be worse than a clean typographic card. The
 * `images` field is there for when real shots exist.
 */

import { DELIVERY_SLOTS } from './schema.js';
import { curatedWines, leadTimeMinutesFor } from './wine.js';

/** The curated wine selection, as sellable variants. */
function wineVariants() {
  return curatedWines().map((bottle) => ({
    id: bottle.id,
    sku: `wine:${bottle.id}`,
    title: { it: bottle.name, en: bottle.name },
    meta: { kind: bottle.kind },
    /** Each bottle carries its own notice period; the catalogue does not assume one. */
    leadTimeMinutes: leadTimeMinutesFor(bottle),
  }));
}

export const PRODUCTS = [
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'privilege-card',
    category: 'card',
    sku: null,                       // priced per variant
    featured: true,
    status: 'to-configure',
    active: true,
    title: { it: 'LunArt Privilege Card', en: 'LunArt Privilege Card' },
    summary: {
      it: 'Vantaggi riservati nei ristoranti, bar e locali con cui lavoriamo, per te e per chi viaggia con te.',
      en: 'Reserved benefits at the restaurants, bars and venues we work with, for you and whoever travels with you.',
    },
    description: {
      it: 'La card è intestata a te e vale per due persone: tu e un accompagnatore. La mostri dal telefono, il locale la verifica in un secondo e il vantaggio è applicato.\n\nSceglie tu il giorno in cui inizia; la scadenza si calcola da sola. Non è trasferibile: il codice che mostri cambia in continuazione, quindi uno screenshot passato a qualcun altro non funziona.',
      en: 'The card is in your name and covers two people: you and one companion. You show it from your phone, the venue checks it in a second, and the benefit is applied.\n\nYou choose the day it starts; the expiry works itself out. It is not transferable: the code you show keeps changing, so a screenshot passed to someone else will not work.',
    },
    variants: [
      { id: '2d', sku: 'privilege-card:2d', title: { it: '2 giorni', en: '2 days' }, meta: { days: 2 } },
      { id: '5d', sku: 'privilege-card:5d', title: { it: '5 giorni', en: '5 days' }, meta: { days: 5 } },
      { id: '8d', sku: 'privilege-card:8d', title: { it: '8 giorni', en: '8 days' }, meta: { days: 8 } },
    ],
    quantity: { min: 1, max: 2, step: 1 },
    maxGuests: 2,
    requiresDate: true,
    dateLabel: { it: 'Primo giorno di validità', en: 'First day of validity' },
    requiresTime: false,
    requiresRoom: false,
    requiresFields: [
      { id: 'holderName', type: 'text', required: true,
        label: { it: 'Intestata a', en: 'In the name of' },
        hint: { it: 'Il nome che compare sulla card', en: 'The name shown on the card' } },
    ],
    availabilityMode: 'always',
    purchaseMode: 'instant',
    fulfillmentType: 'digital-entitlement',
    partner: null,
    terms: {
      it: 'Valida per un massimo di 2 persone: il titolare e un accompagnatore. Non trasferibile. La validità decorre dal giorno scelto e termina alla fine dell’ultimo giorno. I vantaggi dipendono dal singolo locale.',
      en: 'Valid for a maximum of 2 people: the holder and one companion. Not transferable. Validity runs from the day you choose to the end of the last day. Benefits depend on each venue.',
    },
    images: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'light-breakfast',
    category: 'breakfast',
    sku: 'light-breakfast',
    featured: false,
    status: 'to-configure',
    active: true,
    title: { it: 'Light Breakfast in camera', en: 'Light Breakfast in your room' },
    summary: {
      it: 'La colazione portata in camera, per due persone. Da ordinare entro la sera prima.',
      en: 'Breakfast brought to your room, for two. Ordered by the evening before.',
    },
    description: {
      it: 'Special Bowl dell’Opera Caffè — yogurt alla frutta, cereali e miele — con pane tostato, burro e marmellata. Per due persone.\n\nScegli la bevanda calda e, se vuoi, il succo. Arriva nella fascia che indichi.',
      en: 'Opera Caffè’s Special Bowl — fruit yoghurt, cereals and honey — with toast, butter and jam. For two.\n\nChoose the hot drink and, if you like, a juice. It arrives in the window you pick.',
    },
    includes: {
      it: ['Special Bowl Opera Caffè', 'Yogurt alla frutta', 'Cereali', 'Miele', 'Pane tostato', 'Burro', 'Marmellata'],
      en: ['Opera Caffè Special Bowl', 'Fruit yoghurt', 'Cereals', 'Honey', 'Toast', 'Butter', 'Jam'],
    },
    variants: [],
    options: [
      { id: 'hotDrink', required: true,
        label: { it: 'Bevanda calda', en: 'Hot drink' },
        choices: [
          { id: 'espresso',   label: { it: 'Espresso', en: 'Espresso' } },
          { id: 'cappuccino', label: { it: 'Cappuccino', en: 'Cappuccino' } },
          { id: 'americano',  label: { it: 'Caffè americano', en: 'Americano' } },
          { id: 'tea',        label: { it: 'Tè caldo', en: 'Hot tea' } },
        ] },
      { id: 'juice', required: false,
        label: { it: 'Succo', en: 'Juice' },
        choices: [
          { id: 'none',   label: { it: 'Nessuno', en: 'None' } },
          { id: 'orange', label: { it: 'Arancia', en: 'Orange' } },
          { id: 'apple',  label: { it: 'Mela', en: 'Apple' } },
        ] },
    ],
    quantity: { min: 1, max: 2, step: 1 },
    maxGuests: 2,
    requiresDate: true,
    dateLabel: { it: 'Giorno della colazione', en: 'Day of breakfast' },
    requiresTime: true,
    requiresRoom: true,
    deliverySlots: DELIVERY_SLOTS.breakfast,
    cutoff: { kind: 'eveningBefore', hour: 21 },
    availabilityMode: 'cutoff',
    purchaseMode: 'instant',
    fulfillmentType: 'in-room',
    partner: 'opera-caffe',
    terms: {
      it: 'Per 2 persone. L’ordine va fatto entro le 21:00 del giorno precedente. La fascia di consegna è indicativa.',
      en: 'For 2 people. Orders close at 9:00 PM the day before. The delivery window is approximate.',
    },
    images: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'brunch',
    category: 'breakfast',
    sku: null,
    featured: true,
    status: 'active',
    active: true,
    title: { it: 'Brunch in camera', en: 'Brunch in your room' },
    summary: {
      it: 'Il brunch dell’Opera Caffè servito in camera, per due persone. Da ordinare entro la sera prima.',
      en: 'Opera Caffè’s brunch served in your room, for two. Ordered by the evening before.',
    },
    description: {
      it: 'Due versioni, entrambe per due persone, entrambe con succo e la bevanda calda che scegli.',
      en: 'Two versions, both for two people, both with juice and the hot drink you choose.',
    },
    variants: [
      { id: 'opera', sku: 'brunch:opera',
        title: { it: 'Brunch dell’Opera', en: 'Opera Brunch' },
        includes: {
          it: ['Pancakes', 'Omelette strapazzata', 'Bacon', 'Formaggio fresco', 'Salsiccine', 'Patate', 'Succo'],
          en: ['Pancakes', 'Scrambled omelette', 'Bacon', 'Fresh cheese', 'Sausages', 'Potatoes', 'Juice'],
        } },
      { id: 'mare', sku: 'brunch:mare',
        title: { it: 'Brunch di mare', en: 'Seafood Brunch' },
        includes: {
          it: ['Pancakes', 'Omelette strapazzata', 'Formaggio fresco', 'Salmone', 'Verdure', 'Patate', 'Succo'],
          en: ['Pancakes', 'Scrambled omelette', 'Fresh cheese', 'Salmon', 'Vegetables', 'Potatoes', 'Juice'],
        } },
    ],
    options: [
      { id: 'hotDrink', required: true,
        label: { it: 'Bevanda calda', en: 'Hot drink' },
        choices: [
          { id: 'espresso',   label: { it: 'Espresso', en: 'Espresso' } },
          { id: 'cappuccino', label: { it: 'Cappuccino', en: 'Cappuccino' } },
          { id: 'americano',  label: { it: 'Caffè americano', en: 'Americano' } },
          { id: 'tea',        label: { it: 'Tè caldo', en: 'Hot tea' } },
        ] },
    ],
    quantity: { min: 1, max: 2, step: 1 },
    maxGuests: 2,
    requiresDate: true,
    dateLabel: { it: 'Giorno del brunch', en: 'Day of brunch' },
    requiresTime: true,
    requiresRoom: true,
    deliverySlots: DELIVERY_SLOTS.breakfast,
    cutoff: { kind: 'eveningBefore', hour: 21 },
    availabilityMode: 'cutoff',
    purchaseMode: 'instant',
    fulfillmentType: 'in-room',
    partner: 'opera-caffe',
    terms: {
      it: 'Ogni brunch è per 2 persone. L’ordine va fatto entro le 21:00 del giorno precedente. La fascia di consegna è indicativa.',
      en: 'Each brunch is for 2 people. Orders close at 9:00 PM the day before. The delivery window is approximate.',
    },
    images: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'wine-in-room',
    category: 'wine',
    sku: null,
    featured: true,
    status: 'active',
    active: true,
    title: { it: 'Wine in your room', en: 'Wine in your room' },
    summary: {
      it: 'Una bottiglia che ti aspetta in camera. Solo bottiglie intere, scelte dalla nostra selezione.',
      en: 'A bottle waiting in your room. Full bottles only, from our selection.',
    },
    description: {
      it: 'Scegli la bottiglia, il giorno e la fascia oraria. Le etichette più importanti le teniamo vicine e bastano novanta minuti; per le altre serve un po’ più di preavviso, perché arrivano con la consegna del giorno.',
      en: 'Pick the bottle, the day and the window. We keep the important labels close by and ninety minutes is enough; the rest need more notice, because they come with the day’s delivery.',
    },
    variants: wineVariants(),
    quantity: { min: 1, max: 4, step: 1 },
    requiresDate: true,
    dateLabel: { it: 'Giorno di consegna', en: 'Delivery day' },
    requiresTime: true,
    requiresRoom: true,
    deliverySlots: DELIVERY_SLOTS.wine,
    cutoff: { kind: 'leadMinutes' },   // the minutes come from the chosen bottle
    availabilityMode: 'cutoff',
    purchaseMode: 'instant',
    fulfillmentType: 'in-room',
    partner: 'opera-caffe',
    terms: {
      it: 'Solo bottiglie intere. Il preavviso necessario dipende dalla bottiglia ed è indicato al momento della scelta. La fascia di consegna è indicativa.',
      en: 'Full bottles only. The notice needed depends on the bottle and is shown when you choose it. The delivery window is approximate.',
    },
    images: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'transfer-airport',
    category: 'transfer',
    sku: 'transfer-airport',
    featured: true,
    status: 'active',
    active: true,
    title: { it: 'Transfer privato — Black Car', en: 'Private transfer — Black Car' },
    summary: {
      it: 'Auto privata con conducente da e per l’aeroporto di Firenze. Soggetto a conferma dell’autista.',
      en: 'A private car with a driver to and from Florence airport. Subject to the driver’s confirmation.',
    },
    description: {
      it: 'Non è un taxi: è un’auto riservata a te, con il conducente che ti aspetta e ti accompagna porta a porta.\n\nIl servizio dipende dalla disponibilità dell’autista, quindi non lo diamo per scontato. Alla prenotazione l’importo viene autorizzato sulla tua carta ma non addebitato; diventa un addebito vero solo quando l’autista conferma. Se non è disponibile, l’autorizzazione viene annullata e non paghi nulla.',
      en: 'This is not a taxi: it is a car reserved for you, with a driver waiting and taking you door to door.\n\nIt depends on the driver being free, so we do not take it for granted. When you book, the amount is authorised on your card but not charged; it becomes a real charge only once the driver confirms. If nobody is available, the authorisation is released and you pay nothing.',
    },
    variants: [
      { id: 'from-airport', sku: 'transfer-airport',
        title: { it: 'Aeroporto di Firenze → LunArt', en: 'Florence airport → LunArt' } },
      { id: 'to-airport', sku: 'transfer-airport',
        title: { it: 'LunArt → Aeroporto di Firenze', en: 'LunArt → Florence airport' } },
    ],
    quantity: { min: 1, max: 3, step: 1,
      label: { it: 'Numero di auto', en: 'Number of cars' } },
    requiresDate: true,
    dateLabel: { it: 'Giorno', en: 'Day' },
    requiresTime: true,
    timeLabel: { it: 'Ora', en: 'Time' },
    requiresRoom: false,
    requiresFields: [
      { id: 'passengerName', type: 'text', required: true,
        label: { it: 'Nome del passeggero', en: 'Passenger name' } },
      { id: 'passengers', type: 'number', required: true, min: 1, max: 6,
        label: { it: 'Passeggeri', en: 'Passengers' } },
      { id: 'luggage', type: 'number', required: true, min: 0, max: 10,
        label: { it: 'Bagagli', en: 'Bags' } },
      { id: 'flightNumber', type: 'text', required: false,
        label: { it: 'Numero del volo', en: 'Flight number' },
        hint: { it: 'Se lo sai: il conducente controlla i ritardi', en: 'If you know it: the driver tracks delays' } },
      { id: 'phone', type: 'tel', required: true,
        label: { it: 'Telefono', en: 'Phone' },
        hint: { it: 'Per trovarsi all’arrivo', en: 'So you can find each other' } },
      { id: 'notes', type: 'textarea', required: false,
        label: { it: 'Note', en: 'Notes' },
        hint: { it: 'Seggiolino, bagagli ingombranti, altro', en: 'Child seat, oversized luggage, anything else' } },
    ],
    availabilityMode: 'manual-confirm',
    purchaseMode: 'authorize-then-capture',
    fulfillmentType: 'provider',
    partner: 'ncc',
    /** Shown before checkout, not buried in the terms. */
    notice: {
      it: 'Il transfer è soggetto a conferma di disponibilità. L’importo viene autorizzato al momento della prenotazione e addebitato definitivamente solo dopo la conferma dell’autista.',
      en: 'The transfer is subject to availability. The amount is authorised when you book and charged only once the driver confirms.',
    },
    terms: {
      it: 'Prezzo per auto, a tratta. L’autorizzazione sulla carta non è un addebito: diventa tale solo alla conferma dell’autista. Se il servizio non è disponibile l’autorizzazione viene annullata.',
      en: 'Price per car, per journey. The authorisation is not a charge: it becomes one only when the driver confirms. If the service is unavailable the authorisation is released.',
    },
    images: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'hair-service',
    category: 'hair',
    sku: null,
    featured: true,
    status: 'active',
    active: true,
    title: { it: 'Private Hair Service', en: 'Private Hair Service' },
    summary: {
      it: 'Taglio, barba o piega nella tua camera, da un professionista che viene da te.',
      en: 'A cut, a beard or a blow-dry in your own room, from a professional who comes to you.',
    },
    description: {
      it: 'Niente salone, niente appuntamento da incastrare fra un museo e l’altro: il professionista arriva in camera con tutto il necessario e lavora lì.\n\nScegli il servizio, il giorno e l’ora fra quelli disponibili. Sono gli orari reali del professionista: se un giorno non compare, quel giorno non c’è.',
      en: 'No salon, no appointment to squeeze between two museums: the professional comes to your room with everything needed and works there.\n\nChoose the service, the day and the time from what is free. These are the professional’s real hours: if a day is not there, it is not available.',
    },
    variants: [
      { id: 'men-cut',        sku: 'hair-service:men-cut',
        title: { it: 'Uomo — taglio', en: 'Men’s haircut' }, meta: { who: 'men', minutes: 45 } },
      { id: 'men-beard',      sku: 'hair-service:men-beard',
        title: { it: 'Uomo — barba', en: 'Beard' }, meta: { who: 'men', minutes: 30 } },
      { id: 'men-cut-beard',  sku: 'hair-service:men-cut-beard',
        title: { it: 'Uomo — taglio e barba', en: 'Men’s haircut and beard' }, meta: { who: 'men', minutes: 75 } },
      { id: 'women-blowdry',  sku: 'hair-service:women-blowdry',
        title: { it: 'Donna — piega', en: 'Women’s blow-dry' }, meta: { who: 'women', minutes: 45 } },
      { id: 'women-cut-blow', sku: 'hair-service:women-cut-blow',
        title: { it: 'Donna — taglio e piega', en: 'Women’s haircut and blow-dry' }, meta: { who: 'women', minutes: 90 } },
      { id: 'women-evening',  sku: 'hair-service:women-evening',
        title: { it: 'Donna — acconciatura da sera', en: 'Women’s evening styling' }, meta: { who: 'women', minutes: 60 } },
      /**
       * Built, priced nowhere, and not sellable until the provider confirms both
       * that they offer it and what it costs. Colour and highlights are not
       * offered at all for now and are deliberately absent from this list.
       */
      { id: 'ceremony',       sku: 'hair-service:ceremony',
        title: { it: 'Donna — acconciatura da cerimonia', en: 'Women’s ceremony styling' },
        meta: { who: 'women', minutes: 90 }, pending: true },
    ],
    quantity: { min: 1, max: 1, step: 1 },
    requiresDate: true,
    dateLabel: { it: 'Giorno', en: 'Day' },
    requiresTime: true,
    timeLabel: { it: 'Ora', en: 'Time' },
    requiresRoom: true,
    requiresFields: [
      { id: 'guestName', type: 'text', required: true,
        label: { it: 'Per chi è il servizio', en: 'Who the service is for' } },
      { id: 'phone', type: 'tel', required: true,
        label: { it: 'Telefono', en: 'Phone' },
        hint: { it: 'Il professionista ti avvisa quando sale', en: 'The professional messages you on the way up' } },
      { id: 'notes', type: 'textarea', required: false,
        label: { it: 'Note', en: 'Notes' },
        hint: { it: 'Lunghezza, piega, allergie, qualsiasi cosa serva sapere', en: 'Length, styling, allergies, anything worth knowing' } },
    ],
    availabilityMode: 'timeslots',
    purchaseMode: 'instant',
    fulfillmentType: 'provider',
    partner: 'hair-professional',
    terms: {
      it: 'Il servizio si svolge nella tua camera all’orario scelto. Gli orari mostrati sono quelli realmente liberi. Colore e colpi di sole non sono al momento disponibili.',
      en: 'The service takes place in your room at the time you choose. The times shown are the ones actually free. Colour and highlights are not available at the moment.',
    },
    images: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'celebration-setup',
    category: 'celebration',
    sku: 'celebration-setup',
    featured: false,
    status: 'to-configure',
    active: true,
    title: { it: 'Occasione speciale in camera', en: 'A special occasion in your room' },
    summary: {
      it: 'Compleanno, anniversario, una proposta. Prepariamo la camera prima che rientriate.',
      en: 'A birthday, an anniversary, a proposal. We set the room up before you come back.',
    },
    description: {
      it: 'Si compone: una bottiglia, dei fiori, qualcosa di dolce, l’allestimento della camera, un biglietto scritto a mano. Dicci l’occasione e il giorno, e lo mettiamo insieme.\n\nLe combinazioni e i prezzi non sono ancora definiti: per ora si organizza parlando con noi.',
      en: 'It is put together: a bottle, flowers, something sweet, the room set up, a handwritten note. Tell us the occasion and the day and we will assemble it.\n\nThe combinations and prices are not settled yet: for now it is arranged by talking to us.',
    },
    variants: [],
    options: [
      { id: 'bottle', required: false, label: { it: 'Bottiglia', en: 'Bottle' },
        choices: [
          { id: 'none', label: { it: 'Nessuna', en: 'None' } },
          { id: 'prosecco', label: { it: 'Prosecco', en: 'Prosecco' } },
          { id: 'champagne', label: { it: 'Champagne', en: 'Champagne' } },
          { id: 'wine', label: { it: 'Vino dalla selezione', en: 'Wine from the selection' } },
        ] },
      { id: 'flowers', required: false, label: { it: 'Fiori', en: 'Flowers' },
        choices: [
          { id: 'none', label: { it: 'Nessuno', en: 'None' } },
          { id: 'bouquet', label: { it: 'Bouquet', en: 'Bouquet' } },
          { id: 'petals', label: { it: 'Petali in camera', en: 'Petals in the room' } },
        ] },
      { id: 'sweets', required: false, label: { it: 'Dolce', en: 'Something sweet' },
        choices: [
          { id: 'none', label: { it: 'Nessuno', en: 'None' } },
          { id: 'cake', label: { it: 'Torta', en: 'Cake' } },
          { id: 'pastries', label: { it: 'Pasticcini', en: 'Pastries' } },
        ] },
      { id: 'note', required: false, label: { it: 'Biglietto', en: 'Note' },
        choices: [
          { id: 'none', label: { it: 'Nessuno', en: 'None' } },
          { id: 'handwritten', label: { it: 'Scritto a mano', en: 'Handwritten' } },
        ] },
    ],
    quantity: { min: 1, max: 1, step: 1 },
    requiresDate: true,
    dateLabel: { it: 'Giorno', en: 'Day' },
    requiresTime: false,
    requiresRoom: true,
    requiresFields: [
      { id: 'occasion', type: 'text', required: false,
        label: { it: 'L’occasione', en: 'The occasion' } },
      { id: 'message', type: 'textarea', required: false,
        label: { it: 'Cosa scrivere sul biglietto', en: 'What the note should say' } },
    ],
    availabilityMode: 'request',
    purchaseMode: 'request-only',
    fulfillmentType: 'staff',
    partner: null,
    terms: {
      it: 'Composizione e prezzi da definire. La richiesta non è un acquisto: ti ricontattiamo per confermare cosa è possibile e quanto costa.',
      en: 'Contents and prices still to be settled. The request is not a purchase: we come back to you with what is possible and what it costs.',
    },
    images: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'chianti-experience',
    category: 'experience',
    sku: 'chianti-experience',
    featured: false,
    status: 'coming-soon',
    active: true,
    title: { it: 'Una giornata nel Chianti', en: 'A day in Chianti' },
    summary: {
      it: 'Auto privata da LunArt, una o due cantine, degustazione. In preparazione.',
      en: 'A private car from LunArt, one or two wineries, a tasting. In preparation.',
    },
    description: {
      it: 'Partenza da LunArt con autista privato, visita a una o due cantine con degustazione, eventualmente pranzo, e rientro. Mezza giornata o giornata intera.\n\nStiamo definendo le cantine e l’organizzazione: non è ancora acquistabile. Se ti interessa dillo al Concierge e ti avvisiamo quando apre.',
      en: 'Leaving from LunArt with a private driver, visiting one or two wineries with a tasting, lunch if you want it, and back. Half a day or a full one.\n\nWe are still settling the wineries and the arrangements: it is not on sale yet. Tell the Concierge if you are interested and we will let you know when it opens.',
    },
    variants: [],
    quantity: { min: 1, max: 6, step: 1, label: { it: 'Persone', en: 'People' } },
    maxGuests: 6,
    requiresDate: true,
    requiresTime: false,
    requiresRoom: false,
    availabilityMode: 'external',
    purchaseMode: 'request-only',
    fulfillmentType: 'provider',
    partner: null,
    terms: {
      it: 'Non ancora acquistabile. Durata, cantine, pranzo e prezzo saranno definiti prima dell’apertura.',
      en: 'Not on sale yet. Duration, wineries, lunch and price will be settled before it opens.',
    },
    images: [],
  },
];

/**
 * Modelled but not published. They exist so the shape is agreed now rather than
 * invented one at a time later; flip `active` when there is something to sell.
 */
export const PLANNED_PRODUCTS = [
  { id: 'walking-tour',    category: 'experience', title: { it: 'Firenze a piedi', en: 'Florence on foot' },
    fulfillmentType: 'provider', availabilityMode: 'timeslots', purchaseMode: 'instant' },
  { id: 'private-guide',   category: 'experience', title: { it: 'Guida privata', en: 'Private guide' },
    fulfillmentType: 'provider', availabilityMode: 'manual-confirm', purchaseMode: 'authorize-then-capture' },
  { id: 'museum-tickets',  category: 'experience', title: { it: 'Uffizi e Accademia', en: 'Uffizi and Accademia' },
    fulfillmentType: 'partner', availabilityMode: 'external', purchaseMode: 'external-checkout' },
  { id: 'cooking-class',   category: 'experience', title: { it: 'Corso di cucina', en: 'Cooking class' },
    fulfillmentType: 'provider', availabilityMode: 'timeslots', purchaseMode: 'instant' },
  { id: 'spa-massage',     category: 'experience', title: { it: 'SPA e massaggi', en: 'Spa and massage' },
    fulfillmentType: 'partner', availabilityMode: 'manual-confirm', purchaseMode: 'authorize-then-capture' },
  { id: 'photo-session',   category: 'experience', title: { it: 'Servizio fotografico', en: 'Photo session' },
    fulfillmentType: 'provider', availabilityMode: 'manual-confirm', purchaseMode: 'authorize-then-capture' },
  { id: 'luggage-transfer',category: 'transfer',   title: { it: 'Trasferimento bagagli', en: 'Luggage transfer' },
    fulfillmentType: 'provider', availabilityMode: 'manual-confirm', purchaseMode: 'authorize-then-capture' },
  { id: 'nightlife-table', category: 'experience', title: { it: 'Tavolo e guest list', en: 'Table and guest list' },
    fulfillmentType: 'partner', availabilityMode: 'request', purchaseMode: 'request-only' },
];
