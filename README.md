# LunArt — Guest Guide & Concierge

The digital guide for guests who have already booked LunArt: what they need before
they arrive, while they are here, and on the morning they leave. It is not the
commercial site — it exists to answer, in seconds and on a phone, the questions
that otherwise arrive one at a time on WhatsApp.

It comes in two halves. The guide is static files and works on its own. The
commerce half — Experiences & Extras, payments, the Privilege Card — needs the
small Node server in `server/`, and the guide degrades without it rather than
breaking.

```sh
npm run dev        # guide + commerce API on http://localhost:4173
npm run serve      # the static guide alone, no commerce
npm test           # 267 tests
```

`npm run dev` starts with no Stripe key, which runs the built-in checkout
stand-in: the whole purchase works end to end and no money moves. It also enables
the preview price fixtures, so the products LunArt has not priced yet can still be
walked through. Neither is on by default.

## How it is put together

```
index.html              the shell — 3 KB, no content of its own
validate-card.html      the page a venue opens to check a Privilege Card
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
commerce/               what LunArt sells — shared by the browser and the server
  schema.js               availability modes, purchase modes, payment states
  catalog.js              the products
  wine.js                 the carta, and how much notice each bottle needs
  prices.js               every amount, with its provenance  ← edit this one
  prices.dev.js           obviously-fake figures, preview only
  ordering.js             validation and pricing — the authority
  availability.js         adapters, real and not-yet-connected
  partners.js             who honours the card and what they give
  time.js                 cut-offs in Florence time
server/
  index.js                boot
  app.js                  routes, webhook handling, provider decisions
  stripe.js               a small REST client, and the stand-in
  card.js                 issuing, rotating codes, validation
  orders.js               order shape, state transitions, fulfilment
  store.js                where orders and cards live
  rate-limit.js           ceilings on validation and checkout
src/commerce/           the shop, the cart, the card screen
  qr.js                   a QR encoder, verified against two outside implementations
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
npm test                            # 267 tests, no browser needed
npm run serve &                     # then, in another shell:
npm install --no-save playwright
npm run qa                          # 59 browser checks of the guide
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

## Experiences & Extras

The commerce half sells a few things a guest might want during their stay: wine
and breakfast brought to the room, a hairdresser or barber who comes up to the
room, a private transfer, a Privilege Card. It is deliberately not a separate
shop — the guide's own entries link into it, so "colazione in camera" offers to
order one, and nothing hands the guest off to WhatsApp or to an outside site.

### Setting prices

`commerce/prices.js` is the only file with an amount in it. Each entry carries
its provenance, and the distinction decides what can be sold:

| status | what it means | sellable |
|---|---|---|
| `confirmed` | LunArt has set this | anywhere |
| `placeholder` | a real figure from a real document, not confirmed as ours | only with `ALLOW_PLACEHOLDER_PRICES` |
| `to-configure` | nobody has set a price | never |

`confirmed` today: the transfer (€90), the Privilege Card (€15 / €25 / €35 for 2,
5 and 8 days) and the six hair services. Wine is priced from the carta vini bottle
column and brunch from Opera Caffè's per-head rate — both real numbers, neither
confirmed as what LunArt charges in the room. The light breakfast, the celebration
set-up, the Chianti day and the ceremony hairstyle have no figure at all, so they
render and say so rather than being hidden. Nothing was invented: where there was
nothing to work from, the entry says so.

Wine does not need a line per bottle. A bottle is priced from the carta unless it
appears in `WINE_PRICE_OVERRIDES`.

### Money is never the client's to name

A cart line is ids, quantities and dates. `sanitiseLine` reduces an incoming
payload to those fields before anything reads it, so a request carrying `amount`,
`price`, `total` or a doctored `sku` loses them on the way in. The server derives
the SKU from the catalogue and prices it there, and builds the Stripe Checkout
Session from its own figures. Payment Links are not used, because a Payment Link
is a price the client gets to choose.

### Payments

```
guide → cart → server validation → Checkout Session → payment → webhook → order
```

Two statuses per order, because they diverge. `status` is about money —
`pending`, `authorized`, `confirmed`, `paid`, `cancelled`, `refunded`, `failed`.
`fulfilment_status` is about the thing. A transfer sits at `authorized` /
`awaiting-confirmation` for hours.

The transfer uses manual capture:

1. The guest checks out; Stripe **authorises** €90 and takes nothing.
2. The order waits at `authorized` / `awaiting-confirmation`, and the guest is
   told so in those words.
3. `POST /api/provider/orders/:id/confirm` **captures** it → `paid`.
4. `POST /api/provider/orders/:id/decline` **cancels the authorisation** →
   `cancelled`, and the guest is never charged.

If an authorisation cannot be captured — some payment methods will not hold one,
and an authorisation lapses after about a week — the fallback is charge and, if
wrong, refund. It is the worse path, only taken when the better one is
unavailable, and it is recorded on the order.

Webhooks are verified with a timing-safe compare and a timestamp tolerance, every
write carries an idempotency key, and each event id is processed once. Stripe
retries; discovering that by issuing a second Privilege Card is not acceptable.

### The Privilege Card

€15 for two days, €25 for five, €35 for eight. One card covers the holder and one
companion — `max_people` is 2 on the record, not a sentence in a description.

**What the guest sees.** The LunArt mark, LUNART PRIVILEGE CARD, their name,
*valid for 2 guests*, the dates, the QR, Active or Expired, and a *your
privileges* list naming each partner and what that partner gives them. Nothing
else. No countdown, no timer, no code to read out, no "updates in 30s", no word
about tokens or expiry — to the guest this is simply the official QR of their
card, and it is meant to feel like one.

**What is actually happening.** A static QR is a bearer token with no expiry:
screenshot it and the holder is whoever has the screenshot. So the card lives on
the server and the phone shows a short-lived proof derived from it — an HMAC over
the current time window, carrying nothing readable. The screen refreshes itself
quietly, the way a banking app refreshes a balance. The payload sent to the
browser is the QR and a number of seconds after which to ask again: the window,
the period, the expiry and the code itself never leave the server, so there is
nothing for a curious guest, or a screenshot, to find. An expired or revoked card
fails whatever the phone is displaying.

**No usage limits.** The card is a membership, not a voucher book. There is no
counter, no one-a-day, no "benefit used", no button for a waiter to press: a card
scanned twice in an evening is valid twice, and each partner applies its own
conditions. The server keeps no ledger of spent codes, by design — the rotation is
the protection, and counting would only add a way to lock a paying guest out.

**How a venue checks it.** Each partner has its own page, `/partner/<partner_id>`,
which works in Safari and Chrome with nothing installed and is meant to be kept on
the home screen — it serves its own web manifest, so it opens full-screen with the
venue's name on it. The venue scans; it gets a green **CARD VALID** with the
holder, *valid for 2 guests*, the dates and *its own* benefit, or a red **CARD NOT
VALID** with one reason: expired, revoked, not yet valid, invalid code. No
technical detail either way. Where the browser has no barcode reader the page says
to use the phone's own camera — the QR is a URL — and there is a typed
`REF-CODE` fallback for a dead camera. No login, and the guest is never asked for
a document.

`commerce/partners.js` is the register: `partner_id`, `name`, `category`
(restaurants, bars, nightlife, spa, beauty, experiences, other), `active`, the
benefit in IT and EN, its kind (percentage, amount, special price, included item,
guest list, other) and internal `notes` that stay on the server. Benefits differ
per partner; nothing assumes a house discount. Only Opera Caffè is live — 30% off
the table — and the rest of the file is inactive shapes marked `example: true`, to
be filled in as agreements are signed.

### Private Hair Service

A hairdresser or barber in the guest's own room, from the Clippylia side of the
business. Six services are priced and sellable: men's cut €50, beard €35, both
€70, blow-dry €70, cut and blow-dry €95, evening styling €90. Colour and
highlights are deliberately not offered — the terms say so in both languages — and
the ceremony hairstyle is in the catalogue as `pending`, rendering as a disabled
choice until the provider confirms it.

Booking is service → day → time → cart → Stripe → confirmation, like everything
else. The order records the service, the date, the time, the guest's name, phone,
email and room, the amount, the Stripe ids and an `assignee` field for the
professional once one is named.

The slots come from `commerce/schedule.js`, which **ships empty on purpose**.
Nobody has given us the professional's hours, so the guide offers no days, and the
service says it has no appointments rather than showing a plausible grid. Fill
`MANUAL_SCHEDULE` and the days appear; remove a slot when it is sold, or it can be
sold twice. The server publishes the schedule in force through `/api/catalog`, so
the times the guide offers and the times the server will accept are one list
instead of two that drift — and a slot that is not on it is refused at checkout
with `slot-unavailable`, whatever the browser sends.

### Availability

`commerce/availability.js` is a registry. `always`, `cutoff`, `timeslots`,
`manual`, `manual-confirm` and `request` are real and decide things today;
`timeslots` reads `commerce/schedule.js`. Google Calendar, provider
calendars, partner APIs and booking engines are registered as unconfigured seams
that report themselves as such — an adapter inventing plausible slots would be
worse than one admitting it is not connected. `/api/health` lists which is which.

### Configuration

Copy `.env.example` to `.env`. Nothing secret is in the repository. Before this
is used by a real guest:

- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — start with the test keys.
- `CARD_SIGNING_KEY` — without it a random one is generated at boot, which
  invalidates every issued card on every restart.
- `STAFF_TOKEN` — otherwise the provider confirm/decline endpoints are open to
  anyone who can reach them, and a production server refuses them entirely.
- `LUNART_DATA_DIR` — otherwise orders live in memory and are lost on restart.

`/api/health` reports all of this, warnings included.

### Checking the commerce half

```sh
npm run dev &
npm install --no-save playwright
node tools/qa-commerce.mjs     # the whole purchase, in a browser, at phone size
python3 tools/qr-verify.py      # the QR encoder, against two outside implementations
```
