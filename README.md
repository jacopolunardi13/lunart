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
  partners.js             who honours the Pass, what each gives, and who may use it
server/
  app.js                  the API and the static site, one origin
  reservations.js         the canonical reservation ← the spine
  google.js               OAuth and service-account tokens, cached
  ingest/                 quovai-email · quovai-api · ical · mailbox · gmail
  mail/gmail.js           sending the guide email as LunArt
  guide-link.js           /g/<token>, and giving a lost one back
  delivery.js             when the guest email goes out, and what it says
  staff.js                queues, actions, the sync view
  push.js                 Web Push, over the web-push library
  calendar/               the hair professional's free/busy and bookings
  scheduler.js            the interval jobs, never overlapping
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
npm test                            # 463 tests, no browser needed
npm run dev &                       # then, in another shell:
npm install --no-save playwright
npm run qa                          # 59 browser checks of the guide
npm run qa:commerce                 # 65 checks: the whole purchase, at phone size
npm run qa:reservations             # 46 checks: personal links, recovery, Staff
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

One thing to do when publishing: work through the `?review=1` list. Nothing marked
`blocker` should go out unconfirmed.

### Why a redeploy now reaches returning guests

`sw.js` used to serve everything that was not the API from the cache first, on the
reasoning that the files only change when the guide is republished. That reasoning
has a hole in it, and a guest fell through it: the guide *was* republished and a
phone that had visited before kept running the old one. Nothing had broken — the
cache was answering and the network was never asked.

The hole is that `src/main.js` and `assets/css/app.css` are not content-addressed.
Their names never change, so a cached copy and a deployed copy are indistinguishable
by URL. A build step with hashed filenames would fix it; this project deliberately
has no build step, so the service worker carries the distinction instead:

| | strategy | why |
|---|---|---|
| `/api/…` | **never cached, at all** | a cached price is a figure shown as current when it is not |
| documents, JS, CSS, manifest | network first, 3.5 s deadline | these are the guide itself; a guest must never be stuck on an old one |
| images, fonts | cache first | `…-700.webp` is the same photograph forever |
| anything unclassified | network first | a stale guide is worse than a slow one |

The deadline matters as much as the order: hotel Wi-Fi that is technically connected
and practically not would otherwise be a spinner, so the cache answers after 3.5
seconds. Offline still works — that is what the file is for — and a personal link
falls back to the guide page rather than to nothing.

Bumping `CACHE` is no longer a release step for freshness; it is how a browser still
holding an older *strategy* is retired, which `activate` does by deleting every
cache but the current one. `test/cache.test.mjs` runs the real `sw.js` in a
simulated worker scope and drives it with fetch events, because reading the file is
not how you find out what it does with one.

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
| QuoVai iCal | safety net, awaiting feed URLs | `server/ingest/ical.js` — occupancy, not guests. It catches what the email missed and holds it as a provisional stay. |
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
4. **A reservation can start life incomplete.** See the safety net below: a stay
   held from a calendar is filled in by the notification that arrives later, in
   place, rather than filed beside it.

### Three jobs that look alike and are not

The mailbox is read three different ways, and the difference is the one thing that
matters: what each is allowed to do to a reservation that already exists.

| | what it does | creates? | run by |
|---|---|---|---|
| **poll** | keeps up with what arrives: recent mail, every few minutes | yes | the scheduler |
| **backfill** | recovers what was never seen: a year of mail, in pages | yes | staff, on demand |
| **repair** | corrects what was seen badly: re-reads with a better parser | **no** | staff, on demand |

The backfill exists because the poll's window is right for keeping up and useless
for starting. A booking made in September for an October stay had its notification
arrive weeks ago; the window has long since slid past it, and nothing else will ever
bring it back. It goes through the same idempotent pipeline as the poll — so running
it twice creates nothing the second time, reissues no guide link and schedules no
second email — and it applies messages **oldest first**, because a booking made,
changed and cancelled over three weeks has three notifications and the wrong order
leaves a cancelled stay looking live. The repair, by contrast, never creates and
never moves a date: see `server/ingest/repair.js`.

Each of the three reports separately on the Staff app's sync screen, with its own
last success, last error and counts. That is not tidiness: rolled into one green
tick, "the backfill has never run" is invisible, and it is exactly the thing an
operator needs to know. The state is kept in the store rather than in the
scheduler's memory, because the question is usually asked just after a deploy.

### iCal is a safety net, not a source

An iCal feed says a room is occupied between two dates. It has no email address and
usually no name, so treating it as a source would mean inventing a guest — and a
guest invented from a calendar entry is a guest nobody can email.

But an alert is not enough either. A stay in the calendar with nothing behind it
means somebody is arriving and LunArt has no reservation, no Pass and nothing to
sell them. So the feed does create something: a **provisional** reservation holding
exactly what the feed really said — dates, room, and a booking number only if one
was actually written down — and admitting the rest is missing. No name, no email, no
telephone number, no channel, no invented booking number. The record carries
`provisional: true` and the feed's UID, and the Staff app shows it under *Dati
ospite da completare*.

Two guarantees make that safe to do:

- **Nothing is sent.** A provisional reservation never schedules a guest email. The
  check is in `scheduleGuideEmail`, not at each call site, so a half-known stay can
  be created freely and the one irreversible act still cannot happen by accident.
- **Nothing is doubled.** When the QuoVai notification arrives it *fills this record
  in* — same id, same guide token, same orders, same Pass, same Privilege card —
  instead of filing a second stay. Matching runs strongest-first: the booking
  number, then the room over the same nights, then the room on the same arrival day.
  **More than one candidate is not a match**: an ambiguous merge would attach a
  guest to somebody else's stay and everything bought against it, so two candidates
  means a person decides and both are named in the alert.

In the other direction it stays timid. An event that disappears cancels nothing —
OTAs rewrite UIDs, feeds truncate, caches go stale — it raises a warning saying so
and a person decides.

Nothing here assumes what a QuoVai export looks like. `inspectIcal` reads a feed and
reports its shape — which properties it uses, how many events, whether a booking
number or a room is anywhere in them — and the Staff app's "Esamina i feed" button
runs it without writing anything. That is the right first thing to do with a URL
nobody has seen yet, and it is why the architecture is finished while the feed URLs
are still outstanding.

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

## The outside systems

Four of them, all implemented, each waiting only on a credential. None of them is a
stub: the code paths are real and tested against scripted responses, including the
awkward ones — a token that expires mid-call, a 500, a dead push endpoint, a
calendar that cannot be read.

| | what it does | waiting on |
|---|---|---|
| **Gmail mailbox** | reads QuoVai's notifications and ingests them | a refresh token for the LunArt inbox |
| **Gmail sending** | sends the guide email from `lunartfirenze@gmail.com` | the same credentials, plus `gmail.send` |
| **Web Push** | notifies the Staff app's phones | a VAPID key pair |
| **Google Calendar** | free/busy for the hair service, and writes bookings | a service account and two shared calendars |

`/api/health` reports each one as `operational`, `credentials-missing`, `unavailable`
or `disabled`, which are four different problems with four different fixes:
somebody fills in a variable, somebody waits for Google, or somebody turns an
interval on. `GET /api/staff/checks` probes them live, which costs a call each.

### Reading the mailbox

OAuth with the account's own refresh token, because a personal Gmail inbox cannot
be reached by a service account. The poll lists with `GMAIL_QUERY`, follows the page
tokens, fetches each body, and hands the normalised messages to the same parser the
fixtures use.

Two orderings matter. Messages are processed **oldest first**, so a NEW arrives
before the MODIFIED that follows it. And a message is marked processed **only after**
it has been ingested — a message that could not be fetched, parsed or stored is left
exactly where it was, and the next poll sees it again. The labelling is an
optimisation; the store's de-duplication on the message id is what makes it correct,
which is why polling twice produces one reservation and one email.

### Sending

The guide email leaves as a `multipart/alternative` built here, from LunArt's own
address, through the Gmail API. A send that fails throws, which records the delivery
as `failed` with the reason — and a failed delivery is **due again** on the next run,
up to five attempts, after which it stops and shows up as a problem on the Staff
app's sync screen. Without credentials every send is simulated, the body is kept,
and `MAIL_PROVIDER=gmail` with no token falls back to simulated rather than failing
every send in a way nobody notices.

### Push

`web-push` does the encryption — ECDH, HKDF, AES-GCM, the signed JWT — because that
is exactly the kind of thing not to write by hand. What is written here is the
policy: a 404 or a 410 means the browser dropped the subscription and it is deleted;
anything else means the push service is having a bad morning and the device is kept.
A notification that fails never fails the order it was about.

### The hair calendar

Free/busy only: blocks of time with no titles and no guests, which is all that is
needed and the least that can be asked for. Reading his actual events would mean
reading his life.

The important property is the direction. The calendar **only ever removes**: the
hours a guest can book come from `commerce/schedule.js`, and free/busy takes away
the ones he is already committed to. "Not busy at 04:00" is not an offer.

Browsing and paying then part company, deliberately:

| | calendar free | calendar busy | calendar unreadable |
|---|---|---|---|
| **browsing** | the time is offered | the time is hidden | the schedule stands, with a note that it is unconfirmed |
| **checkout** | sold | `slot-taken` | **refused** — `availability-temporarily-unavailable`, nothing charged |

Showing a tentative time and charging for it are different promises. Once a real
calendar is configured, the only way money moves on an appointment is to have just
confirmed it against free/busy — because selling an unverified hour means the
professional arriving to a room already booked, a refund, and a guest given a time
that never existed. Asking them to try again in a minute costs far less than that.
Nothing is written and no Stripe session is created; the guest is told, in their own
language, that availability could not be checked, and staff get an alert, because a
booking refused this way is a lost sale somebody should see.

With no calendar configured nothing changes: the schedule is the whole truth.

Appointments are written to a calendar of LunArt's own, in Europe/Rome, as long as
the internal service duration says (beard 30, men's cuts 60, everything for women
90). Checkout re-checks free/busy before taking money, so a slot that filled up
between choosing and paying is refused rather than double-booked.

### The loops

`server/scheduler.js` runs four jobs: read the mailbox, send what is due, reconcile
the calendars, retire finished stays. Each has its own interval, and each is off
unless its interval is set.

- **Never overlapping.** A job already running is not started again — two Gmail
  polls at once is the one way past the de-duplication.
- **Backoff.** Consecutive failures double the wait, up to eight ticks. A mailbox
  that is down does not need asking every minute.
- **Nothing is lost.** A failed run changes nothing; the next one does the work.
- **It says what it did.** `/api/health` and the Staff app show last run, last
  success, last error, consecutive failures, and whether it is running right now.
  Each can also be run by hand from the Staff app.

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

### The Pass, and the artwork it wears

Every reservation has a LunArt Pass, derived from the stay on every read and never
stored. It wears **"Il movimento e la stratificazione di Firenze nel tempo"** —
LunArt's own commissioned painting, an abstract of the city as material, light and
flow rather than as a view of it.

The card is built the way the painting is: pale ground, **dark ink**, nothing covering
the work. The guest's name takes the top-left, the room, dates and state the bottom,
the mark the top-right, and the middle — the diagonal, the gold, the teal — is left
alone.

| | |
|---|---|
| **source** | `assets/img/_src/pass/lunart-opera.jpg` — a 1152 × 745 window on the painting, unaltered |
| **served** | `assets/img/pass/lunart-opera-{700,1024}.webp`, built by `node tools/optimize-images.mjs`. A phone takes the 1024, which is 134 KB |
| **framing** | `background-position: 50% 0%`, `cover` |
| **fallback** | `assets/img/_src/_archive/pass/lunart-voucher.jpg` — the breakfast voucher the card wore before, kept as a source rather than as four unused files in every deployment |

**Why this crop.** 295 crops were scored on four things: how much scrim the type
would need, how alive the crop is away from the type, whether the diagonal survives,
and whether all three colour families (stone, water, gold — the three the artist's
note names) are present. The purely numerical winners were tight crops of pale haze:
legible and dead. The crop in use keeps the diagonal reading as flow, puts the orange
burst and the gold drips right of centre, and leaves calm exactly where the name and
the details sit. It was chosen by rendering four candidates in the real component and
comparing, not by the score.

**Why the mark is on the card.** The voucher's painting had the LA lock-up at its
centre, so the card deliberately did not repeat it. This painting is an abstract and
carries no mark — deliberately not a view, not a monument, not a signature — so
without it the card is a beautiful rectangle with a stranger's name on it. It is the
same file the header uses.

**The washes.** No crop of this painting is legible bare: it runs from near-white to
near-black inside a few hundred pixels, so every text zone contains both ends. Two
gradients raise its value under the name and under the details and fade out before
they reach the middle. They are declared once, in `:root`, with the card ink — both
were written out three times, and raising them for this artwork fixed one copy,
missed the second, and left the venue card thin. `test/assets.test.mjs` now fails if
either is declared twice.

**One artwork, three faces.** Privilege is not a different card: the same painting
with a gold edge doubled by an inner hairline, a few percent of gold in the top
corner, and the tier chip. The card a venue is shown wears it too.

**Contrast over an image cannot be checked from CSS**, so `npm run qa:pass` doesn't
try. It hides the type, photographs each card as the browser actually painted it, and
measures every line against the **worst** pixel in its own box — computing the ratio
against every pixel and keeping the lowest, which is correct whether the type is
light on dark or dark on light. All three faces are measured. The weakest line on any
of them is 4.60:1.

That check has now found seven real defects that every colour-reading test had passed:
the brand mark at 1.1:1 over bright sky; the status line pushed off the bottom edge;
`.pass--privilege::after` replacing the whole scrim with a gold wash; a gold chip on a
gold plate; a long Italian status sentence wrapping and pushing the dates onto the
black foot of the old mark; and, on this artwork, two of the three duplicated wash
declarations going stale.

### The header mark

`assets/img/brand/lunart-wordmark.svg` is LunArt's own mark, traced from the artwork
LunArt supplied rather than redrawn. `tools/make-brand-mark.mjs` does the trace and
**refuses to write the file** if its own output, rasterised back at the source's size,
differs from the source by more than 0.1% of pixels — a mark that is nearly right is a
different logo. The last build came in at 0.031%, which is the antialiasing on the
edges. See `assets/img/brand/README.md` for the source, the build and what a
replacement has to be.

Rebuilding it needs two build-only tools, which are not in `package.json` for the
same reason Playwright is not — they make an asset once and never run on a phone:

```sh
npm install --no-save potrace playwright
node tools/make-brand-mark.mjs --force
```

`src/ui/brand.js` loads it off-document and only puts it in the header once it has
decoded, because this server answers `200 text/html` for any unknown path: a missing
image does not arrive looking like a 404, it arrives looking like a web page, and an
`<img>` in the markup would put that in the header of every guest's first paint. If
the file ever goes missing the typographic wordmark in `index.html` takes over and
nothing breaks.

### The Privilege Card### The Privilege Card

€15 for two days, €25 for five, €35 for eight. One card covers the holder and one
companion — `max_people` is 2 on the record, not a sentence in a description.

**It is sold inside a stay.** The validity cannot run past the dates it was bought
for, and the calendar day of checkout counts in full — a guest leaving on the 13th
has no use for a card that works on the 15th. A stay of 10–13 October therefore
offers the 2-day card starting on the 10th, 11th or 12th, and does not offer the
5- or 8-day ones at all. The server decides this from the reservation behind the
guest's link; the form is only shown what will be accepted.

**It is not on sale while it is empty.** The upgrade is worth exactly what its
partners give, and the Opera Caffè 30% is *not* one of them — that comes with the
stay, for everyone on the reservation, and selling a card to get it would be
selling a guest something they already have. Until a venue has a benefit reserved
for the card, `isPurchasable` returns false and the product renders without a buy
button; it comes back by itself the moment one is.

That rail is still live and it is now satisfied: **Le Firme** (10% off, Via Il
Prato 49R) and **Blue Velvet** (guest-list entry at no more than €15 per person
with a drink, and 20% off tables, Via del Castello d'Altafronte 14R–16R) are real
venues with benefits reserved for Privilege, so the product is purchasable in
production with nothing else relaxed — the prices are still `confirmed`, and a
server whose register lost them would withhold it again. The obviously-fake
preview partner that used to make the flow walkable has been retired with it: the
register is the same in every environment.

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

`commerce/partners.js` is the register, and it is data: adding partner number
twenty is adding a record, not writing a component. A partner carries
`partner_id`, `name`, `category` (restaurants, bars, nightlife, **shopping**, spa,
beauty, experiences, other), `active`, an `address` and an opt-in `directions`
flag, an `eligibility` rule, a list of `benefits`, and internal `notes` that stay
on the server. A benefit carries `benefit_id`, `kind` (percentage, amount, special
price, included item, guest list, other), a `headline` and `subline` in IT and EN,
an optional `description`, `note`, `cap` and short `emphasis` token. Benefits
differ per partner; nothing assumes a house discount.

**One partner, many benefits.** Blue Velvet is the proof: the capped entry and the
table discount are two things a guest claims on two different nights, so they are
two records and a venue's scanner is shown both.

**Eligibility is structured, not prose.** A rule is
`{ passState, entitlementsAll }`, and a guest may use a benefit when the Pass is in
that state *and* the reservation carries every entitlement named. Both halves
matter: a live Pass with nothing bought gets the stay's benefits and finds the
Privilege ones locked, and an upgrade bought a month before the stay claims
nothing until the stay starts. The time half comes from `passState()` in
`server/pass.js` — the one place in the codebase that knows what day it is in
Florence — and the entitlement half from `entitlementsOf(card)`. `inclusion`
(`stay` vs `card`) is *derived* from the rule rather than written beside it, so the
two cannot drift.

**A guest without the upgrade still sees it.** `#/pass` lists the Privilege
partners for everybody: unlocked for a guest who bought it, dimmed and marked
*Disponibile con LunArt Privilege* for a guest who has not, with the ordinary
product sheet as the way to get it. A benefit nobody can discover sells nothing.

**The Shopping add-on is modelled and not sold.** `ENTITLEMENTS.shopping` exists so
that moving a future retail partner behind a paid add-on is one line of data —
`entitlementsAll: ['privilege', 'shopping']` — and `card.add_ons` is the seam for
buying it on the same card. Nothing writes it: no product, no SKU, no price, no
checkout path, and no partner is behind it. Le Firme is a plain `privilege`
partner and stays one until that decision is actually taken.

The rest of the file is inactive shapes marked `example: true`, to be filled in as
agreements are signed.

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
stated rule true — ninety minutes before the end of the 20:00–21:00 window is 19:30,
the last moment wine can be ordered for the same evening. Nothing LunArt carries to
a room goes up before 09:00 or after 21:00, and every delivery window in the
catalogue sits inside those hours.

#### The guest cancels it themselves

A brunch no longer wanted at nine on Wednesday evening should not require finding
somebody, so the guest can call a line off from their own order sheet. The rule is
already written down — each product's `cancellation` in `commerce/catalog.js` — and
that rule is the only thing consulted:

- the **policy** comes from the catalogue, never from the order row, because terms
  copied into a row in September are terms nobody can correct in October;
- the **deadline** is that policy applied to the line's own date and slot, at the
  server's clock in Florence;
- the **amount** is the line's stored amount, which the server priced.

The request carries two things and nothing else: which line, and how many of it. An
amount in the payload is read by nobody. See `commerce/cancellation.js` for the
shared calculation — the browser uses it to decide whether to draw a button, the
server runs it again before any money moves — and `server/cancellation.js` for the
settlement.

What happens to the money depends on where it is, and the guest is told which:

| the order is | calling a line off | what the guest is told |
|---|---|---|
| paid | partial refund for that line | "ti rimborsiamo €49" |
| authorised, nothing left | the hold is released | "non ti è stato addebitato nulla" |
| authorised, something left | the order's amount comes down and the capture asks for less | the same |
| pending | nothing to undo | — |

A hold cannot be made smaller, only captured for less, which is why cancelling one
leg of a two-leg transfer reduces the order rather than dropping and re-taking an
authorisation on a card that might then decline.

Cancellation is **per line**, and the mixed order is the case that matters. A €69
brunch and a €15 Privilege Card are one payment and two entirely different
promises: the brunch can be called off until eight the evening before, the Card
cannot be called off at all, and refunding the brunch leaves the Card valid with its
entitlement untouched. The order only becomes `refunded` when the last cent of it
has gone back — marking the whole order refunded would be the shortest route to
revoking a card somebody paid for.

Every cancellation writes a ledger entry on the line: how many units, how much came
back, who asked (`guest` or `staff`), when, and Stripe's own reference for
reconciliation. The guest never sees a Stripe id. Idempotence comes from that ledger
rather than from a lock: a second identical request finds the units already gone and
is refused, and the Stripe idempotency key carries the same count, so a retry that
does reach Stripe cannot refund twice. A refund Stripe refuses writes nothing at
all — the line stays the guest's to cancel, which is the only safe way for it to
fail. Staff see what the guest did on the dashboard and on the order itself.

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
- `RESERVATION_MAILBOX=gmail` plus `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` /
  `GMAIL_REFRESH_TOKEN`, and `RESERVATION_POLL_MINUTES` to turn the loop on —
  otherwise nobody reads the QuoVai notifications and every reservation has to be
  typed into the Staff app by hand.
- `MAIL_PROVIDER=gmail` (same credentials, plus the `gmail.send` scope) and
  `DELIVERY_POLL_MINUTES` — otherwise guest guide emails are scheduled and rendered,
  and never sent.
- `QUOVAI_ICAL_FEEDS` plus `ICAL_POLL_MINUTES` — otherwise there is no calendar to
  reconcile against, and the safety net under the mailbox is not there. Format is
  `301:https://…,302:https://…`, one export per room. **This is the one value LunArt
  is still waiting on from outside**: the mechanism is built and tested, and nothing
  here can invent a feed URL. The Staff app's sync screen names it as missing, and
  "Esamina i feed" reads a URL and reports what it actually contains without writing
  anything — which is the right first thing to do with a feed nobody has seen yet.
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
npm run qa:pass                 # the Pass, the ranked offers, the Privilege upgrade
python3 tools/qr-verify.py      # the QR encoder, against two outside implementations
```

`npm run dev` seeds two obviously-invented reservations through the real ingestion
path and prints their personal links, so the whole reservation-aware half can be
walked without a mailbox existing.
