# LunArt — Guest Guide & Concierge

The digital guide for guests who have already booked LunArt: what they need before
they arrive, while they are here, and on the morning they leave. It is not the
commercial site — it exists to answer, in seconds and on a phone, the questions
that otherwise arrive one at a time on WhatsApp.

Open `index.html` through any static server. There is no build step.

```sh
npm run serve      # http://localhost:4173
npm test           # 152 unit tests
```

## How it is put together

```
index.html              the shell — 3 KB, no content of its own
data/                   every fact about LunArt, written once
  schema.js               what an entry is; the sections and guest phases
  property.js             identity, contacts, emergency numbers
  rooms.js                rooms 301–306
  florence.js             recommendations, itineraries, day trips
  entries/*.js            arrival · stay · breakfast · help · departure · florence
  index.js                assembles the above and exposes the lookups
src/
  main.js                 state, routing, event delegation
  i18n.js                 interface strings (content strings live in data/)
  ui/                     views, components, sheet, search, icons
  concierge/
    normalize.js            folding, stemming, n-grams
    lexicon.js              concepts, question words, stopwords
    intents.js              what can be asked, expressed over concepts
    engine.js               scoring, confidence, fallback
    ui.js                   the chat panel
assets/
  css/app.css             mobile-first, no !important
  css/fonts.css           self-hosted variable fonts
  img/_src/               original photographs (never served)
  img/                    generated 400/700/1024 WebP + 800 JPEG
test/                   concierge behaviour and data integrity
tools/                  preview server, image pipeline, QA, measurement
```

### One source of truth

Before this rewrite the same fact lived twice — once in the HTML body and once in
the chatbot's keyword table — and the two had already drifted: the page and the bot
gave different accounts of check-in. Now an entry in `data/` is written once and
rendered twice, as a card in the guide and as an answer from the Concierge. If they
ever disagree it is a rendering bug, not a content problem to fix in two places.

`test/data.test.mjs` enforces the parts a human cannot keep track of: every entry is
complete in both languages, every link resolves, every photograph a room claims is
on disk, and no two entries restate each other.

## Changing the content

Almost everything is a content change, not a code change.

**Correct a fact** — edit the entry in `data/entries/`. It updates the guide, the
search index and the Concierge at once.

**Add something a guest asks about** — add an entry, give it an `intents` array, and
add the matching intent in `src/concierge/intents.js`. If guests use a word the
lexicon does not know, add it to the right concept in `src/concierge/lexicon.js`;
you will rarely need a new concept.

**Add a restaurant or a museum** — add it to `places` in `data/florence.js` and list
its id on the relevant entry in `data/entries/florence.js`.

**Add a photograph** — drop it in `assets/img/_src/<folder>/`, run `npm run images`,
and reference it by path without the size suffix (`rooms/302-camera`).

**Flag something you are not sure of** — give the entry a `verify` block. It stays in
the guide, and appears on the review screen and in the handover list instead of
holding the work up:

```js
verify: { level: 'blocker', note: 'Confermare con il garage la finestra per la targa.' }
```

`blocker` is a promise to the guest that must be confirmed before publication,
`confirm` is probably right and worth a glance, `volatile` is third-party data that
drifts on its own. Open `?review=1` to see every flag in context — guests never see
this screen.

## The Concierge

Deterministic and offline. No model is called, nothing costs anything to run, and
every answer is a row from `data/` — so it cannot invent. When it is not confident
it says so and offers a person, which is the behaviour we want far more than a
confident wrong answer.

The previous assistant matched with `query.includes(keyword)` over raw text, which
let a keyword match the middle of an unrelated word:

| asked | old answer | why |
|---|---|---|
| avete biscotti? | baby cots | `cot` sits inside "bis**cot**ti" |
| quale autobus prendo? | parking | `auto` sits inside "**auto**bus" |
| dove posso cenare? | the street address | `dove` was scored as a keyword |
| si può fumare in camera? | the rooms | `camera` outscored the question |

The smallest unit of comparison is now a whole token, so no word can match inside
another. On top of that: concepts instead of loose keywords, question words kept
apart from topics, intents that must match an *anchor* concept to be considered at
all, weights scaled by inverse document frequency over the intent table, explicit
blockers for what a word rules out, and a stopword list. Two close candidates
produce a question rather than a guess.

Every case in the table above is a test, along with nine further collisions built
the same way and ten questions that must be declined.

## Checking a change

```sh
npm test                            # 152 unit tests, no browser needed
npm run serve &                     # then, in another shell:
npm install --no-save playwright
npm run qa                          # 59 browser checks
npm run measure -- http://localhost:4173/ "v2"
```

`npm run qa` drives a real browser and checks the things that were actually broken
before, plus the ones easy to break next time:

- three phone widths (360 / 390 / 430) for overflow, the navigation staying in the
  viewport, tap targets, alt text and console errors;
- WCAG AA contrast for every visible text node across all three views, with the
  hero caption measured against its scrim over white;
- the room slider — tapping the third dot must show the third photograph, which is
  exactly what the old one got wrong;
- the Concierge declining "avete biscotti?" and answering "dove posso cenare?"
  about dinner rather than the street address;
- Italian, phase switching, deep links, the review screen, the desktop layout,
  copy-to-clipboard, and the guide still rendering with the network switched off.

Screenshots land in `tools/.qa-screens/`.

## Weight

| | before | after |
|---|---|---|
| first load on a phone | ~1.87 MB | ~155 KB |
| requests | 1 | 31 (HTTP/2, cached after first visit) |
| first contentful paint | ~470 ms | ~50 ms |

The old page carried 25 base64 JPEGs inside the HTML — 1.83 MB of the 1.9 MB file,
re-downloaded in full on every visit, with no way to serve a smaller image to a
phone. Photographs are now real files with responsive variants: about 7 KB each at
phone width. Fonts are self-hosted, so the guide makes no third-party request at
all.

## Deploying

Static files; anything that serves a directory will do. The service worker and
manifest are enhancements — if registration fails, every page still loads.

Two things to do when publishing:

1. Work through the `?review=1` list. Nothing marked `blocker` should go out
   unconfirmed.
2. Bump `CACHE` in `sw.js` so returning guests get the new version.
