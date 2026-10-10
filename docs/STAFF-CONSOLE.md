# LunArt and the shared Staff console

The operator decided (9 October 2026) that LunArt and Bella Vigna keep two
independent guest guides and share **one Staff app**: one sign-in per person
(passkey), filters Tutte | LunArt | Bella Vigna, permissions checked on the server
per person, role and property, notifications from both houses on one phone.

The console itself lives in the Bella Vigna repository (`server/console/`, the same
Core in a "console" mode). It holds people, passkeys, sessions and an audit log —
never a guest, a reservation or an order: those stay here, in LunArt's own store,
and are read through LunArt's Staff API.

This change is what LunArt needs for that, and nothing else. **Every part is off
unless its variable is set**: deployed as is, production behaves exactly as today.

## What changes

| | Without the variables | With them |
|---|---|---|
| Staff API access | `STAFF_TOKEN` (now compared in constant time) | also `CONSOLE_SERVICE_TOKEN`, the console's own credential |
| Staff answers | unchanged fields | plus `property: { id: 'lunart', … }`; the dashboard lists `rooms` |
| Notifications | to the phones registered on `/staff` | also to the console (`CONSOLE_URL` + `CONSOLE_RELAY_SECRET`), signed HMAC-SHA256, never blocking the order or booking that caused them |
| `/staff` | the LunArt Staff app | with `STAFF_TOKEN_RETIRED=1`: redirect to `CONSOLE_URL`, and `STAFF_TOKEN` stops working |
| Phones registered on `/staff` | receive every notification | with `STAFF_TOKEN_RETIRED=1` and the relay wired: no longer pushed (the console pushes instead), so nothing arrives twice |
| `/api/health` | — | `integrations.staffConsole`: what is wired, never a secret |

## Rolling it out without stopping anybody

1. Deploy this branch with nothing new set. Nothing changes.
2. Set `CONSOLE_SERVICE_TOKEN` (new, random) here and the same value as
   `CONSOLE_PROPERTY_LUNART_TOKEN` on the console; set `CONSOLE_URL` and
   `CONSOLE_RELAY_SECRET` (same value as `CONSOLE_PROPERTY_LUNART_RELAY_SECRET`).
   The console now reads and works LunArt; the old `/staff` still works.
3. Everyone moves to the console and enables notifications there.
4. Set `STAFF_TOKEN_RETIRED=1`. The shared token stops working, `/staff` sends
   people to the console, and LunArt stops pushing to the phones of the old app
   (the console does it), so no notification arrives twice. Undo by removing the
   variable.

Each step is a configuration change on the hosting, approved before it is made.

## Tests

`test/console-bridge.test.mjs`: the default is unchanged; the service token works
alongside the shared one; retiring it; every Staff answer names the house; the
relay is signed and never blocks; health shows no secret.
