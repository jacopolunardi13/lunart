/**
 * The Concierge's retrieval engine: deterministic, offline, and free to run.
 *
 * No model is called. Every answer is a row from the knowledge layer, chosen by
 * matching concepts, or an honest "I don't know this one — here is a human". A
 * Concierge that says it does not know is more useful than one that confidently
 * answers the wrong question, so the engine is built to decline.
 *
 * Shape of a result:
 *   { kind: 'answer',   entryId, intentId, question, score, alternatives }
 *   { kind: 'choice',   options: [{ entryId, intentId }, ...], question }
 *   { kind: 'fallback', suggestions: [intentId, ...] }
 */

import { keysOf, formKeys } from './normalize.js';
import { CONCEPTS, QUESTION, FOLLOW_UP, STOPWORDS } from './lexicon.js';
import { INTENTS, QUICK_REPLIES } from './intents.js';

/** Build `key -> Set(conceptId)`. A key may legitimately belong to several concepts. */
function buildIndex(groups) {
  const index = new Map();
  for (const [id, forms] of Object.entries(groups)) {
    for (const form of forms) {
      for (const k of formKeys(form)) {
        if (!index.has(k)) index.set(k, new Set());
        index.get(k).add(id);
      }
    }
  }
  return index;
}

const CONCEPT_INDEX = buildIndex(CONCEPTS);
const QUESTION_INDEX = buildIndex(QUESTION);
const FOLLOW_UP_KEYS = new Set(FOLLOW_UP.flatMap(formKeys));
const STOP_KEYS = new Set(STOPWORDS.flatMap(formKeys));

/** Every concept an intent can score on, with its weight. Anchors carry 2 by default. */
function intentWeights(intent) {
  const w = new Map();
  for (const a of intent.anchors) w.set(a, 2);
  for (const [c, weight] of Object.entries(intent.support ?? {})) {
    w.set(c, (w.get(c) ?? 0) + weight);
  }
  return w;
}

const WEIGHTS = new Map(INTENTS.map((i) => [i.id, intentWeights(i)]));

/**
 * Inverse document frequency over the intent table.
 *
 * A concept used by one intent is a strong signal; one used by many is weak. This
 * is why "fumare" beats "camera" in "si può fumare in camera?" without anyone
 * hand-tuning that pair: `smoking` appears in a single intent, `room` in several.
 */
const IDF = (() => {
  const df = new Map();
  for (const weights of WEIGHTS.values()) {
    for (const c of weights.keys()) df.set(c, (df.get(c) ?? 0) + 1);
  }
  const n = INTENTS.length;
  const idf = new Map();
  for (const [c, count] of df) idf.set(c, Math.log(1 + n / count));
  return idf;
})();

/** Concepts and question types present in a query. */
export function analyse(text) {
  const keys = keysOf(text);
  const concepts = new Set();
  const questions = new Set();
  for (const k of keys) {
    // A lone grammar word never carries a topic, but it may still be part of a
    // multi-word form, so only single-word keys are filtered.
    const isLoneStopword = !k.includes(' ') && STOP_KEYS.has(k);
    if (!isLoneStopword) {
      for (const c of CONCEPT_INDEX.get(k) ?? []) concepts.add(c);
    }
    for (const q of QUESTION_INDEX.get(k) ?? []) questions.add(q);
  }
  return { keys, concepts, questions, followUp: [...keys].some((k) => FOLLOW_UP_KEYS.has(k)) };
}

/** Score one intent against an analysed query, or return null if it cannot apply. */
function scoreIntent(intent, concepts) {
  if (intent.blockers?.some((b) => concepts.has(b))) return null;
  if (!intent.anchors.some((a) => concepts.has(a))) return null;

  const weights = WEIGHTS.get(intent.id);
  let matched = 0;
  let possible = 0;
  for (const [concept, weight] of weights) {
    const value = weight * (IDF.get(concept) ?? 1);
    possible += value;
    if (concepts.has(concept)) matched += value;
  }
  // Reward both the weight of the evidence and how much of the intent it covers,
  // so "colazione in camera" outranks plain "colazione" without special-casing.
  const coverage = possible === 0 ? 0 : matched / possible;
  return { intent, score: matched * (0.5 + 0.5 * coverage), matched, coverage };
}

/** Which entry an intent resolves to, once phase and refinements are applied. */
function resolveEntry(intent, concepts, phase) {
  for (const rule of intent.refine ?? []) {
    if (concepts.has(rule.concept)) return rule.entry;
  }
  return intent.entryByPhase?.[phase] ?? intent.entry;
}

/** Below this relative gap the top two answers are treated as genuinely ambiguous. */
const AMBIGUITY_MARGIN = 0.15;

/**
 * Answer one question.
 *
 * @param {string} text        what the guest typed
 * @param {object} [options]
 * @param {'before'|'staying'|'leaving'} [options.phase]  which entry variant to prefer
 * @param {{intentId: string}|null} [options.memory]      the previous turn, for follow-ups
 */
export function ask(text, { phase = 'staying', memory = null } = {}) {
  const { concepts, questions, keys, followUp } = analyse(text);
  const question = questions.values().next().value ?? null;

  const rank = (pool) => pool
    .map((i) => scoreIntent(i, concepts))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  let ranked = rank(INTENTS.filter((i) => !i.weak));

  // A qualifier intent ("how much?") steps in only when the topical answer cannot
  // address it, or when there is no topical answer at all.
  const weak = rank(INTENTS.filter((i) => i.weak));
  if (weak.length > 0) {
    const qualifier = weak[0].intent.qualifier;
    const topicalAnswers = ranked.length > 0
      && (qualifier !== 'price' || ranked[0].intent.answersPrice === true);
    if (!topicalAnswers) ranked = weak;
  }

  if (ranked.length === 0) {
    // A short question with no topic of its own continues the previous one:
    // "e a che ora?" after check-in is still about check-in.
    if (memory?.intentId && keys.size <= 8 && (question || followUp)) {
      const previous = INTENTS.find((i) => i.id === memory.intentId);
      if (previous) {
        return {
          kind: 'answer',
          entryId: resolveEntry(previous, concepts, phase),
          intentId: previous.id,
          question,
          score: 0,
          continued: true,
          alternatives: [],
        };
      }
    }
    return { kind: 'fallback', question, suggestions: QUICK_REPLIES[phase] ?? QUICK_REPLIES.staying };
  }

  const [best, runnerUp] = ranked;
  const margin = runnerUp ? (best.score - runnerUp.score) / best.score : 1;

  // Two plausible readings of the same words: ask rather than guess. Picking one
  // silently is how a retrieval bot earns its reputation for being wrong.
  if (runnerUp && margin < AMBIGUITY_MARGIN) {
    const seen = new Set();
    const options = [best, runnerUp]
      .map((c) => ({ entryId: resolveEntry(c.intent, concepts, phase), intentId: c.intent.id }))
      .filter((o) => (seen.has(o.entryId) ? false : seen.add(o.entryId)));
    if (options.length > 1) return { kind: 'choice', options, question };
  }

  return {
    kind: 'answer',
    entryId: resolveEntry(best.intent, concepts, phase),
    intentId: best.intent.id,
    question,
    score: Number(best.score.toFixed(3)),
    continued: false,
    alternatives: ranked.slice(1, 3).map((c) => ({
      entryId: resolveEntry(c.intent, concepts, phase),
      intentId: c.intent.id,
    })),
  };
}

/**
 * Free-text search over the knowledge layer, sharing the engine with the chat so
 * the two can never disagree about what matches. Falls back to literal substring
 * matching on titles so that typing a word from a heading always finds it.
 */
export function search(text, entries, { phase = 'staying', lang = 'it' } = {}) {
  const trimmed = text.trim();
  if (trimmed.length < 2) return [];

  const hits = new Map();
  const result = ask(trimmed, { phase });
  if (result.kind === 'answer') {
    hits.set(result.entryId, 100);
    for (const alt of result.alternatives) hits.set(alt.entryId, 60);
  } else if (result.kind === 'choice') {
    for (const option of result.options) hits.set(option.entryId, 90);
  }

  const needle = keysOf(trimmed);
  for (const entry of entries) {
    const haystack = keysOf(`${entry.title[lang]} ${entry.summary[lang]}`);
    let overlap = 0;
    for (const k of needle) if (haystack.has(k)) overlap++;
    if (overlap > 0) hits.set(entry.id, (hits.get(entry.id) ?? 0) + overlap * 10);
  }

  return [...hits.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

export { QUICK_REPLIES };
