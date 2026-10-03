/**
 * The wine list.
 *
 * `sourcePrice` is the bottle column of the Opera Caffè carta vini — the number we
 * were given. It is not automatically what LunArt charges in the room: the selling
 * price lives in `prices.js` and is set separately, which is why it is recorded
 * here as a source rather than used directly.
 *
 * Only bottles marked `curated` appear in the guide. The rest stay in the file so
 * the selection can be changed by flipping a flag rather than retyping a list, and
 * `available: false` takes a bottle off sale immediately without deleting it.
 */

/**
 * How much notice a bottle needs, in minutes.
 *
 * The commercial default follows price — a cellar run for something ordinary can
 * wait for the next delivery, while the expensive bottles are the ones kept close
 * to hand — but price is only the fallback. Any bottle can state its own
 * `leadTimeMinutes` and that always wins, because the real constraint is where a
 * bottle physically is, not what it costs.
 */
export const LEAD_TIME_DEFAULTS = {
  /** At or above this source price, the short lead time applies. */
  premiumThreshold: 10000,  // €100.00
  standardMinutes: 720,     // 12 hours
  premiumMinutes: 90,       // 1.5 hours
};

export function leadTimeMinutesFor(bottle) {
  if (typeof bottle.leadTimeMinutes === 'number') return bottle.leadTimeMinutes;
  const { premiumThreshold, standardMinutes, premiumMinutes } = LEAD_TIME_DEFAULTS;
  return bottle.sourcePrice >= premiumThreshold ? premiumMinutes : standardMinutes;
}

/** sourcePrice is in eurocents. */
export const WINES = [
  // ── Rossi ────────────────────────────────────────────────────────────────
  { id: 'chianti-barrique',   kind: 'red',     name: 'Chianti Rosso Barrique',       sourcePrice: 3000,  available: true },
  { id: 'morellino',          kind: 'red',     name: 'Morellino di Scansano',        sourcePrice: 3300,  available: true },
  { id: 'sangiovese',         kind: 'red',     name: 'Sangiovese',                   sourcePrice: 3500,  available: true },
  { id: 'rosso-montalcino',   kind: 'red',     name: 'Rosso di Montalcino',          sourcePrice: 4500,  available: true, curated: true },
  { id: 'nobile',             kind: 'red',     name: 'Nobile di Montepulciano',      sourcePrice: 4800,  available: true },
  { id: 'chianti-riserva',    kind: 'red',     name: 'Chianti Classico Riserva',     sourcePrice: 5200,  available: true, curated: true },
  { id: 'pinot-nero',         kind: 'red',     name: 'Pinot Nero',                   sourcePrice: 5000,  available: true },
  { id: 'amarone',            kind: 'red',     name: 'Amarone della Valpolicella',   sourcePrice: 6000,  available: true },
  { id: 'bolgheri',           kind: 'red',     name: 'Bolgheri Rosso',               sourcePrice: 6500,  available: true, curated: true },
  { id: 'brunello',           kind: 'red',     name: 'Brunello di Montalcino',       sourcePrice: 7000,  available: true, curated: true },
  { id: 'modus-primo',        kind: 'red',     name: 'Modus Primo',                  sourcePrice: 10000, available: true },
  { id: 'alauda',             kind: 'red',     name: 'Alauda',                       sourcePrice: 15000, available: true },

  // ── Bianchi ──────────────────────────────────────────────────────────────
  { id: 'bianco-toscano',     kind: 'white',   name: 'Bianco Toscano',               sourcePrice: 3000,  available: true },
  { id: 'vermentino',         kind: 'white',   name: 'Vermentino',                   sourcePrice: 3400,  available: true, curated: true },
  { id: 'chardonnay',         kind: 'white',   name: 'Chardonnay',                   sourcePrice: 3600,  available: true },
  { id: 'pinot-grigio',       kind: 'white',   name: 'Pinot Grigio',                 sourcePrice: 4000,  available: true },
  { id: 'sauvignon',          kind: 'white',   name: 'Sauvignon',                    sourcePrice: 4200,  available: true },
  { id: 'vernaccia',          kind: 'white',   name: 'Vernaccia di San Gimignano',   sourcePrice: 4800,  available: true, curated: true },

  // ── Bollicine ────────────────────────────────────────────────────────────
  { id: 'prosecco-cuvee',     kind: 'sparkling', name: 'Prosecco Gran Cuvée',        sourcePrice: 4500,  available: true, curated: true },
  { id: 'franciacorta-saten', kind: 'sparkling', name: 'Franciacorta Satèn',         sourcePrice: 8500,  available: true, curated: true },
  { id: 'moet-chandon',       kind: 'sparkling', name: 'Moët & Chandon',             sourcePrice: 13000, available: true, curated: true },
  { id: 'ruinart-bdb',        kind: 'sparkling', name: 'Ruinart Blanc de Blancs',    sourcePrice: 25000, available: true },
  { id: 'dom-perignon',       kind: 'sparkling', name: 'Dom Pérignon',               sourcePrice: 50000, available: true, curated: true },

  // ── Rosé ─────────────────────────────────────────────────────────────────
  { id: 'rose-fermo',         kind: 'rose',    name: 'Rosé fermo',                   sourcePrice: 4500,  available: true, curated: true },
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
