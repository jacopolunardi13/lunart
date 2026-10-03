/**
 * The shape every piece of guest knowledge takes.
 *
 * One entry is written once and rendered twice: as a card plus detail sheet in the
 * Guest Guide, and as an answer from the Concierge. Nothing in `src/` restates a
 * fact — if the guide and the bot ever disagree, that is a bug in rendering, not a
 * content problem to fix in two places.
 *
 * @typedef {{it: string, en: string}} L10n
 *
 * @typedef {object} Fact
 * @property {L10n}   label
 * @property {string|L10n} value
 * @property {boolean} [mono]  render in a monospace face (codes, passwords, SSIDs)
 * @property {boolean} [copy]  offer a copy-to-clipboard affordance
 *
 * @typedef {object} Action
 * @property {'tel'|'whatsapp'|'mailto'|'map'|'url'|'entry'|'product'} kind
 * @property {L10n}   label
 * @property {string} value   phone number, URL, an entry id, or a product id
 *
 * @typedef {object} Verify
 * @property {'blocker'|'confirm'|'volatile'} level
 *   blocker  — a promise to the guest that must be confirmed before publication
 *   confirm  — probably right, worth a glance
 *   volatile — third-party data (hours, prices) that drifts on its own
 * @property {string} note  what exactly to check, in Italian, for the review list
 * @property {string} [field] which field the doubt applies to, when it is not the whole entry
 *
 * @typedef {object} Entry
 * @property {string}   id        stable, kebab-case, referenced by intents and deep links
 * @property {string}   section   one of the SECTIONS ids
 * @property {string[]} phase     guest phases this matters in: 'before' | 'staying' | 'leaving'
 * @property {string}   icon      icon id from src/ui/icons.js
 * @property {L10n}     title
 * @property {L10n}     summary   the answer, in one or two sentences — never a teaser
 * @property {L10n}     [detail]  longer body, shown in the sheet; \n\n separates paragraphs
 * @property {Fact[]}   [facts]
 * @property {Action[]} [actions]
 * @property {string[]} [intents] concierge intent ids that resolve here
 * @property {number}   [priority] lower sorts first within a section; quick actions use < 0
 * @property {Verify}   [verify]
 */

/** The six places a guest looks, in the order the stay happens. */
export const SECTIONS = [
  { id: 'arrival',   icon: 'key',      title: { it: 'Arrivo',        en: 'Arrival' },
    blurb: { it: 'Come entri, dove lasci l’auto e i bagagli.',
             en: 'How you get in, where to leave the car and your bags.' } },
  { id: 'stay',      icon: 'home',     title: { it: 'Il soggiorno',  en: 'Your stay' },
    blurb: { it: 'Wi-Fi, camera, clima e come funziona tutto.',
             en: 'Wi-Fi, the room, climate and how things work.' } },
  { id: 'breakfast', icon: 'cup',      title: { it: 'Colazione',     en: 'Breakfast' },
    blurb: { it: 'Dove, a che ora e cosa chiedere.',
             en: 'Where, when and what to ask for.' } },
  { id: 'help',      icon: 'lifebuoy', title: { it: 'Aiuto',         en: 'Help' },
    blurb: { it: 'Qualcosa non va, o ti serve qualcuno.',
             en: 'Something is off, or you need a person.' } },
  { id: 'departure', icon: 'suitcase', title: { it: 'Partenza',      en: 'Departure' },
    blurb: { it: 'Check-out, bagagli, taxi, aeroporto.',
             en: 'Check-out, bags, taxis, airport.' } },
  { id: 'florence',  icon: 'compass',  title: { it: 'Firenze',       en: 'Florence' },
    blurb: { it: 'Dove mangiare, cosa vedere, dove andare.',
             en: 'Where to eat, what to see, where to go.' } },
];

/**
 * The three moments of a stay. The guide never guesses which one a guest is in —
 * we hold no booking data and a wrong guess hides the one thing they came for.
 * The guest picks, and the choice only reorders; it never removes anything.
 */
export const PHASES = [
  { id: 'before',  title: { it: 'Devo ancora arrivare', en: 'Still on my way' },
    short: { it: 'Arrivo',    en: 'Arriving' } },
  { id: 'staying', title: { it: 'Sono in struttura',    en: 'I’m here' },
    short: { it: 'Soggiorno', en: 'Staying' } },
  { id: 'leaving', title: { it: 'Sto per ripartire',    en: 'About to leave' },
    short: { it: 'Partenza',  en: 'Leaving' } },
];

export const PHASE_IDS = PHASES.map((p) => p.id);
export const SECTION_IDS = SECTIONS.map((s) => s.id);
