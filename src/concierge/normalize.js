/**
 * Text normalisation for the Concierge.
 *
 * The previous assistant matched with `query.includes(keyword)` over raw strings.
 * That is why "avete biscotti?" answered about cots ("bis-COT-ti" contains the
 * keyword `cot`) and "quale autobus prendo?" answered about parking ("AUTObus"
 * contains `auto`). Nothing here ever looks inside a word: the smallest unit of
 * comparison is a whole token, and the fix is structural rather than a blocklist
 * of the four phrases we happened to notice.
 */

/** Fold case, strip accents, and turn anything that is not a letter or digit into a gap. */
export function fold(input) {
  return String(input)
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Keep the apostrophe as a separator so "dov'è" splits into "dov" + "e".
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Shortest token we will ever reduce a word to. Below this, stemming does more harm than good. */
const MIN_STEM = 3;

/**
 * Ordered, conservative suffix rules. Italian first (it carries the gender/number
 * endings that matter most here), then the few English ones worth having.
 *
 * Deliberately shallow: an aggressive stemmer collapses words that a guest means
 * differently. "auto" reduces to `aut` while "autobus" stays `autobu`, which is
 * precisely the distinction the old engine could not make.
 */
const SUFFIXES = [
  'issimamente', 'issimo', 'issima', 'issimi', 'issime',
  'amento', 'amenti', 'azione', 'azioni', 'zione', 'zioni',
  'mente', 'aggio',
  'arlo', 'arla', 'arli', 'arle',
  'are', 'ere', 'ire',
  'ato', 'ata', 'ati', 'ate', 'ito', 'ita', 'iti', 'ite', 'uto', 'uta',
  'iamo', 'ando', 'endo',
  'ing', 'ed',
  'i', 'e', 'o', 'a', 's',
];

const stemCache = new Map();

/** Reduce one token to a comparison form. Pure, memoised, language-agnostic. */
export function stem(token) {
  const cached = stemCache.get(token);
  if (cached !== undefined) return cached;

  let out = token;
  for (const suffix of SUFFIXES) {
    if (out.length - suffix.length >= MIN_STEM && out.endsWith(suffix)) {
      out = out.slice(0, -suffix.length);
      break;
    }
  }
  stemCache.set(token, out);
  return out;
}

/** Split folded text into tokens. Single letters are noise and are dropped. */
export function tokenize(input) {
  return fold(input).split(' ').filter((t) => t.length > 1);
}

/** Tokens reduced to their stems, in order. */
export function stems(input) {
  return tokenize(input).map(stem);
}

/**
 * Every contiguous run of 1..n items, joined by spaces, so multi-word forms
 * ("a che ora", "aria condizionata", "tassa di soggiorno") are looked up exactly
 * as single words are.
 */
export function grams(list, maxN = 3) {
  const out = new Set();
  for (let n = 1; n <= maxN; n++) {
    for (let i = 0; i + n <= list.length; i++) out.add(list.slice(i, i + n).join(' '));
  }
  return out;
}

/**
 * Lookup keys for a piece of text: the raw folded grams *and* the stemmed ones.
 *
 * Indexing in both spaces costs almost nothing and removes a whole class of
 * stemmer accidents. "camere" happens to reduce to `cam` while "camera" reduces
 * to `camer` — the shallow rules cannot tell a noun plural in -ere from a verb
 * infinitive. Because both the lexicon and the query are indexed raw as well,
 * the two still meet on the literal form, and any inflection nobody thought to
 * list is still caught by the stem.
 */
export function keysOf(input, maxN = 3) {
  const words = tokenize(input);
  const out = grams(words, maxN);
  for (const g of grams(words.map(stem), maxN)) out.add(g);
  return out;
}

/**
 * The keys one lexicon surface form is stored under — the whole form only.
 *
 * A multi-word form must never be indexed under its parts. Indexing "dove si trova"
 * under "dove" would put a bare question word into the address concept, and every
 * "dove ...?" question in the language would start matching the street address —
 * exactly the failure this engine exists to remove.
 */
export function formKeys(surface) {
  const words = tokenize(surface);
  if (words.length === 0) return [];
  return [...new Set([words.join(' '), words.map(stem).join(' ')])];
}
