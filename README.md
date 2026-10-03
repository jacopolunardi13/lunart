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
partner.html            one scanner per partner, kept on their home screen
recover.html            a lost guide link, from a surname and a booking number
staff.html              LunArt Staff — orders, reservations, synchronisation
data/                   every fact about LunArt, written once
  schema.js               what an entry is; the sections and guest phases
  property.js             identity, contacts, emergency numbers
  rooms.js                rooms 301–305, and the sixth one we do not publish
  florence.js             recommendations, itineraries, day trips
  entries/*.js            arrival · stay · breakfast · help · departure · florence
  index.js                assembles the above and exposes the lookups
src/
  main.js                 state, routing, event delegation
  i18n.js                 interface strings (content strings live in data/)
  ui/                     views, components, sheet, search, icons
  guest.js                the personal link, resolved — empty without one
  staff/app.js            the Staff app (Italian only: staff are)
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
  stay.js                 what a stay allows: the days, and what fits in them
  schedule.js             the hair professional's hours ← empty on purpose
  availability.js         adapters, real and not-yet-connected
  partners.js             who honours the card, and what comes with the stay
server/
  app.js                  the API and the static site, one origin
  reservations.js         the canonical reservation ← the spine
  ingest/                 quovai-email · quovai-api · ical · mailbox
  guide-link.js           /g/<token>, and giving a lost one back
  delivery.js             when the guest email goes out, and what it says
  staff.js                queues, actions, the sync view
  push.js                 Web Push, and what it does without keys
  calendar/google.js      the hair professional's calendar, as a seam
  card.js · orders.js · stripe.js · store.js · config.js
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
npm test                            # 422 tests, no browser needed
npm run dev &                       # then, in another shell:
npm install --no-save playwright
npm run qa                          # 59 browser checks of the guide
npm run qa:commerce                 # 65 checks: the whole purchase, at phone size
npm run qa:reservations             # 44 checks: personal links, recovery, Staff
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

`npm run qa:reservations` opens a guest's own link and checks the guide greets them
without putting their surname, email or booking number on the page; that the card
offers only lengths that fit inside the stay; that a wrong booking number gets the
same answer as a right one; and that the Staff app's queues, reservations and sync
screen work at phone size with every control thumb-sized. It creates its own
throwaway reservations and cancels them again, so it can be run as often as you like.

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

## Reservations

Everything in here used to be true of any guest. This half knows *which* guest.

A reservation is the spine: one canonical record in `server/reservations.js`, with
a status (`active`, `modified`, `cancelled`, `completed`), the dates, the room, who
is coming and how to reach them. Nothing downstream knows what Booking.com calls a
field — the guide, the emails, the Staff app and the card all read this one shape.

### Where they come from

Four sources, one destination. Whatever arrives becomes a canonical event and goes
through `ingestEvent`, which is the only thing that writes a reservation.

| source | state | what it is |
|---|---|---|
| QuoVai email | **working** | QuoVai already emails LunArt on every booking, change and cancellation. `server/ingest/quovai-email.js` reads them. |
| QuoVai API / webhook | interface agreed, waiting on QuoVai | `server/ingest/quovai-api.js` — the route, the signature check and the open questions, with nothing invented. |
| QuoVai iCal | reconciliation only | `server/ingest/ical.js` — occupancy, not guests. It catches what the email missed. |
| Staff, by hand | working | The fallback, through the same upsert as everything else. |

The email parser is forgiving about everything except meaning: plain text or HTML,
labels matched by alias, `12/10/2026` read as October, `1.240,50 €` read as Italian.
What it will not do is guess — a notification whose booking number or dates cannot
be read is refused with a reason and raised as something staff have to look at,
because a reservation with a plausible wrong date in it is worse than none.

Three rules hold it together:

1. **One reservation per source + booking reference.** That pair is what a
   modification refers to, so it is what the upsert turns on.
2. **Ingestion is idempotent.** The same notification delivered twice is recognised
   and dropped. The expensive duplicate is not a row — it is a second email to a
   guest who already has one.
3. **A cancellation never deletes.** The record stays, with its history, because
   somebody may already have paid for breakfast against it.

### iCal is a safety net, not a source

An iCal feed says a room is occupied between two dates. It has no email address and
usually no name, so treating it as a source would mean inventing a guest. What it is
good for is catching what the email adapter missed: anything in the calendar with no
reservation behind it becomes *occupancy detected but not synchronised* in front of
staff. In the other direction it is timid — an event that disappears raises a
reconciliation alert rather than deleting anything, because OTAs rewrite UIDs and
feeds go stale.

## The personal guide link

Every reservation gets `/g/<token>`: 24 random bytes, opaque, carrying no name, no
room, no dates and no booking number. The server turns it into a reservation; the
browser is told the first name, the room, the dates, how many people and which part
of the stay they are in — and nothing else. These links travel through OTA relay
addresses and into group chats; one that encoded "Venturi, room 303, 12–15 October"
would be telling everyone who ever sees it exactly that.

What the guide does with it: greets the guest, opens on the right moment instead of
asking, fills in the room number, and sells a Privilege Card only for days the guest
is actually here. A cancelled stay still resolves — they may have paid for something
against it — and says so, and nothing new can be bought.

**Lost links** come back from a surname and a booking number at `/recover`. Every
failure gives the same answer, to the letter: a wrong surname, a wrong number, a
cancelled stay and a reservation that never existed are indistinguishable from
outside. Rate limited per address and, more tightly, per surname — which is the axis
somebody guessing moves along.

### When the email goes out

Three days before check-in, at ten in the morning, Florence time. A booking made
inside that window goes out as soon as it can; a modification moves the date and
keeps the link; a cancellation stops an email that has not gone. One delivery per
reservation, because a modification must not produce a second email with a second
link.

Nothing is sent from a preview or a test. The mailer is an adapter, and without one
configured every send is recorded as `simulated` with the body kept — so the whole
path can be read and checked before a single real message leaves. The address used
is whatever the reservation carries, `@guest.booking.com` alias and all: that relay
reaches a real person, and substituting our own guess for it would mean writing to
nobody.

## LunArt Staff

A private app at `/staff`, dark and thumb-sized, built on the same backend as the
guest side rather than beside it. There is one order and one reservation; the Staff
app is a different view of them, not a second system to reconcile at the end of a
shift.

Queues are **derived**, never stored: `new`, `awaiting`, `preparing`, `completed`,
`cancelled` come out of the order's own fulfilment state, so nothing has to be
remembered or cleared. Actions are one function each and money moves only where it
says money: confirm captures a held authorisation, reject releases it, cancel on a
paid order says *the refund is still outstanding* rather than quietly issuing one,
and a refund is called a refund. An unavailable bottle is `substitution-requested` —
staff contact the guest, nothing is swapped silently.

It also carries the reservations (view, edit, cancel, copy or regenerate the guide
link, type one in by hand) and a synchronisation screen that says, per reservation:
imported, guide created, email scheduled, email sent, needs review — plus any
calendar mismatch.

Access is the `STAFF_TOKEN`, entered once and kept on the device. A development
server with no token set lets everything through, which is how the preview works; a
production server with no token refuses the Staff API entirely, because unusable is
the right side of that trade.

**Notifications** are Web Push, and they degrade honestly. With no VAPID keys the
app still works (it polls), subscriptions are still accepted and stored so devices
are registered the moment keys exist, every notification is recorded and marked
`simulated`, and both `/api/health` and the app's own sync screen say push is not
configured. What it must never do is look like it is working.

## Experiences & Extras

The commerce half sells what a guest might actually want during the stay: wine and
breakfast brought to the room, a hairdresser or barber who comes up to the room, a
private transfer, their luggage moved, a room set up for an anniversary, a Privilege
Card. It is deliberately not a separate shop — the guide's own entries link into it,
so "colazione in camera" offers to order one, and nothing hands the guest off to
WhatsApp or to an outside site.

### Setting prices

`commerce/prices.js` is the only file with an amount in it. Each entry carries
its provenance, and the distinction decides what can be sold:

| status | what it means | sellable |
|---|---|---|
| `confirmed` | LunArt has set this | anywhere |
| `placeholder` | a real figure from a real document, not confirmed as ours | only with `ALLOW_PLACEHOLDER_PRICES` |
| `to-configure` | nobody has set a price | never |

`confirmed` today: the Privilege Card (€15 / €25 / €35), the six hair services
(€49–€95), the light breakfast (€49 for two) and the brunch (€69 for two), the
transfer (€90) and its €15 oversized item, the four luggage transfers
(€50 / €60 / €90 / €100), the three celebration set-ups (€129 / €219 / €279), and
the fourteen bottles LunArt has priced for the room.

Still unpriced, and therefore unsellable: the ceremony hairstyle, the sunrise
breakfast, the Chianti day, and the eleven bottles outside the curated list — which
fall back to the carta vini figure as a `placeholder`, a real number from a real
document that nobody has confirmed as ours. They render and say so rather than being
hidden. Nothing was invented: where there was nothing to work from, the entry says so.

Two amounts are **derived** rather than written down. A bottle with no entry in
`WINE_PRICE_OVERRIDES` is priced from the carta; and the two champagne upgrades cost
the difference between the bottle in the package and the one being asked for, so
changing a wine price changes the upgrade with it.

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

**It is sold inside a stay.** The validity cannot run past the dates it was bought
for, and the calendar day of checkout counts in full — a guest leaving on the 13th
has no use for a card that works on the 15th. A stay of 10–13 October therefore
offers the 2-day card starting on the 10th, 11th or 12th, and does not offer the
5- or 8-day ones at all. The server decides this from the reservation behind the
guest's link; the form is only shown what will be accepted.

**It is not on sale while it is empty.** The card is worth exactly what its partners
give, and the Opera Caffè 30% is *not* one of them — that comes with the stay, for
everyone on the reservation, and selling a card to get it would be selling a guest
something they already have. Until a venue has a benefit reserved for the card,
`isPurchasable` returns false and the card renders without a buy button. It comes
back by itself the moment a partner is activated. The preview activates one
obviously-fake venue so the flow can be walked.

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
business. Six services are priced and sellable: men's cut €49, beard €35, both €69,
blow-dry and styling €79, cut and blow-dry €95, evening styling €89.

Three things are deliberately absent. **Colour and highlights** are not offered at
all, so no variant exists for them; the terms name them once, in both languages, to
say they are unavailable. The **ceremony hairstyle** is modelled but `hidden`: it is
filtered out of the published catalogue, so a guest is never shown it, and asking
for it by name is refused. And there is **no wash service** — the guest comes with
clean hair where the service needs it, and the professional damps it down with his
own spray.

Durations are internal. They live in `SERVICE_MINUTES` — beard 30, men's cuts 60,
everything for women 90 — because a calendar needs them to stop two appointments
overlapping. They are never rendered: a guest books a time, not a duration, and
telling them "60 minutes" invites an argument about minute 61.

Booking is service → day → time → cart → Stripe → confirmation, like everything
else. The order records the service, the date, the time, the guest's name, phone,
email and room, the amount, the Stripe ids and an `assignee` field for the
professional once one is named. A paid booking is also written to the provider's
calendar — or, with no calendar connected, the order records that it could not be,
so the appointment is visible to staff rather than lost.

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

`server/calendar/google.js` is the one that matters next: it reads the hair
professional's free/busy and writes confirmed bookings to a calendar of its own
("LunArt Hair Bookings"). Google rather than Apple even though he uses an iPhone —
an Apple Calendar subscribed to a Google account syncs both ways, so he carries on
as he is and the server talks to one API. It is unconfigured, and says so.

### Cut-offs and cancellation

| | order by | cancel until |
|---|---|---|
| Breakfast and brunch | 12:00 the day before | 20:00 the day before |
| Wine in your room | 90 min (orders ≥ €90) or 12 h, before the window ends | 3 h before |
| Private Hair Service | the slot has to be free | 3 h before |
| Transfer, luggage transfer | 12:00 the day before (luggage) | 3 h before |
| Romantic / Signature / Champagne | 12:00 the day before | 12:00 the day before |
| Privilege Card | — | not refundable |

The wine rule is about the **order**, not the bottle: €90 or more in the basket is
an express run at ninety minutes' notice, below it waits for the next day's
delivery. Two bottles together can be express when either alone would not be.
Notice is counted back from the *end* of the chosen window, which is what makes the
stated rule true — ninety minutes before the end of the 21:00–22:00 window is 20:30,
the last moment wine can be ordered for the same evening.

None of this has anything to do with the accommodation booking, whose terms come
from LunArt's own policy — not freely refundable, a date change possible with two
weeks' notice, the difference payable if the new dates cost more — or from the OTA's
contract where there is one. The Concierge answers that from the knowledge layer and
invents no refund rights.

### Configuration

Copy `.env.example` to `.env`. Nothing secret is in the repository. Before this
is used by a real guest:

- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — start with the test keys.
- `CARD_SIGNING_KEY` — without it a random one is generated at boot, which
  invalidates every issued card on every restart.
- `STAFF_TOKEN` — otherwise the Staff app and the provider endpoints are open to
  anyone who can reach them, and a production server refuses them entirely.
- `LUNART_DATA_DIR` — otherwise orders, cards and reservations live in memory and
  are lost on restart.
- `RESERVATION_MAILBOX` — otherwise nobody reads the QuoVai notifications and every
  reservation has to be typed into the Staff app by hand.
- `MAIL_PROVIDER` — otherwise guest guide emails are scheduled and rendered, and
  never sent.
- `QUOVAI_ICAL_FEEDS` — otherwise there is no calendar to reconcile against.
- `VAPID_*` — otherwise the Staff app works but nothing reaches a phone.
- `GOOGLE_CALENDAR_*` — otherwise hair appointments are not written anywhere the
  professional can see, and availability stays manual.

`/api/health` reports all of this, warnings included, and the Staff app's sync
screen says the same thing in Italian to the people who have to act on it.

### Checking the commerce half

```sh
npm run dev &
npm install --no-save playwright
npm run qa:commerce             # the whole purchase, in a browser, at phone size
npm run qa:reservations         # personal links, recovery, and the Staff app
python3 tools/qr-verify.py      # the QR encoder, against two outside implementations
```

`npm run dev` seeds two obviously-invented reservations through the real ingestion
path and prints their personal links, so the whole reservation-aware half can be
walked without a mailbox existing.
