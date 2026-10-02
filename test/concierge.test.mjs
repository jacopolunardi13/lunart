/**
 * The Concierge's behavioural contract.
 *
 * The adversarial block is the point of this file. Every case in it is a question
 * the previous assistant got wrong, or one built the same way: a query whose words
 * contain a keyword for an unrelated topic. They are asserted on the entry id, not
 * on prose, so rewriting an answer never breaks a test and changing retrieval always
 * does.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ask, search, analyse } from '../src/concierge/engine.js';
import { INTENTS } from '../src/concierge/intents.js';
import { CONCEPTS, QUESTION, STOPWORDS } from '../src/concierge/lexicon.js';
import { formKeys, stem, keysOf } from '../src/concierge/normalize.js';
import { entries, getEntry } from '../data/index.js';

/** Assert a query resolves to a specific entry. */
function answers(query, entryId, options) {
  const result = ask(query, options);
  assert.equal(result.kind, 'answer',
    `"${query}" should give a single answer, got ${result.kind}` +
    (result.options ? ` (${result.options.map((o) => o.entryId).join(' / ')})` : ''));
  assert.equal(result.entryId, entryId, `"${query}" should answer with "${entryId}"`);
}

/** Assert a query is declined rather than guessed at. */
function declines(query, options) {
  const result = ask(query, options);
  assert.equal(result.kind, 'fallback',
    `"${query}" should fall back, but answered "${result.entryId ?? ''}"`);
  assert.ok(result.suggestions.length > 0, `"${query}" should still suggest something`);
}

// ─────────────────────────────────────────────────────────────────────────────
test('positive queries — Italian', async (t) => {
  const cases = [
    ['qual è la password del wifi', 'wifi'],
    ['non riesco a connettermi a internet', 'wifi'],
    ['a che ora posso fare il check in', 'checkin'],
    ['quando posso arrivare', 'checkin'],
    ['arrivo verso mezzanotte', 'late-arrival'],
    ['a che ora devo lasciare la camera', 'checkout'],
    ['dove si fa colazione', 'breakfast'],
    ['la colazione è inclusa', 'breakfast'],
    ['dove lascio le valigie', 'luggage-early'],
    ['deposito bagagli dopo il check out', 'luggage-late'],
    ['dove posso parcheggiare', 'parking'],
    ['come funziona la ztl', 'ztl'],
    ['ho bisogno di assistenza', 'contacts'],
    ['vorrei chiamare un taxi', 'taxi'],
    ['consigli per un ristorante', 'eat'],
    ['dove si mangia la bistecca', 'eat'],
    ['il codice per entrare', 'access'],
    ['il condizionatore non parte', 'climate'],
    ['lo scaldasalviette è freddo', 'towel-rail'],
    ['sono vegetariano', 'dietary'],
    ['quanto è la tassa di soggiorno', 'city-tax'],
    ['avete una culla', 'children'],
    ['c’è l’ascensore', 'accessibility'],
  ];
  for (const [query, expected] of cases) {
    await t.test(query, () => answers(query, expected));
  }
});

test('positive queries — English', async (t) => {
  const cases = [
    ['what is the wifi password', 'wifi'],
    ['what time is check in', 'checkin'],
    ['when do I have to check out', 'checkout'],
    ['where is breakfast', 'breakfast'],
    ['can I store my luggage', 'luggage-early'],
    ['where can I park', 'parking'],
    ['how does the restricted traffic zone work', 'ztl'],
    ['I need help', 'contacts'],
    ['how do I get a taxi', 'taxi'],
    ['where should I have dinner', 'eat'],
    ['is smoking allowed', 'smoking'],
    ['do you allow dogs', 'pets'],
    ['the heating is not working', 'climate'],
    ['I am gluten free', 'dietary'],
  ];
  for (const [query, expected] of cases) {
    await t.test(query, () => answers(query, expected));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
test('adversarial — the four reported false positives', async (t) => {
  // Each of these was answered wrongly by the substring matcher in the old page.
  const cases = [
    // "bis-COT-ti" contained the keyword `cot`, so this replied about baby cots.
    ['avete biscotti?', null, 'a biscuit is not a cot'],
    // "AUTObus" contained `auto`, so this replied about parking.
    ['quale autobus prendo?', 'getting-around', 'a bus is not a car'],
    // `dove` was scored as a keyword for the street address.
    ['dove posso cenare?', 'eat', 'a question word is not a topic'],
    // `camera` outscored the actual subject of the sentence.
    ['si può fumare in camera?', 'smoking', 'the verb carries the question, not the room'],
  ];
  for (const [query, expected, why] of cases) {
    await t.test(`${query} — ${why}`, () => {
      if (expected === null) declines(query);
      else answers(query, expected);
    });
  }
});

test('adversarial — other lexical collisions', async (t) => {
  const cases = [
    // `car` is a substring of "scarpe"; `park` is not a shoe shop.
    ['dove compro le scarpe', null],
    // The Italian "caro" (expensive) stems onto the English "car".
    ['quanto è caro', null],
    // "fine" means "end" in Italian, and used to be a keyword for ZTL fines.
    ['alla fine della giornata', null],
    // The English modal "can" stems onto the Italian "cane"/"cani".
    ['where can I park', 'parking'],
    // ...while the actual word still works.
    ['posso portare il cane', 'pets'],
    // `off` as a discount keyword would have caught this.
    ['come spengo l’aria condizionata', 'climate'],
    // bare `safe` would have answered with the list of room fittings.
    ['è sicuro il quartiere di sera', null],
    // "leave the room" is check-out; "leave the car" is not.
    ['where do I leave the car', 'parking'],
    // A broken thing is a problem before it is an amenity.
    ['il frigo non funziona', 'room-problem'],
    // ...but asking what exists is not a complaint.
    ['cosa c’è in camera', 'amenities'],
    // "consigli" says how you are asking, not what about.
    ['consigli per il gelato', 'gelato'],
    // A price question keeps the topic when the topic knows the price...
    ['quanto costa il parcheggio', 'parking'],
    // ...and hands over to a human when it does not.
    ['quanto costa la camera', 'booking-terms'],
  ];
  for (const [query, expected] of cases) {
    await t.test(query, () => {
      if (expected === null) declines(query);
      else answers(query, expected);
    });
  }
});

test('unknown questions are declined, never guessed', async (t) => {
  const unknown = [
    'avete biscotti?',
    'c’è un bancomat qui vicino',
    'vendete francobolli',
    'posso stirare una camicia',
    'qual è la squadra di calcio locale',
    'mi serve un adattatore universale',
    'do you sell postcards',
    'is there a swimming pool',
    'what is the meaning of life',
    'asdfgh qwerty',
  ];
  for (const query of unknown) {
    await t.test(query, () => declines(query));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
test('genuinely ambiguous questions ask instead of guessing', () => {
  const result = ask('vorrei un taxi per l’aeroporto');
  assert.equal(result.kind, 'choice');
  assert.ok(result.options.length >= 2);
  const ids = result.options.map((o) => o.entryId);
  assert.ok(ids.includes('taxi') && ids.includes('to-airport'), `got ${ids.join(', ')}`);
});

test('a follow-up continues the previous topic', () => {
  const first = ask('a che ora è il check in');
  assert.equal(first.entryId, 'checkin');

  const followUp = ask('e a che ora?', { memory: { intentId: first.intentId } });
  assert.equal(followUp.kind, 'answer');
  assert.equal(followUp.entryId, 'checkin');
  assert.equal(followUp.continued, true);
});

test('a follow-up with no memory still declines', () => {
  const result = ask('e a che ora?', { memory: null });
  assert.equal(result.kind, 'fallback');
});

test('phase picks the right side of a two-way entry', () => {
  assert.equal(ask('aeroporto', { phase: 'before' }).entryId, 'from-airport');
  assert.equal(ask('aeroporto', { phase: 'leaving' }).entryId, 'to-airport');
  assert.equal(ask('stazione', { phase: 'before' }).entryId, 'from-station');
  assert.equal(ask('stazione', { phase: 'leaving' }).entryId, 'to-station');
});

test('the engine is deterministic', () => {
  const once = ask('dove posso cenare?');
  for (let i = 0; i < 25; i++) {
    assert.deepEqual(ask('dove posso cenare?'), once);
  }
});

test('empty and junk input never throws', () => {
  for (const input of ['', '   ', '?', '!!!', '🙂', '12345', 'a']) {
    const result = ask(input);
    assert.ok(['fallback', 'answer', 'choice'].includes(result.kind));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
test('search finds entries by title words', () => {
  assert.ok(search('wifi', entries).includes('wifi'));
  assert.ok(search('colazione', entries).includes('breakfast'));
  assert.ok(search('bagagli', entries).includes('luggage-early'));
  assert.deepEqual(search('a', entries), [], 'a single character is not a search');
});

// ─────────────────────────────────────────────────────────────────────────────
test('every intent points at an entry that exists', () => {
  for (const intent of INTENTS) {
    const targets = [
      intent.entry,
      ...(intent.refine ?? []).map((r) => r.entry),
      ...Object.values(intent.entryByPhase ?? {}),
    ];
    for (const target of targets) {
      assert.ok(getEntry(target), `intent "${intent.id}" points at missing entry "${target}"`);
    }
  }
});

test('every intent anchors and supports on concepts that exist', () => {
  const known = new Set(Object.keys(CONCEPTS));
  for (const intent of INTENTS) {
    for (const concept of [...intent.anchors, ...Object.keys(intent.support ?? {}), ...(intent.blockers ?? [])]) {
      assert.ok(known.has(concept), `intent "${intent.id}" references unknown concept "${concept}"`);
    }
  }
});

test('every intent has at least one anchor', () => {
  for (const intent of INTENTS) {
    assert.ok(intent.anchors?.length > 0, `intent "${intent.id}" has no anchor and could match anything`);
  }
});

test('no lexicon form is made entirely of stopwords', () => {
  const stop = new Set(STOPWORDS.flatMap(formKeys));
  for (const [concept, forms] of Object.entries(CONCEPTS)) {
    for (const form of forms) {
      const keys = formKeys(form);
      assert.ok(keys.some((k) => !stop.has(k)),
        `"${form}" in concept "${concept}" is unreachable: every key is a stopword`);
    }
  }
});

test('question words are not also concepts', () => {
  // The whole false-positive class started with "dove" being scored as a topic.
  const conceptKeys = new Set(Object.values(CONCEPTS).flat().flatMap(formKeys));
  const stop = new Set(STOPWORDS.flatMap(formKeys));
  for (const [type, forms] of Object.entries(QUESTION)) {
    for (const form of forms) {
      for (const key of formKeys(form)) {
        if (key.includes(' ')) continue;  // phrases may legitimately overlap
        if (stop.has(key)) continue;      // filtered out of concept lookup anyway
        assert.ok(!conceptKeys.has(key),
          `question word "${form}" (${type}) is also a concept key and would select a topic`);
      }
    }
  }
});

test('matching never looks inside a word', () => {
  // The structural guarantee behind the whole adversarial block.
  assert.ok(!analyse('biscotti').concepts.has('children'), 'biscotti must not reach `children` via "cot"');
  assert.ok(!analyse('autobus').concepts.has('car'), 'autobus must not reach `car` via "auto"');
  assert.ok(analyse('autobus').concepts.has('publicTransport'));
  assert.ok(analyse('auto').concepts.has('car'));
  assert.notEqual(stem('autobus'), stem('auto'));
});

test('known tokens survive normalisation of accents and punctuation', () => {
  for (const pair of [['perché', 'perche'], ['dov’è', 'dove'], ['CHECK-IN', 'check in']]) {
    const [fancy, plain] = pair;
    const a = keysOf(fancy);
    const b = keysOf(plain);
    assert.ok([...a].some((k) => b.has(k)), `"${fancy}" and "${plain}" should share a key`);
  }
});
