/**
 * Surface forms a guest might type, grouped into concepts.
 *
 * A concept is a meaning, not a word. Intents are written against concepts, so
 * adding "il condizionatore non parte" to the vocabulary never requires touching
 * an intent, and no intent can accidentally match on a fragment of an unrelated
 * word.
 *
 * Question words live in QUESTION, not here, and deliberately so: "dove" tells us
 * what *kind* of answer is wanted, never what the answer is about. The old engine
 * scored "dove" as a keyword for the address, which is why "dove posso cenare?"
 * replied with the street address.
 */

export const CONCEPTS = {
  // ── Arrival ──────────────────────────────────────────────────────────────
  checkin: ['check in', 'checkin', 'accoglienza', 'registrazione', 'registrarsi', 'arrival time'],
  arrival: ['arrivo', 'arrivare', 'arrivi', 'arrive', 'arriving', 'arrival', 'giungere'],
  access: ['codice', 'codici', 'pin', 'chiave', 'chiavi', 'portone', 'citofono', 'targhetta',
           'entrare', 'ingresso', 'accesso', 'serratura', 'key', 'keys', 'code', 'codes',
           'door', 'entrance', 'lock', 'get in', 'let myself in'],
  late: ['tardi', 'tardo', 'in ritardo', 'notte', 'nottata', 'mezzanotte', 'late', 'night',
         'midnight', 'after hours'],
  early: ['presto', 'prestissimo', 'alba', 'mattina presto', 'early', 'sunrise', 'at dawn'],
  luggage: ['bagagli', 'bagaglio', 'valigia', 'valigie', 'deposito bagagli', 'deposito',
            'zaino', 'trolley', 'luggage', 'baggage', 'suitcase', 'suitcases', 'bags',
            'left luggage', 'storage'],

  // ── Car, transport ───────────────────────────────────────────────────────
  parking: ['parcheggio', 'parcheggiare', 'garage', 'posteggio', 'parking', 'park',
            'park the car', 'car park', 'where to park', 'leave the car', 'lascio la macchina',
            'lascio l auto'],
  // Not bare 'car': it stems to `car`, and so does the Italian "caro" (expensive),
  // which would send "quanto è caro?" to the parking entry.
  car: ['auto', 'automobile', 'macchina', 'my car', 'the car', 'rental car', 'hire car',
        'vehicle', 'veicolo', 'noleggio'],
  ztl: ['ztl', 'zona a traffico limitato', 'zona traffico limitato', 'varco', 'varchi',
        'telecamera', 'telecamere', 'multa', 'multe', 'sanzione', 'targa', 'permesso',
        'restricted traffic', 'limited traffic', 'traffic zone', 'traffic fine', 'ztl fine',
        'plate', 'number plate'],
  publicTransport: ['autobus', 'bus', 'pullman', 'tram', 'tramvia', 'mezzi pubblici', 'mezzi',
                    'trasporto pubblico', 'public transport', 'metro', 'linea', 'biglietto',
                    'fermata', 'bus stop', 'tram stop'],
  taxi: ['taxi', 'radiotaxi', 'cab', 'uber'],
  transfer: ['ncc', 'transfer', 'autista', 'driver', 'navetta', 'shuttle', 'chauffeur',
             'auto con conducente', 'private driver'],
  airport: ['aeroporto', 'airport', 'volo', 'voli', 'flight', 'peretola', 'vespucci', 'amerigo vespucci'],
  station: ['stazione', 'station', 'treno', 'treni', 'train', 'santa maria novella', 'smn', 'rail'],
  address: ['indirizzo', 'posizione', 'mappa', 'address', 'location', 'map', 'directions',
            'dove siete', 'dove si trova', 'come arrivare', 'come si arriva', 'how to get there',
            'how do i get there'],

  // ── The room ─────────────────────────────────────────────────────────────
  room: ['camera', 'camere', 'stanza', 'stanze', 'room', 'rooms', 'letto', 'letti', 'bed', 'beds'],
  bathroom: ['bagno', 'doccia', 'bathroom', 'shower', 'toilet', 'wc', 'lavandino'],
  climate: ['clima', 'climatizzatore', 'condizionatore', 'aria condizionata', 'riscaldamento',
            'termosifone', 'termostato', 'temperatura', 'air conditioning', 'aircon', 'heating',
            'heater', 'thermostat', 'too hot', 'too cold', 'fa freddo', 'fa caldo'],
  towelRail: ['scaldasalviette', 'scalda salviette', 'termoarredo', 'irsap', 'towel rail',
              'heated rail', 'towel warmer'],
  towels: ['asciugamani', 'asciugamano', 'teli', 'telo', 'biancheria', 'lenzuola', 'towel',
           'towels', 'linen', 'sheets'],
  cleaning: ['pulizia', 'pulizie', 'pulire', 'rifare la camera', 'cleaning', 'housekeeping',
             'cleaned', 'make up the room'],
  amenities: ['frigo', 'frigorifero', 'minibar', 'cassaforte', 'room safe', 'tv', 'televisione',
              'television', 'nespresso', 'bollitore', 'kettle', 'phon', 'asciugacapelli',
              'hairdryer', 'hair dryer', 'ferro da stiro', 'streaming', 'netflix', 'fridge'],
  wifi: ['wifi', 'wi fi', 'internet', 'rete', 'network', 'connessione', 'connection', 'password',
         'router', 'segnale', 'signal', 'online'],
  welcomeGift: ['benvenuto', 'welcome drink', 'welcome', 'prosecco', 'omaggio'],
  noise: ['rumore', 'rumori', 'rumoroso', 'rumorosa', 'silenzio', 'silenziosa', 'tranquilla',
          'tranquillo', 'noise', 'noisy', 'quiet', 'loud', 'soundproof'],
  smoking: ['fumare', 'fumo', 'fumatori', 'sigaretta', 'sigarette', 'smoke', 'smoking',
            'cigarette', 'cigarettes', 'vape'],
  pets: ['cane', 'cani', 'gatto', 'gatti', 'animale', 'animali', 'pet', 'pets', 'dog', 'dogs', 'cat'],
  children: ['bambino', 'bambini', 'figli', 'culla', 'culle', 'lettino', 'neonato', 'child',
             'children', 'kid', 'kids', 'baby', 'cot', 'crib', 'infant', 'letto aggiuntivo',
             'extra bed'],
  accessibility: ['ascensore', 'scale', 'gradini', 'scalini', 'disabile', 'carrozzina',
                  'sedia a rotelle', 'passeggino', 'lift', 'elevator', 'stairs', 'steps',
                  'wheelchair', 'accessible', 'accessibility', 'step free'],

  // ── Food ─────────────────────────────────────────────────────────────────
  breakfast: ['colazione', 'breakfast', 'brioche', 'cornetto', 'cappuccino', 'caffe', 'coffee', 'brunch'],
  dining: ['cena', 'cenare', 'pranzo', 'pranzare', 'mangiare', 'ristorante', 'ristoranti',
           'trattoria', 'trattorie', 'osteria', 'dinner', 'lunch', 'eat', 'eating', 'restaurant',
           'restaurants', 'dine', 'food', 'cibo', 'tavola'],
  steak: ['bistecca', 'fiorentina', 'chianina', 'steak', 'carne'],
  gelato: ['gelato', 'gelati', 'gelateria', 'ice cream', 'icecream'],
  aperitivo: ['aperitivo', 'aperitif', 'spritz', 'wine bar', 'enoteca', 'vino', 'wine', 'drink',
              'drinks', 'cocktail', 'bere'],
  dietary: ['vegano', 'vegana', 'vegetariano', 'vegetariana', 'glutine', 'celiaco', 'celiachia',
            'intolleranza', 'intollerante', 'allergia', 'allergie', 'lattosio', 'vegan',
            'vegetarian', 'gluten', 'allergy', 'allergic', 'intolerance', 'lactose', 'dairy'],

  // ── The city ─────────────────────────────────────────────────────────────
  museum: ['museo', 'musei', 'uffizi', 'accademia', 'david', 'galleria', 'museum', 'museums',
           'gallery', 'arte', 'art', 'mostra', 'exhibition', 'duomo', 'pitti', 'boboli'],
  itinerary: ['itinerario', 'itinerari', 'cosa vedere', 'cosa fare', 'programma', 'passeggiata',
              'passeggiare', 'giro', 'itinerary', 'what to see', 'what to do', 'sightseeing'],
  // Asking for "advice" says how the guest is asking, not what about. It supports an
  // intent but can never select one, so "consigli per il gelato" is about gelato.
  advice: ['consiglio', 'consigli', 'consigliate', 'suggerimento', 'suggerimenti', 'idee',
           'recommend', 'recommendation', 'recommendations', 'suggestions', 'suggest', 'advice',
           'any tips', 'tips'],
  dayTrip: ['siena', 'pisa', 'chianti', 'san gimignano', 'lucca', 'gita', 'escursione',
            'fuori firenze', 'day trip', 'excursion', 'toscana', 'tuscany', 'countryside'],
  wellness: ['spa', 'massaggio', 'massaggi', 'yoga', 'benessere', 'sauna', 'massage', 'wellness',
             'relax', 'hammam'],

  // ── Money, admin ─────────────────────────────────────────────────────────
  price: ['prezzo', 'prezzi', 'costo', 'costa', 'costano', 'tariffa', 'tariffe', 'price',
          'prices', 'rate', 'rates', 'cost', 'how much is'],
  booking: ['prenotazione', 'prenotare', 'prenoto', 'cancellazione', 'cancellare', 'disdire',
            'rimborso', 'pagamento', 'pagare', 'bonifico', 'caparra', 'booking', 'book',
            'reservation', 'cancel', 'cancellation', 'refund', 'payment', 'pay', 'deposit'],
  cityTax: ['tassa di soggiorno', 'tassa', 'imposta di soggiorno', 'city tax', 'tourist tax',
            'tourism tax', 'soggiorno'],
  invoice: ['fattura', 'fatture', 'ricevuta', 'scontrino', 'invoice', 'receipt', 'billing'],
  discount: ['sconto', 'sconti', 'convenzione', 'promozione', 'riduzione', 'offerta', 'discount',
             'deal', 'reduction', 'guest benefit'],

  // ── Help ─────────────────────────────────────────────────────────────────
  contact: ['contatto', 'contatti', 'telefono', 'chiamare', 'numero', 'whatsapp', 'email',
            'scrivere', 'parlare', 'contact', 'phone', 'call', 'staff', 'reception', 'aiuto',
            'help', 'assistenza', 'support', 'someone'],
  problem: ['problema', 'problemi', 'guasto', 'rotto', 'rotta', 'non funziona', 'non va',
            'non parte', 'non si accende', 'non riesco', 'si e rotto', 'perdita', 'manca',
            'broken', 'problem', 'issue', 'not working', 'fault', 'doesnt work', 'wont start'],
  emergency: ['emergenza', 'urgente', 'urgenza', 'ambulanza', 'polizia', 'medico', 'dottore',
              'farmacia', 'ospedale', 'emergency', 'urgent', 'doctor', 'pharmacy', 'chemist',
              'hospital', 'police', 'ambulance'],

  // ── Departure ────────────────────────────────────────────────────────────
  checkout: ['check out', 'checkout', 'lasciare la camera', 'liberare la camera', 'partire',
             'partenza', 'leave the room', 'leaving', 'departure', 'vacate'],

  // ── Modifiers ────────────────────────────────────────────────────────────
  quick: ['veloce', 'rapido', 'in fretta', 'di corsa', 'quick', 'quickly', 'fast', 'in a hurry'],
};

/**
 * What kind of answer is being asked for. Never a topic — only a facet.
 * An intent is never selected because of one of these.
 */
export const QUESTION = {
  when: ['quando', 'a che ora', 'che ora', 'orario', 'orari', 'when', 'what time', 'hours', 'until'],
  where: ['dove', "dov", 'where'],
  how: ['come', 'how'],
  howMuch: ['quanto', 'quanta', 'how much', 'how many'],
  can: ['posso', 'si puo', 'possiamo', 'è possibile', 'e possibile', 'can i', 'may i', 'could i',
        'is it possible', 'am i allowed'],
};

/**
 * Pure grammar. These are never a topic on their own, so a single one of them can
 * never match a concept — though they still count inside a multi-word form, and
 * question words are matched separately and are unaffected.
 *
 * This list exists because of real collisions, not theory: the English modal "can"
 * reduces to the same stem as the Italian "cane"/"cani" (dog, dogs), which made
 * "where can I park?" an answer about pets. Multi-word forms are unharmed, so
 * "posso portare il cane" still matches on the literal word.
 */
export const STOPWORDS = [
  // English function words
  'can', 'could', 'would', 'should', 'shall', 'will', 'may', 'might', 'must', 'the', 'and',
  'for', 'with', 'from', 'that', 'this', 'these', 'those', 'have', 'has', 'had', 'been',
  'your', 'our', 'their', 'they', 'them', 'you', 'we', 'us', 'it', 'its', 'what', 'which',
  'who', 'there', 'here', 'very', 'just', 'only', 'also', 'about', 'into', 'any', 'some',
  'please', 'thanks', 'thank', 'hello', 'hi',
  // Italian function words
  'il', 'lo', 'la', 'le', 'gli', 'un', 'una', 'uno', 'del', 'dello', 'della', 'dei', 'degli',
  'delle', 'nel', 'nello', 'nella', 'nei', 'negli', 'nelle', 'sul', 'sulla', 'con', 'per',
  'che', 'non', 'ma', 'se', 'mi', 'ti', 'ci', 'vi', 'ne', 'al', 'allo', 'alla', 'ai', 'agli',
  'alle', 'da', 'dal', 'dalla', 'in', 'su', 'tra', 'fra', 'molto', 'tutto', 'tutti', 'ecco',
  'grazie', 'ciao', 'salve', 'vorrei', 'avete', 'siete', 'sono', 'essere', 'avere',
];

/** Carried from the previous turn when a follow-up has no topic of its own. */
export const FOLLOW_UP = ['e', 'invece', 'poi', 'allora', 'anche', 'and', 'what about', 'instead', 'then'];
