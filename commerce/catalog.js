/**
 * Everything LunArt sells, or will sell.
 *
 * Products with no commercial terms yet are present and complete apart from the
 * price. They render, they can be looked at, and they say plainly that they are not
 * on sale — which is more useful than hiding them, and avoids a second place where
 * someone has to remember a product exists. A product marked `comingSoon` goes one
 * step further: it is a grey tile with a word on it, no sheet, no price and no copy
 * invented to fill the space.
 *
 * No photographs: LunArt has no product photography, and dressing a wine listing
 * with a picture of a bedroom would be worse than a clean typographic card. The
 * `images` field is there for when real shots exist.
 */

import { DELIVERY_SLOTS } from './schema.js';
import { curatedWines, leadTimeMinutesFor } from './wine.js';
import { CELEBRATION_UPGRADES } from './prices.js';

/** The curated wine selection, as sellable variants. */
function wineVariants() {
  return curatedWines().map((bottle) => ({
    id: bottle.id,
    sku: `wine:${bottle.id}`,
    title: { it: bottle.name, en: bottle.name },
    meta: { kind: bottle.kind },
    /**
     * Normally null: how much notice wine needs comes from what the whole order is
     * worth, not from the bottle. A bottle sets this only when there is a physical
     * reason — something kept off site — and then it wins.
     */
    leadTimeMinutes: leadTimeMinutesFor(bottle),
  }));
}

/** The bottles a celebration tier may include, as option choices. */
const bottleChoices = (ids) => ids.map((id) => {
  const bottle = curatedWines().find((w) => w.id === id);
  return { id, label: { it: bottle?.name ?? id, en: bottle?.name ?? id } };
});

export const PRODUCTS = [
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'privilege-card',
    category: 'card',
    sku: null,                       // priced per variant
    featured: true,
    status: 'active',
    active: true,
    title: { it: 'LunArt Privilege Card', en: 'LunArt Privilege Card' },
    summary: {
      it: 'Vantaggi riservati nei locali con cui abbiamo un accordo, per te e per chi viaggia con te.',
      en: 'Reserved benefits at the venues we have an agreement with, for you and whoever travels with you.',
    },
    description: {
      it: 'La card è intestata a te e vale per due persone: tu e un accompagnatore. La mostri dal telefono, il locale la verifica in un secondo e il vantaggio è applicato.\n\nScegli il giorno in cui inizia, dentro le date del tuo soggiorno: il giorno della partenza vale per intero. Non è trasferibile.',
      en: 'The card is in your name and covers two people: you and one companion. You show it from your phone, the venue checks it in a second, and the benefit is applied.\n\nYou choose the day it starts, within the dates of your stay: the day you leave counts in full. It is not transferable.',
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
    /** Validity cannot run past the stay it was bought for. See `stay.js`. */
    withinStay: true,
    /**
     * The card is worth exactly what its partners give. Until at least one venue
     * has a benefit reserved for the card, it is not sold — what comes free with a
     * LunArt stay is a separate thing and is listed separately.
     */
    requiresPartners: true,
    availabilityMode: 'always',
    purchaseMode: 'instant',
    fulfillmentType: 'digital-entitlement',
    partner: null,
    cancellation: { kind: 'none' },
    terms: {
      it: 'Valida per un massimo di 2 persone: il titolare e un accompagnatore. Non trasferibile. La validità decorre dal giorno scelto e termina alla fine dell’ultimo giorno, e resta dentro le date del soggiorno. I vantaggi dipendono dal singolo locale. Dopo l’acquisto non è rimborsabile.',
      en: 'Valid for a maximum of 2 people: the holder and one companion. Not transferable. Validity runs from the day you choose to the end of the last day, and stays within the dates of your stay. Benefits depend on each venue. Not refundable once bought.',
    },
    images: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'light-breakfast',
    category: 'breakfast',
    sku: 'light-breakfast',
    featured: false,
    status: 'active',
    active: true,
    title: { it: 'Light Breakfast in camera', en: 'Light Breakfast in your room' },
    summary: {
      it: 'Due Special Bowl e un succo, portati in camera. Per due persone, da ordinare entro mezzogiorno del giorno prima.',
      en: 'Two Special Bowls and a juice, brought to your room. For two people, ordered by noon the day before.',
    },
    description: {
      it: 'Due Special Bowl dell’Opera Caffè — yogurt alla frutta, cereali e miele — e un succo in bottiglia sigillata.\n\nNon portiamo bevande calde: in camera hai la macchina Nespresso, il bollitore e tè e caffè. Arriva nella fascia che indichi.',
      en: 'Two Opera Caffè Special Bowls — fruit yoghurt, cereals and honey — and a sealed bottle of juice.\n\nWe bring no hot drinks: the room has a Nespresso machine, a kettle, and tea and coffee. It arrives in the window you pick.',
    },
    includes: {
      it: ['2 Special Bowl Opera Caffè', 'Yogurt alla frutta', 'Cereali', 'Miele', 'Succo in bottiglia sigillata'],
      en: ['2 Opera Caffè Special Bowls', 'Fruit yoghurt', 'Cereals', 'Honey', 'Sealed bottled juice'],
    },
    variants: [],
    quantity: { min: 1, max: 2, step: 1 },
    maxGuests: 2,
    requiresDate: true,
    dateLabel: { it: 'Giorno della colazione', en: 'Day of breakfast' },
    requiresTime: true,
    requiresRoom: true,
    deliverySlots: DELIVERY_SLOTS.breakfast,
    cutoff: { kind: 'dayBefore', hour: 12 },
    requiresFields: [
      { id: 'dietary', type: 'textarea', required: false,
        label: { it: 'Esigenze alimentari', en: 'Dietary needs' },
        hint: { it: 'Vegano, vegetariano, senza glutine, intolleranze: scrivilo qui e ricordalo al personale',
                en: 'Vegan, vegetarian, gluten free, intolerances: write it here and remind the staff' } },
    ],
    availabilityMode: 'cutoff',
    purchaseMode: 'instant',
    fulfillmentType: 'in-room',
    partner: 'opera-caffe',
    cancellation: { kind: 'dayBefore', hour: 20 },
    terms: {
      it: 'Prezzo per 2 persone. L’ordine va fatto entro le 12:00 del giorno precedente, e si può annullare entro le 20:00 del giorno precedente. Esigenze alimentari da comunicare il giorno prima e da riconfermare al personale. La fascia di consegna è indicativa.',
      en: 'Price for 2 people. Orders close at 12:00 noon the day before and can be cancelled until 8:00 PM the day before. Dietary needs must be given the day before and reconfirmed with the staff. The delivery window is approximate.',
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
      it: 'Il brunch dell’Opera Caffè servito in camera, per due persone. Da ordinare entro mezzogiorno del giorno prima.',
      en: 'Opera Caffè’s brunch served in your room, for two people. Ordered by noon the day before.',
    },
    description: {
      it: 'Due versioni, entrambe per due persone, entrambe con il succo e la bevanda calda previsti dal menù dell’Opera.',
      en: 'Two versions, both for two people, both with the juice and hot drink the Opera menu includes.',
    },
    variants: [
      { id: 'opera', sku: 'brunch:opera',
        title: { it: 'Brunch dell’Opera', en: 'Opera Brunch' },
        includes: {
          it: ['Pancakes', 'Omelette strapazzata', 'Bacon', 'Formaggio fresco', 'Salsiccine', 'Patate', 'Succo', 'Bevanda calda'],
          en: ['Pancakes', 'Scrambled omelette', 'Bacon', 'Fresh cheese', 'Sausages', 'Potatoes', 'Juice', 'Hot drink'],
        } },
      { id: 'mare', sku: 'brunch:mare',
        title: { it: 'Brunch di mare', en: 'Seafood Brunch' },
        includes: {
          it: ['Pancakes', 'Omelette strapazzata', 'Formaggio fresco', 'Salmone', 'Verdure', 'Patate', 'Succo', 'Bevanda calda'],
          en: ['Pancakes', 'Scrambled omelette', 'Fresh cheese', 'Salmon', 'Vegetables', 'Potatoes', 'Juice', 'Hot drink'],
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
    cutoff: { kind: 'dayBefore', hour: 12 },
    requiresFields: [
      { id: 'dietary', type: 'textarea', required: false,
        label: { it: 'Esigenze alimentari', en: 'Dietary needs' },
        hint: { it: 'Vegano, vegetariano, senza glutine, intolleranze: scrivilo qui e ricordalo al personale',
                en: 'Vegan, vegetarian, gluten free, intolerances: write it here and remind the staff' } },
    ],
    availabilityMode: 'cutoff',
    purchaseMode: 'instant',
    fulfillmentType: 'in-room',
    partner: 'opera-caffe',
    cancellation: { kind: 'dayBefore', hour: 20 },
    terms: {
      it: 'Ogni brunch è per 2 persone. L’ordine va fatto entro le 12:00 del giorno precedente, e si può annullare entro le 20:00 del giorno precedente. Esigenze alimentari da comunicare il giorno prima e da riconfermare al personale. La fascia di consegna è indicativa.',
      en: 'Each brunch is for 2 people. Orders close at 12:00 noon the day before and can be cancelled until 8:00 PM the day before. Dietary needs must be given the day before and reconfirmed with the staff. The delivery window is approximate.',
    },
    images: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'sunrise-breakfast',
    category: 'breakfast',
    sku: 'sunrise-breakfast',
    featured: false,
    status: 'to-configure',
    active: true,
    title: { it: 'Colazione all’alba, da portare via', en: 'Sunrise breakfast, to take away' },
    summary: {
      it: 'Per chi parte prima che la colazione apra. Da chiedere entro mezzogiorno del giorno prima.',
      en: 'For a departure before breakfast opens. Asked for by noon the day before.',
    },
    description: {
      it: 'Se parti prima dell’orario della colazione, la prepariamo da portare via.\n\nComposizione e prezzo non sono ancora definiti: per ora si organizza scrivendoci, entro mezzogiorno del giorno prima.',
      en: 'If you leave before breakfast opens, we put one together for you to take with you.\n\nWhat is in it and what it costs are not settled yet: for now it is arranged by messaging us, by noon the day before.',
    },
    variants: [],
    quantity: { min: 1, max: 2, step: 1 },
    maxGuests: 2,
    requiresDate: true,
    dateLabel: { it: 'Giorno della partenza', en: 'Day you leave' },
    requiresTime: false,
    requiresRoom: true,
    cutoff: { kind: 'dayBefore', hour: 12 },
    availabilityMode: 'cutoff',
    purchaseMode: 'request-only',
    fulfillmentType: 'in-room',
    partner: 'opera-caffe',
    cancellation: { kind: 'dayBefore', hour: 20 },
    terms: {
      it: 'Composizione e prezzo da definire. La richiesta non è un acquisto: ti rispondiamo noi.',
      en: 'Contents and price still to be settled. The request is not a purchase: we answer you ourselves.',
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
    title: { it: 'Vino in camera', en: 'Wine in your room' },
    summary: {
      it: 'Una bottiglia che ti aspetta in camera, consegnata fra le 11:00 e le 22:00.',
      en: 'A bottle waiting in your room, delivered between 11:00 and 22:00.',
    },
    description: {
      it: 'Scegli la bottiglia, il giorno e la fascia oraria. Solo bottiglie intere, dalla nostra selezione.\n\nDa 90 € di ordine la consegna è Express e bastano 90 minuti di preavviso: l’ultimo ordine per la stessa sera è alle 20:30. Sotto i 90 € serve mezza giornata, perché la bottiglia arriva con la consegna successiva.',
      en: 'Pick the bottle, the day and the window. Full bottles only, from our selection.\n\nFrom €90 the delivery is Express and ninety minutes’ notice is enough: the last order for the same evening is 8:30 PM. Below €90 it needs half a day, because the bottle comes with the next delivery.',
    },
    variants: wineVariants(),
    quantity: { min: 1, max: 4, step: 1 },
    requiresDate: true,
    dateLabel: { it: 'Giorno di consegna', en: 'Delivery day' },
    requiresTime: true,
    requiresRoom: true,
    deliverySlots: DELIVERY_SLOTS.wine,
    /** The minutes come from what the whole wine order is worth. See `ordering.js`. */
    cutoff: { kind: 'leadMinutes' },
    availabilityMode: 'cutoff',
    purchaseMode: 'instant',
    fulfillmentType: 'in-room',
    partner: 'opera-caffe',
    cancellation: { kind: 'hoursBefore', hours: 3 },
    terms: {
      it: 'Solo bottiglie intere. Consegna fra le 11:00 e le 22:00. Preavviso: 90 minuti per ordini da 90 € in su, 12 ore sotto i 90 €. Si può annullare fino a 3 ore prima della fascia scelta. La fascia di consegna è indicativa.',
      en: 'Full bottles only. Delivered between 11:00 and 22:00. Notice: ninety minutes for orders of €90 or more, twelve hours below €90. Cancellable until three hours before the window you chose. The delivery window is approximate.',
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
      it: 'Auto privata con conducente da e per l’aeroporto di Firenze, fino a 5 passeggeri. Soggetto a conferma.',
      en: 'A private car with a driver to and from Florence airport, up to 5 passengers. Subject to confirmation.',
    },
    description: {
      it: 'Non è un taxi: è un’auto riservata a te, con il conducente che ti aspetta e ti accompagna porta a porta. Black Car o Black Van secondo il gruppo e i bagagli.\n\nIl servizio dipende dalla disponibilità dell’autista, quindi non lo diamo per scontato. Alla prenotazione l’importo viene autorizzato sulla tua carta ma non addebitato; diventa un addebito vero solo quando l’autista conferma. Se non è disponibile, l’autorizzazione viene annullata e non paghi nulla.',
      en: 'This is not a taxi: it is a car reserved for you, with a driver waiting and taking you door to door. A Black Car or a Black Van, depending on the group and the luggage.\n\nIt depends on the driver being free, so we do not take it for granted. When you book, the amount is authorised on your card but not charged; it becomes a real charge only once the driver confirms. If nobody is available, the authorisation is released and you pay nothing.',
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
      { id: 'passengers', type: 'number', required: true, min: 1, max: 5,
        label: { it: 'Passeggeri', en: 'Passengers' },
        hint: { it: 'Massimo 5', en: 'Five at most' } },
      { id: 'largeSuitcases', type: 'number', required: true, min: 0, max: 8,
        label: { it: 'Valigie grandi', en: 'Large suitcases' } },
      { id: 'trolleys', type: 'number', required: true, min: 0, max: 8,
        label: { it: 'Trolley da cabina', en: 'Cabin trolleys' } },
      { id: 'personalBags', type: 'number', required: true, min: 0, max: 8,
        label: { it: 'Zaini e borse', en: 'Backpacks and personal bags' } },
      { id: 'oversizedItems', type: 'number', required: false, min: 0, max: 6,
        label: { it: 'Valigie extra o oggetti ingombranti', en: 'Extra or oversized items' },
        hint: { it: '15 € ciascuno, oltre il bagaglio incluso', en: '€15 each, beyond the included luggage' },
        surcharge: { sku: 'transfer-airport:oversized' } },
      { id: 'flightNumber', type: 'text', required: false,
        label: { it: 'Numero del volo', en: 'Flight number' },
        hint: { it: 'Se lo sai: il conducente controlla i ritardi', en: 'If you know it: the driver tracks delays' } },
      { id: 'phone', type: 'tel', required: true,
        label: { it: 'Telefono', en: 'Phone' },
        hint: { it: 'Per trovarsi all’arrivo', en: 'So you can find each other' } },
      { id: 'notes', type: 'textarea', required: false,
        label: { it: 'Note', en: 'Notes' },
        hint: { it: 'Seggiolino, bagagli particolari, altro', en: 'Child seat, unusual luggage, anything else' } },
    ],
    availabilityMode: 'manual-confirm',
    purchaseMode: 'authorize-then-capture',
    fulfillmentType: 'provider',
    partner: 'ncc',
    cancellation: { kind: 'hoursBefore', hours: 3 },
    /** Shown before checkout, not buried in the terms. */
    notice: {
      it: 'Il transfer è soggetto a conferma di disponibilità. L’importo viene autorizzato al momento della prenotazione e addebitato definitivamente solo dopo la conferma dell’autista.',
      en: 'The transfer is subject to availability. The amount is authorised when you book and charged only once the driver confirms.',
    },
    terms: {
      it: 'Prezzo per auto, a tratta, fino a 5 passeggeri. Bagaglio incluso: 2 valigie grandi, 2 trolley da cabina, 2 zaini o borse. Ogni valigia in più o oggetto ingombrante: 15 €. Un bagaglio a mano piccolo in più non si paga, se la capienza lo consente. Se il carico richiede un veicolo diverso lo confermiamo prima del servizio. L’autorizzazione sulla carta non è un addebito: diventa tale alla conferma dell’autista. Si può annullare fino a 3 ore prima.',
      en: 'Price per car, per journey, up to 5 passengers. Luggage included: 2 large suitcases, 2 cabin trolleys, 2 backpacks or personal bags. Each extra suitcase or oversized item: €15. One extra small hand bag is free where capacity allows. If the load needs a different vehicle we confirm that before the service. The authorisation is not a charge: it becomes one when the driver confirms. Cancellable until three hours before.',
    },
    images: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'luggage-transfer',
    category: 'transfer',
    sku: null,
    featured: false,
    status: 'active',
    active: true,
    title: { it: 'Trasferimento bagagli', en: 'Luggage transfer' },
    summary: {
      it: 'I bagagli portati dove ti servono, senza che li porti tu. Da prenotare entro mezzogiorno del giorno prima.',
      en: 'Your bags taken where you need them, without carrying them. Booked by noon the day before.',
    },
    description: {
      it: 'Li ritiriamo in camera e li consegniamo dove dici, o viceversa: stazione, un indirizzo in centro, l’aeroporto, un altro indirizzo nel Comune di Firenze.\n\nIl prezzo è a tratta e comprende il bagaglio standard. Il servizio dipende dalla disponibilità: l’importo viene autorizzato alla prenotazione e addebitato solo alla conferma.',
      en: 'We collect them from the room and deliver them where you say, or the other way round: the station, an address in the centre, the airport, another address within the Comune di Firenze.\n\nThe price is per journey and covers the standard luggage. The service depends on availability: the amount is authorised when you book and charged only on confirmation.',
    },
    variants: [
      { id: 'smn',     sku: 'luggage-transfer:smn',
        title: { it: 'LunArt ↔ Santa Maria Novella', en: 'LunArt ↔ Santa Maria Novella' } },
      { id: 'centro',  sku: 'luggage-transfer:centro',
        title: { it: 'LunArt ↔ indirizzo nel centro storico', en: 'LunArt ↔ an address in the historic centre' } },
      { id: 'airport', sku: 'luggage-transfer:airport',
        title: { it: 'LunArt ↔ aeroporto di Firenze', en: 'LunArt ↔ Florence airport' } },
      { id: 'comune',  sku: 'luggage-transfer:comune',
        title: { it: 'LunArt ↔ altro indirizzo nel Comune di Firenze', en: 'LunArt ↔ another address in the Comune di Firenze' } },
    ],
    quantity: { min: 1, max: 2, step: 1, label: { it: 'Numero di tratte', en: 'Number of journeys' } },
    requiresDate: true,
    dateLabel: { it: 'Giorno', en: 'Day' },
    requiresTime: true,
    timeLabel: { it: 'Ora', en: 'Time' },
    requiresRoom: true,
    requiresFields: [
      { id: 'contactName', type: 'text', required: true,
        label: { it: 'A nome di', en: 'In the name of' } },
      { id: 'address', type: 'text', required: true,
        label: { it: 'Indirizzo o punto di consegna', en: 'Address or drop-off point' } },
      { id: 'largeSuitcases', type: 'number', required: true, min: 0, max: 8,
        label: { it: 'Valigie grandi', en: 'Large suitcases' } },
      { id: 'trolleys', type: 'number', required: true, min: 0, max: 8,
        label: { it: 'Trolley da cabina', en: 'Cabin trolleys' } },
      { id: 'personalBags', type: 'number', required: true, min: 0, max: 8,
        label: { it: 'Zaini e borse', en: 'Backpacks and personal bags' } },
      { id: 'oversizedItems', type: 'number', required: false, min: 0, max: 6,
        label: { it: 'Valigie extra o oggetti ingombranti', en: 'Extra or oversized items' },
        hint: { it: '15 € ciascuno, soggetti a conferma', en: '€15 each, subject to confirmation' },
        surcharge: { sku: 'luggage-transfer:oversized' } },
      { id: 'phone', type: 'tel', required: true,
        label: { it: 'Telefono', en: 'Phone' } },
      { id: 'notes', type: 'textarea', required: false,
        label: { it: 'Note', en: 'Notes' } },
    ],
    cutoff: { kind: 'dayBefore', hour: 12 },
    availabilityMode: 'manual-confirm',
    purchaseMode: 'authorize-then-capture',
    fulfillmentType: 'provider',
    partner: 'ncc',
    cancellation: { kind: 'hoursBefore', hours: 3 },
    notice: {
      it: 'Il servizio è soggetto a conferma. L’importo viene autorizzato alla prenotazione e addebitato solo dopo la conferma.',
      en: 'The service is subject to confirmation. The amount is authorised when you book and charged only after confirmation.',
    },
    terms: {
      it: 'Prezzo a tratta. Bagaglio incluso: 2 valigie grandi, 2 trolley da cabina, 2 zaini o borse. Ogni valigia in più o oggetto ingombrante: 15 €. Un bagaglio a mano piccolo in più non si paga, se gestibile. Oggetti ingombranti o particolari sono soggetti a conferma. Prenotazione entro le 12:00 del giorno precedente; si può annullare fino a 3 ore prima.',
      en: 'Price per journey. Luggage included: 2 large suitcases, 2 cabin trolleys, 2 backpacks or personal bags. Each extra suitcase or oversized item: €15. One extra small hand bag is free where it can be managed. Oversized or unusual items are subject to confirmation. Booked by 12:00 noon the day before; cancellable until three hours before.',
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
      it: 'Niente salone, niente appuntamento da incastrare fra un museo e l’altro: il professionista arriva in camera con tutto il necessario e lavora lì.\n\nScegli il servizio, il giorno e l’ora fra quelli disponibili. Sono gli orari reali del professionista: se un giorno non compare, quel giorno non c’è.\n\nNon è previsto il lavaggio: vieni con i capelli già lavati, se il servizio lo richiede. Il professionista li inumidisce con il suo spray dove serve.',
      en: 'No salon, no appointment to squeeze between two museums: the professional comes to your room with everything needed and works there.\n\nChoose the service, the day and the time from what is free. These are the professional’s real hours: if a day is not there, it is not available.\n\nThere is no wash service: come with your hair already washed where the service needs it. The professional damps it down with his own spray as required.',
    },
    variants: [
      { id: 'men-cut',        sku: 'hair-service:men-cut',
        title: { it: 'Uomo — taglio', en: 'Men’s haircut' }, meta: { who: 'men' } },
      { id: 'men-beard',      sku: 'hair-service:men-beard',
        title: { it: 'Uomo — barba', en: 'Beard' }, meta: { who: 'men' } },
      { id: 'men-cut-beard',  sku: 'hair-service:men-cut-beard',
        title: { it: 'Uomo — taglio e barba', en: 'Men’s haircut and beard' }, meta: { who: 'men' } },
      { id: 'women-blowdry',  sku: 'hair-service:women-blowdry',
        title: { it: 'Donna — piega', en: 'Women’s blow-dry and styling' }, meta: { who: 'women' } },
      { id: 'women-cut-blow', sku: 'hair-service:women-cut-blow',
        title: { it: 'Donna — taglio e piega', en: 'Women’s haircut and blow-dry' }, meta: { who: 'women' } },
      { id: 'women-evening',  sku: 'hair-service:women-evening',
        title: { it: 'Donna — acconciatura da sera', en: 'Women’s evening styling' }, meta: { who: 'women' } },
      /**
       * Modelled, unpriced, and `hidden` until the provider confirms both that
       * they offer it and what it costs: it is filtered out of the published
       * catalogue, so a guest is never shown it. Colour and highlights are not
       * offered at all, which is why there is no variant for them either.
       */
      { id: 'ceremony',       sku: 'hair-service:ceremony',
        title: { it: 'Donna — acconciatura da cerimonia', en: 'Women’s ceremony styling' },
        meta: { who: 'women' }, hidden: true, pending: true },
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
    cancellation: { kind: 'hoursBefore', hours: 3 },
    terms: {
      it: 'Il servizio si svolge nella tua camera all’orario scelto. Gli orari mostrati sono quelli realmente liberi. Non è previsto il lavaggio. Colore e colpi di sole non sono al momento disponibili. Si può annullare fino a 3 ore prima dell’appuntamento.',
      en: 'The service takes place in your room at the time you choose. The times shown are the ones actually free. There is no wash service. Colour and highlights are not available at the moment. Cancellable until three hours before the appointment.',
    },
    images: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'celebration',
    category: 'celebration',
    sku: null,
    featured: true,
    status: 'active',
    active: true,
    title: { it: 'Romantic & Celebration', en: 'Romantic & Celebration' },
    summary: {
      it: 'La camera preparata prima che rientriate: fiori, una bottiglia, un biglietto scritto a mano.',
      en: 'The room set up before you come back: flowers, a bottle, a handwritten card.',
    },
    description: {
      it: 'Tre allestimenti, dal più semplice al più scenografico. Possiamo prepararlo prima del vostro arrivo o durante il soggiorno, nell’orario che indicate.\n\nNiente candele vere e niente petali sul letto: usiamo luci e candele LED eleganti dove servono, e manteniamo la camera pulita e ordinata.',
      en: 'Three set-ups, from the simplest to the most theatrical. We can have it ready before you arrive, or during the stay at the time you choose.\n\nNo real candles and no petals on the bed: we use elegant LED candles and lights where they belong, and keep the room clean and uncluttered.',
    },
    variants: [
      { id: 'romantic', sku: 'celebration:romantic',
        title: { it: 'Romantic Welcome', en: 'Romantic Welcome' },
        includes: {
          it: ['Bouquet romantico', 'Biglietto LunArt scritto a mano', 'Allestimento semplice ed elegante', 'Una bottiglia a scelta', '2 calici e ghiaccio dove serve'],
          en: ['Romantic bouquet', 'Handwritten LunArt card', 'A simple, elegant set-up', 'One bottle of your choice', '2 glasses and ice where it belongs'],
        },
        allowedOptions: { bottle: ['prosecco-cuvee', 'rose-fermo', 'vermentino', 'chianti-barrique'] } },
      { id: 'signature', sku: 'celebration:signature',
        title: { it: 'Signature Celebration', en: 'Signature Celebration' },
        includes: {
          it: ['Signature Bouquet, più grande', 'Biglietto scritto a mano', 'Allestimento più ricercato', 'Una bottiglia a scelta', 'Candele LED e luci decorative'],
          en: ['A larger Signature Bouquet', 'Handwritten card', 'A more refined set-up', 'One bottle of your choice', 'LED candles and decorative lights'],
        },
        allowedOptions: { bottle: ['franciacorta-saten', 'vernaccia', 'chianti-riserva', 'bolgheri', 'brunello'] } },
      { id: 'champagne', sku: 'celebration:champagne',
        title: { it: 'Champagne Celebration', en: 'Champagne Celebration' },
        includes: {
          it: ['Signature Bouquet', 'Moët & Chandon', 'Biglietto scritto a mano', 'Allestimento Signature completo'],
          en: ['Signature Bouquet', 'Moët & Chandon', 'Handwritten card', 'The full Signature set-up'],
        },
        allowedOptions: { bottle: ['moet-chandon'], upgrade: ['none', ...CELEBRATION_UPGRADES.champagne] } },
    ],
    options: [
      { id: 'when', required: true,
        label: { it: 'Quando', en: 'When' },
        choices: [
          { id: 'arrival', label: { it: 'Pronto al nostro arrivo', en: 'Ready when we arrive' } },
          { id: 'during',  label: { it: 'Durante il soggiorno, a un’ora che scelgo', en: 'During the stay, at a time I choose' } },
        ] },
      { id: 'bottle', required: true,
        label: { it: 'La bottiglia', en: 'The bottle' },
        choices: bottleChoices([
          'prosecco-cuvee', 'rose-fermo', 'vermentino', 'chianti-barrique',
          'franciacorta-saten', 'vernaccia', 'chianti-riserva', 'bolgheri', 'brunello',
          'moet-chandon',
        ]) },
      { id: 'upgrade', required: false,
        label: { it: 'Upgrade della bottiglia', en: 'Bottle upgrade' },
        choices: [
          { id: 'none', label: { it: 'Nessuno', en: 'None' } },
          { id: 'ruinart-bdb', label: { it: 'Ruinart Blanc de Blancs', en: 'Ruinart Blanc de Blancs' },
            surcharge: { sku: 'celebration:upgrade-ruinart-bdb' } },
          { id: 'dom-perignon', label: { it: 'Dom Pérignon', en: 'Dom Pérignon' },
            surcharge: { sku: 'celebration:upgrade-dom-perignon' } },
        ] },
    ],
    quantity: { min: 1, max: 1, step: 1 },
    requiresDate: true,
    dateLabel: { it: 'Giorno', en: 'Day' },
    requiresTime: false,
    /** A time is only asked for when the set-up happens during the stay. */
    requiresTimeWhen: { option: 'when', equals: 'during' },
    timeLabel: { it: 'Ora richiesta', en: 'Requested time' },
    deliverySlots: DELIVERY_SLOTS.celebration,
    requiresRoom: true,
    requiresFields: [
      { id: 'occasion', type: 'text', required: false,
        label: { it: 'L’occasione', en: 'The occasion' } },
      { id: 'message', type: 'textarea', required: false,
        label: { it: 'Cosa scrivere sul biglietto', en: 'What the card should say' } },
    ],
    cutoff: { kind: 'dayBefore', hour: 12 },
    availabilityMode: 'cutoff',
    purchaseMode: 'instant',
    fulfillmentType: 'staff',
    partner: null,
    cancellation: { kind: 'dayBefore', hour: 12 },
    terms: {
      it: 'Da ordinare entro le 12:00 del giorno precedente, e annullabile entro le 12:00 del giorno precedente. Durante il soggiorno l’orario richiesto va dalle 12:00 alle 22:00. Niente candele a fiamma viva e niente petali sulla biancheria del letto. I fiori seguono la disponibilità stagionale del fioraio.',
      en: 'Ordered by 12:00 noon the day before, and cancellable until 12:00 noon the day before. During the stay the requested time runs from 12:00 to 22:00. No open-flame candles and no petals on the bed linen. Flowers follow the florist’s seasonal availability.',
    },
    images: [],
  },

  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Coming soon, and nothing more. No sheet, no price, no description written to
   * fill the gap: a grey tile with one word on it, until there is something real
   * to say about it.
   */
  {
    id: 'chianti-experience',
    category: 'experience',
    sku: 'chianti-experience',
    featured: false,
    status: 'coming-soon',
    comingSoon: true,
    active: true,
    title: { it: 'Una giornata nel Chianti', en: 'A day in Chianti' },
    summary: { it: '', en: '' },
    variants: [],
    quantity: { min: 1, max: 1, step: 1 },
    requiresDate: false,
    requiresTime: false,
    requiresRoom: false,
    availabilityMode: 'external',
    purchaseMode: 'request-only',
    fulfillmentType: 'provider',
    partner: null,
    cancellation: { kind: 'none' },
    images: [],
  },
];

/**
 * Modelled but not published, and not rendered anywhere. They exist so the shape
 * is agreed now rather than invented one at a time later; moving one into
 * `PRODUCTS` is what publishes it.
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
  { id: 'nightlife-table', category: 'experience', title: { it: 'Tavolo e guest list', en: 'Table and guest list' },
    fulfillmentType: 'partner', availabilityMode: 'request', purchaseMode: 'request-only' },
];

/** What a guest is shown: variants still being settled are not among them. */
export const visibleVariants = (product) => (product?.variants ?? []).filter((v) => !v.hidden);

/** The product as it is published — the same object, minus what is not public. */
export function publicProduct(product) {
  if (!product?.variants?.length) return product;
  return { ...product, variants: visibleVariants(product) };
}
