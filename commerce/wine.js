/**
 * The wine list.
 *
 * `sourcePrice` is the bottle column of the Opera Caffè carta vini — the number we
 * were given. It is not what LunArt charges in the room: the selling price lives in
 * `prices.js` and is set separately, which is why it is recorded here as a source
 * rather than used directly.
 *
 * Only bottles marked `curated` appear in the guide, and the curated list is
 * exactly the fourteen bottles LunArt has set a selling price for. The rest stay in
 * the file so the selection can be changed by flipping a flag rather than retyping
 * a list, and `available: false` takes a bottle off sale without deleting it.
 */

/**
 * How much notice wine needs, in minutes.
 *
 * The rule is about the whole Wine in Room order, not the individual bottle: a
 * basket worth €90 or more is an express run, anything below it goes with the next
 * day's delivery. A bottle may still state its own `leadTimeMinutes` when there is
 * a physical reason — something kept off site — and that always wins, because where
 * a bottle actually is beats what the basket is worth.
 */
export const WINE_LEAD_TIME = {
  /** At or above this order subtotal, express applies. */
  expressThreshold: 9000,   // €90.00
  standardMinutes: 720,     // 12 hours
  expressMinutes: 90,       // 1.5 hours
};

/** The notice a Wine in Room order needs, from what the basket is worth. */
export function leadMinutesForWineOrder(subtotal = 0) {
  const { expressThreshold, standardMinutes, expressMinutes } = WINE_LEAD_TIME;
  return subtotal >= expressThreshold ? expressMinutes : standardMinutes;
}

/**
 * A bottle's own notice period, when it has one. Returns null when it does not,
 * which means the order-total rule decides.
 */
export function leadTimeMinutesFor(bottle) {
  return typeof bottle?.leadTimeMinutes === 'number' ? bottle.leadTimeMinutes : null;
}

/** sourcePrice is in eurocents. */
export const WINES = [
  // ── Rossi ────────────────────────────────────────────────────────────────
  { id: 'chianti-barrique',   kind: 'red',     name: 'Chianti Rosso Barrique',       sourcePrice: 3000,  available: true, curated: true },
  { id: 'morellino',          kind: 'red',     name: 'Morellino di Scansano',        sourcePrice: 3300,  available: true },
  { id: 'sangiovese',         kind: 'red',     name: 'Sangiovese',                   sourcePrice: 3500,  available: true },
  { id: 'rosso-montalcino',   kind: 'red',     name: 'Rosso di Montalcino',          sourcePrice: 4500,  available: true },
  { id: 'nobile',             kind: 'red',     name: 'Nobile di Montepulciano',      sourcePrice: 4800,  available: true },
  { id: 'chianti-riserva',    kind: 'red',     name: 'Chianti Classico Riserva',     sourcePrice: 5200,  available: true, curated: true },
  { id: 'pinot-nero',         kind: 'red',     name: 'Pinot Nero',                   sourcePrice: 5000,  available: true },
  { id: 'amarone',            kind: 'red',     name: 'Amarone della Valpolicella',   sourcePrice: 6000,  available: true, curated: true },
  { id: 'bolgheri',           kind: 'red',     name: 'Bolgheri Rosso',               sourcePrice: 6500,  available: true, curated: true },
  { id: 'brunello',           kind: 'red',     name: 'Brunello di Montalcino',       sourcePrice: 7000,  available: true, curated: true },
  { id: 'modus-primo',        kind: 'red',     name: 'Modus Primo',                  sourcePrice: 10000, available: true },
  { id: 'alauda',             kind: 'red',     name: 'Alauda',                       sourcePrice: 15000, available: true },

  // ── Bianchi ──────────────────────────────────────────────────────────────
  { id: 'bianco-toscano',     kind: 'white',   name: 'Bianco Toscano',               sourcePrice: 3000,  available: true },
  { id: 'vermentino',         kind: 'white',   name: 'Vermentino',                   sourcePrice: 3400,  available: true, curated: true },
  { id: 'chardonnay',         kind: 'white',   name: 'Chardonnay',                   sourcePrice: 3600,  available: true, curated: true },
  { id: 'pinot-grigio',       kind: 'white',   name: 'Pinot Grigio',                 sourcePrice: 4000,  available: true },
  { id: 'sauvignon',          kind: 'white',   name: 'Sauvignon',                    sourcePrice: 4200,  available: true },
  { id: 'vernaccia',          kind: 'white',   name: 'Vernaccia di San Gimignano',   sourcePrice: 4800,  available: true, curated: true },

  // ── Bollicine ────────────────────────────────────────────────────────────
  { id: 'prosecco-cuvee',     kind: 'sparkling', name: 'Prosecco Gran Cuvée',        sourcePrice: 4500,  available: true, curated: true },
  { id: 'franciacorta-saten', kind: 'sparkling', name: 'Franciacorta Satèn',         sourcePrice: 8500,  available: true, curated: true },
  { id: 'moet-chandon',       kind: 'sparkling', name: 'Moët & Chandon',             sourcePrice: 13000, available: true, curated: true },
  { id: 'ruinart-bdb',        kind: 'sparkling', name: 'Ruinart Blanc de Blancs',    sourcePrice: 25000, available: true, curated: true },
  { id: 'dom-perignon',       kind: 'sparkling', name: 'Dom Pérignon',               sourcePrice: 50000, available: true, curated: true },

  // ── Rosé ─────────────────────────────────────────────────────────────────
  { id: 'rose-fermo',         kind: 'rose',    name: 'Rosé',                         sourcePrice: 4500,  available: true, curated: true },
  { id: 'rose-frizzante',     kind: 'rose',    name: 'Rosé frizzante',               sourcePrice: 4500,  available: true },
];

export const WINE_KINDS = {
  red:       { it: 'Rossi',     en: 'Reds' },
  white:     { it: 'Bianchi',   en: 'Whites' },
  sparkling: { it: 'Bollicine', en: 'Sparkling' },
  rose:      { it: 'Rosé',      en: 'Rosé' },
};

const byId = new Map(WINES.map((w) => [w.id, w]));
export const getWine = (id) => byId.get(id);

/** What the guide offers: curated, still on sale, in list order. */
export const curatedWines = () => WINES.filter((w) => w.curated && w.available);
