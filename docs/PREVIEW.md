# The private preview

A full LunArt v2 — the real Node server, the guide, the shop, the Staff app, the
reservation half — running on a temporary URL, with everything that could reach a
real person switched off.

It deploys from `fable/guest-guide-v2`. It does not touch `main`, and it has nothing
to do with the GitHub Pages site, which is published separately and is unaffected.

## Why a server and not a static host

The static guide works on Pages, but half of v2 is not static: the commerce API, the
personal guide links, the Staff app, the mock checkout and the scheduler all need a
process that stays up and keeps state. Render runs exactly that from a GitHub branch
with no rewrite, which is why it is the host in `render.yaml`. Any host that runs
`node server/index.js` works the same way; the blueprint is the only Render-specific
file in the repository.

## What Jacopo has to do

Four clicks and one copy. Everything else is in `render.yaml`.

1. **Create the account.** Go to <https://render.com> → **Get Started** → **GitHub**,
   and authorise Render for the `jacopolunardi13/lunart` repository. Render only
   needs read access to deploy.
2. **Deploy the blueprint.** Dashboard → **New +** → **Blueprint** → pick
   `jacopolunardi13/lunart` → Render finds `render.yaml` on
   `fable/guest-guide-v2` → **Apply**. The first build takes two or three minutes.
3. **Read the Staff token.** Open the `lunart-preview` service → **Environment** →
   the value next to `STAFF_TOKEN`. Render generated it; nobody else has seen it.
4. **Open the preview.** The service's URL ends in `.onrender.com`. Start at
   `/preview`, which lists everything else — including the personal guest links,
   which change whenever the service restarts.

## What the preview is

| | |
|---|---|
| `/preview` | the front door: every link, and what is switched off |
| `/` | the guide as a guest sees it without a personal link |
| `/g/<token>` | a guest's own link — greeting, room, dates, the card bound to the stay |
| `/recover` | a lost link, from a surname and a booking number |
| `/staff` | LunArt Staff — asks for the token once, then remembers it on the device |
| `/partner/opera-caffe` | the page a venue keeps on its home screen |
| `/validate-card` | the generic venue page |
| `/api/health` | what is configured, and what is deliberately off |

`/api/health` is worth one note: in a preview every integration reads
`disabled-in-preview` rather than `credentials-missing`. The difference matters —
nothing is waiting for a value to be filled in, so nobody should go looking for one.

## What is switched off, and how

`LUNART_PREVIEW=1` is read in `server/config.js` before anything else. It does not
default things to safe values — it refuses to read the dangerous ones:

| | in the preview | why it cannot go wrong |
|---|---|---|
| Payments | the built-in stand-in | `STRIPE_SECRET_KEY` is not read at all |
| Guest email | rendered, kept, never sent | `MAIL_PROVIDER` is not read |
| QuoVai mailbox | not read; reservations are invented | the Gmail credentials are not read |
| Hair calendar | not read, not written | the service-account values are not read |
| Push | recorded, not sent | the VAPID keys are not read |
| Prices | provisional ones included | so every flow can actually be walked |

Paste a live key into that service by mistake and nothing happens: the value is
never read while `LUNART_PREVIEW` is on.

The Staff API is additionally behind `STAFF_TOKEN`, and because the service runs
with `NODE_ENV=production` it refuses every staff request when no token is set,
rather than falling open the way a development server does.

## Two things to expect

**It sleeps.** On Render's free plan the service stops after about fifteen minutes
of no traffic and takes thirty seconds or so to answer the first request after that.
That is the free plan, not a bug.

**It forgets.** There is no database: orders, cards and reservations live in memory.
When the service restarts it reseeds the same two invented reservations — with new
personal links, which is why `/preview` reads them live rather than printing them
once. Anything bought during a demo is gone after a restart, which for a
demonstration is a feature.

## Taking it down

Render → the service → **Settings** → **Delete Service**. Nothing else is affected.
