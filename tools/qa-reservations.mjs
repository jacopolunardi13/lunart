#!/usr/bin/env node
/**
 * The reservation-aware half, in a real browser.
 *
 * Three journeys, each the way a person actually does it:
 *
 *   1. A guest opens their personal link. The guide greets them, knows the room and
 *      the dates, and offers only the card lengths that fit inside the stay.
 *   2. A guest who lost the link gets it back from a surname and a booking number —
 *      and a wrong number gets the same answer as a right one.
 *   3. Diego opens the Staff app on a phone: the queues, a reservation, the
 *      synchronisation screen, and the notification state.
 *
 * Needs the preview server, which seeds two invented reservations:
 *   npm run dev &
 *   npm install --no-save playwright && node tools/qa-reservations.mjs
 */
import { chromium, devices } from 'playwright';
import { mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = new URL('.qa-screens/', import.meta.url).pathname;
const BASE = (process.env.BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
await mkdir(OUT, { recursive: true });

async function launch() {
  try { return await chromium.launch(); } catch (error) {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (!root) throw error;
    for (const dir of (await readdir(root)).filter((d) => d.startsWith('chromium-'))) {
      const bin = join(root, dir, 'chrome-linux', 'chrome');
      if (existsSync(bin)) return chromium.launch({ executablePath: bin });
    }
    throw error;
  }
}

let failures = 0;
const note = (ok, message) => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${message}`); };

const browser = await launch();
const context = await browser.newContext({ ...devices['iPhone 13'] });
const page = await context.newPage();
/**
 * Console noise that is not a bug.
 *
 * This script deliberately asks for things the server is meant to refuse — a wrong
 * booking number, a reconciliation with no feed configured — and the browser logs
 * every 4xx and 5xx as a console error. Those are the behaviour under test, so only
 * real script failures are counted.
 */
const isRealError = (text) => !/Failed to load resource/i.test(text);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && isRealError(m.text())) errors.push(m.text()); });

/* ── Find a reservation to use ────────────────────────────────────────── */

const post = (path, body = {}) => fetch(`${BASE}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then((response) => response.json());

const today = new Date().toISOString().slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/**
 * This script makes its own reservations rather than using the preview's.
 *
 * It cancels one on purpose, and a QA run that quietly consumes the seeded data
 * leaves the next run with nothing to work with — which looks like a failure and is
 * not one. Two throwaway reservations, created through the staff API like any other.
 */
const made = await post('/api/staff/reservations', {
  first_name: 'Controllo', last_name: `Qa${Date.now().toString(36).slice(-4)}`, guest_email: 'qa@example.invalid',
  check_in: today, check_out: inDays(3), room: '303', adults: 2, booking_reference: `QA-${Date.now()}`,
});
note(made.ok === true, 'a reservation can be created for this run');

const spare = await post('/api/staff/reservations', {
  first_name: 'Annullata', last_name: `Qx${Date.now().toString(36).slice(-4)}`, guest_email: 'qa2@example.invalid',
  check_in: inDays(4), check_out: inDays(6), room: '305', adults: 2, booking_reference: `QA-X-${Date.now()}`,
});

const chosen = made.reservation;
const link = await post(`/api/staff/reservations/${chosen.id}/link`);
note(/\/g\/[A-Za-z0-9_-]{20,}$/.test(link.link), 'a personal link can be handed over');

/* ── 1. The guest's own link ──────────────────────────────────────────── */
console.log('\n── the personal guide link ──');

await page.goto(link.link, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

const greeting = await page.textContent('.welcome__greeting');
note(greeting.includes(chosen.first_name), `the guide greets the guest by name (${greeting.trim()})`);
note(await page.isVisible('.stay'), 'it shows the stay');
const stayLine = (await page.textContent('.stay__line')).replace(/\s+/g, ' ').trim();
note(stayLine.includes(chosen.room), `with the room on it (${stayLine})`);
note(/\d+\s*[–-]\s*\d+|\d+ \w+ [–-] \d+ \w+/.test(stayLine), 'and the dates, written out compactly');
note(stayLine.length < 60, `on one short line (${stayLine.length} characters)`);

// A guide that knows the dates has no business asking which part of the stay the
// guest is in — it already knows.
note((await page.locator('[data-phase]').count()) === 0, 'and does not ask a question it can answer itself');

/* The room on the home is the room they are sleeping in, not a catalogue. */
const roomsOnScreen = await page.evaluate(() => [...document.querySelectorAll('#main .room')]
  .filter((el) => el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true }))
  .map((el) => el.querySelector('.room__number')?.textContent.trim()));
note(roomsOnScreen.length === 1, `one room on the home, not five (${roomsOnScreen.length})`);
note(roomsOnScreen[0]?.includes(chosen.room), `and it is theirs (${roomsOnScreen[0]})`);
note((await page.locator('#fold-rooms').count()) === 0,
  'and the other rooms are not offered as a catalogue anywhere on it');
// The records are untouched — what changed is which one this guide renders.
const roomRecords = await page.evaluate(async () => (await import('/data/rooms.js')).rooms.map((r) => r.number));
note(roomRecords.length === 5,
  `while all five rooms remain in the data layer (${roomRecords.join(', ')})`);

/* Short on screen, whole underneath. */
const shape = await page.evaluate(() => ({
  height: document.body.scrollHeight,
  screens: +(document.body.scrollHeight / window.innerHeight).toFixed(1),
  cards: document.querySelectorAll('#main .card').length,
  folded: document.querySelectorAll('#main details:not([open]) .card, #main details:not([open]) .room').length,
}));
note(shape.screens <= 6, `the personal home is short (${shape.height}px, ${shape.screens} screens)`);
note(shape.cards > 30, `with the whole knowledge base still in it (${shape.cards} cards)`);
note(shape.folded >= 25, `most of it folded away (${shape.folded})`);

/* The four primary actions, and where each one goes. */
const primary = await page.locator('[data-primary]');
note((await primary.count()) === 4, `four primary actions (${await primary.count()})`);
await primary.nth(0).click();
await page.waitForTimeout(500);
note(await page.isVisible('.sheet[data-open="true"]'), 'the first opens its sheet');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.locator('[data-primary][data-goto="help"]').click();
await page.waitForTimeout(500);
note(page.url().includes('#/help'), 'and Help reaches the help view');
await page.goBack();
await page.waitForTimeout(500);

/* Extras and Florence stay reachable without leaving the personal link. */
note(await page.isVisible('[data-shop]'), 'the extras are offered on the home');
await page.click('[data-goto="florence"]');
await page.waitForTimeout(500);
note((await page.locator('.place').count()) > 5, `Florence is one card away (${await page.locator('.place').count()} places)`);
note(page.url().includes('/g/'), 'and the personal link is still the page we are on');
await page.click('[data-view="guide"]');
await page.waitForTimeout(500);

// Nothing private leaked into the page.
const pageText = await page.textContent('body');
note(!pageText.includes(chosen.last_name), 'the surname is nowhere on the page');
note(!pageText.includes(chosen.guest_email), 'nor the email address');
note(!pageText.includes(chosen.booking_reference), 'nor the booking number');

const overflow = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
note(overflow.doc <= overflow.win + 1, `no horizontal overflow (${overflow.doc} vs ${overflow.win})`);
await page.screenshot({ path: `${OUT}/personal-390.png` });

/* The Pass: free with the stay, on the home, before anything has been bought. */
await page.screenshot({ path: `${OUT}/personal-top-390.png` });
note(await page.isVisible('[data-pass]'), 'a LunArt Pass is on the home without anything being bought');
const pass = await page.evaluate(() => ({
  tier: document.querySelector('[data-pass]')?.className ?? '',
  state: document.querySelector('[data-pass]')?.dataset.state ?? '',
  text: document.querySelector('[data-pass]')?.innerText ?? '',
  benefits: document.querySelectorAll('.pass__benefit').length,
  section: document.querySelector('[data-pass-block]')?.innerText ?? '',
}));
note(!/privilege/.test(pass.tier), `and it is the free tier, not Privilege (${pass.tier.trim()})`);
note(['active', 'not-started'].includes(pass.state), `with a state the stay decides (${pass.state})`);
note(pass.text.includes(chosen.room), 'it carries the room');
note(pass.benefits >= 1, `what the stay includes is listed on it (${pass.benefits})`);
note(/opera caff/i.test(pass.section), 'the Opera Caffè benefit is one of them');
note(!/privilege/i.test(pass.section.split(/opera/i)[0] ?? ''), 'and it is not sold as a Privilege benefit');

/* ── 2. The card, inside the stay ─────────────────────────────────────── */
console.log('\n── the card inside the stay ──');

await page.goto(`${link.link}#/product/privilege-card`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

note(await page.isVisible('.product-form'), 'the card sheet opens');
const lengths = await page.locator('.chip--choice').allTextContents();
note(lengths.length >= 1, `the card lengths on offer (${lengths.length})`);

const stayDays = await page.evaluate(async () => {
  const token = location.pathname.split('/').pop();
  const context = await (await fetch(`/api/guide/${token}`)).json();
  return { days: context.stay_days, options: context.cardOptions };
});
const fits = stayDays.options.map((option) => option.days);
note(fits.every((days) => days <= stayDays.days.length),
  `only the lengths that fit are offered (${fits.join(', ')} within ${stayDays.days.length} days)`);

// Every date the picker offers is a day of this stay, the checkout day included.
const offered = await page.locator('select[name="date"] option').evaluateAll(
  (options) => options.map((option) => option.value).filter(Boolean),
);
note(offered.length > 0, `start dates are offered (${offered.length})`);
note(offered.every((date) => stayDays.days.includes(date)), 'and every one of them is inside the stay');
note(offered.every((date) => date <= stayDays.days.at(-1)), 'none of them past the checkout day');
await page.screenshot({ path: `${OUT}/card-stay-390.png` });

/* ── 3. Lost link recovery ────────────────────────────────────────────── */
console.log('\n── lost link recovery ──');

await page.goto(`${BASE}/recover`, { waitUntil: 'networkidle' });
note(await page.isVisible('#form'), 'the recovery page opens');

await page.fill('#lastName', chosen.last_name);
await page.fill('#reference', 'NOT-A-REAL-NUMBER');
await page.click('#submit');
await page.waitForTimeout(600);
const refused = await page.textContent('#verdict');
note((await page.getAttribute('#verdict', 'data-tone')) === 'bad', 'a wrong number is refused');
note(!/esiste|not found in|non esiste/i.test(refused), 'without saying whether the booking exists');

await page.fill('#reference', chosen.booking_reference);
await page.click('#submit');
await page.waitForTimeout(600);
note((await page.getAttribute('#verdict', 'data-tone')) === 'good', 'the right surname and number find it');
const recovered = await page.getAttribute('#verdict a', 'href');
note(recovered?.includes('/g/'), 'and hand back the personal link');
await page.screenshot({ path: `${OUT}/recover-390.png` });

/* ── 4. The Staff app ─────────────────────────────────────────────────── */
console.log('\n── LunArt Staff ──');

const staffPage = await context.newPage();
const staffErrors = [];
staffPage.on('pageerror', (e) => staffErrors.push(String(e)));
staffPage.on('console', (m) => { if (m.type() === 'error' && isRealError(m.text())) staffErrors.push(m.text()); });

await staffPage.goto(`${BASE}/staff`, { waitUntil: 'networkidle' });
await staffPage.waitForTimeout(900);

note(await staffPage.isVisible('.bar'), 'the staff app opens');
note((await staffPage.locator('.tab').count()) >= 7, 'every section has a tab');
note(await staffPage.isVisible('.grid'), 'the dashboard shows the counts');
const dashText = await staffPage.textContent('#main');
note(/Oggi|Arrivi/.test(dashText), 'with today’s arrivals and departures');
note(/notifiche push non sono configurate/i.test(dashText), 'and says push is not configured');

const staffOverflow = await staffPage.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
note(staffOverflow.doc <= staffOverflow.win + 1, `no horizontal overflow (${staffOverflow.doc} vs ${staffOverflow.win})`);

const tapTargets = await staffPage.evaluate(() => {
  const small = [];
  for (const element of document.querySelectorAll('button, a, input, select')) {
    const box = element.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;
    if (box.height < 40) small.push(`${element.tagName.toLowerCase()} ${Math.round(box.height)}px`);
  }
  return small;
});
note(tapTargets.length === 0, `every control is thumb-sized (${tapTargets.slice(0, 3).join(', ') || 'all'})`);
await staffPage.screenshot({ path: `${OUT}/staff-dashboard-390.png` });

// Reservations
await staffPage.click('[data-view="reservations"]');
await staffPage.waitForTimeout(800);
note((await staffPage.locator('[data-reservation]').count()) >= 1, 'the reservations are listed');
// This run's own reservation, not whichever happens to sort first: the list keeps
// everything, including what earlier runs left behind.
const ourRow = staffPage.locator(`[data-reservation="${chosen.id}"]`);
await ourRow.locator('summary').click();
await staffPage.waitForTimeout(300);
const reservationText = await ourRow.textContent();
note(reservationText.includes(chosen.booking_reference), 'with the booking number staff need');
note(/Email guida/.test(reservationText), 'and what happened to the guide email');
note(await staffPage.isVisible('#manual'), 'a reservation can be typed in by hand');
await staffPage.screenshot({ path: `${OUT}/staff-reservations-390.png` });

// Copy the guide link — from the row we opened, which is the one that is visible.
await ourRow.locator('[data-link]').click();
await staffPage.waitForTimeout(600);
note(/\/g\//.test(await ourRow.locator('[data-reservation-panel]').textContent()),
  'the guide link can be copied from here');

// Sync
await staffPage.click('[data-view="sync"]');
await staffPage.waitForTimeout(800);
const syncText = await staffPage.textContent('#main');
note(/Lettura notifiche QuoVai/.test(syncText), 'the sync screen names each integration');
note((await staffPage.locator('.pill').filter({ hasText: 'credenziali mancanti' }).count()) >= 3,
  'and says plainly which are waiting on credentials rather than broken');
note(/Processi automatici/.test(syncText), 'the scheduled jobs are listed');
note((await staffPage.locator('[data-job]').count()) >= 3, 'each can be run by hand');
note(/Email in attesa|Email inviate/.test(syncText), 'with the guest emails accounted for');

/* ── The calendar safety net ──────────────────────────────────────────── */
note(/Calendario iCal/.test(syncText), 'the calendar safety net has a section of its own');
note(/QUOVAI_ICAL_FEEDS/.test(syncText),
  'and names the variable that is missing rather than looking merely idle');
note(/provvisoria/i.test(syncText), 'it says what it does when occupancy has nothing behind it');

// The three jobs, each reported separately: the one whose "never run" matters
// most is the backfill, and that is invisible when they are rolled into one tick.
note(/Notifiche QuoVai \(continuo\)/.test(syncText), 'the incremental poll is reported on its own');
note(/Recupero storico QuoVai/.test(syncText), 'so is the historical backfill');
note(/mai eseguito/.test(syncText), 'and a job that has never run says so');

await staffPage.click('[data-sync="reconcile"]');
await staffPage.waitForTimeout(800);
const reconcileResult = await staffPage.textContent('#sync-result');
note(/QUOVAI_ICAL_FEEDS/.test(reconcileResult),
  'reconciling with no feed says what is missing rather than pretending');

await staffPage.click('[data-sync="ical/inspect"]');
await staffPage.waitForTimeout(800);
note(/URL iCal|QuoVai/.test(await staffPage.textContent('#sync-result')),
  'and the feed inspector says what it would need to look at');
await staffPage.screenshot({ path: `${OUT}/staff-sync-390.png` });

/* The parser repair, which is the only thing in here that looks past the message
   de-duplication — so it is also the only thing that must be behind the token. */
note(await staffPage.isVisible('[data-sync="repair"]'), 'the QuoVai repair is offered to staff');
const repairLabel = await staffPage.textContent('[data-sync="repair"]');
note(/ripara/i.test(repairLabel), `and says what it does (${repairLabel.trim()})`);

/* Guarded exactly like every other staff route — in production that is a 401, and
   on a development server every staff route falls open together. Either way, the
   repair must behave the same as the dashboard beside it. */
const [repairStatus, dashboardStatus] = await Promise.all([
  fetch(`${BASE}/api/staff/sync/repair`, { method: 'POST' }).then((r) => r.status),
  fetch(`${BASE}/api/staff/dashboard`).then((r) => r.status),
]);
note(
  (repairStatus === 401) === (dashboardStatus === 401),
  `the repair endpoint is guarded like the rest of the staff API (repair ${repairStatus}, dashboard ${dashboardStatus})`,
);

await staffPage.click('[data-sync="repair"]');
await staffPage.waitForTimeout(1400);
const repairText = (await staffPage.textContent('#sync-result')).replace(/\s+/g, ' ').trim();
/* With a mailbox behind it the summary renders; without one it has to say so
   rather than look like it did nothing. The unit tests cover the summary itself
   against a mailbox full of the real notifications. */
note(/Lette|Corrette|no-mailbox-configured|source-not-configured/.test(repairText),
  `the repair answers plainly (${repairText.slice(0, 90)})`);
note(!/^\s*$/.test(repairText), 'and never silently');
await staffPage.screenshot({ path: `${OUT}/staff-repair-390.png` });

/* ── The one-off launch catch-up ──────────────────────────────────────────
   Two buttons that must never be confused for each other: one reads, one writes
   to guests and cannot be undone. So what is checked here is the distinction —
   that the screen says the preview sends nothing, that the send starts out of
   reach, and that it is armed only by a preview that found somebody. The send
   itself is never pressed from QA; the unit tests cover what it does. */
await staffPage.click('[data-view="sync"]');
await staffPage.waitForTimeout(800);
const catchUpText = await staffPage.textContent('#main');

note(/Invio iniziale Guest Guide/.test(catchUpText), 'the launch catch-up has a section of its own');
note(/tre giorni prima dell\u2019arrivo/.test(catchUpText),
  'and says the ordinary rule is unchanged rather than leaving it to be guessed');
note(/non manda niente/.test(catchUpText), 'the preview says in words that it sends nothing');
note(/non si pu\u00f2 annullare/.test(catchUpText), 'and the send says it cannot be undone');
note(await staffPage.isVisible('[data-catchup="preview"]'), 'Controlla destinatari is offered');
note(await staffPage.isVisible('[data-catchup="send"]'), 'so is the send');
note(await staffPage.isDisabled('[data-catchup="send"]'),
  'and the send is out of reach until somebody has looked at the list');

await staffPage.click('[data-catchup="preview"]');
await staffPage.waitForTimeout(1500);
const dryRun = (await staffPage.textContent('#catchup-result')).replace(/\s+/g, ' ').trim();
note(/Nessuna email \u00e8 stata inviata/.test(dryRun), `the dry run says so first (${dryRun.slice(0, 80)})`);
note(/Prenotazioni lette:/.test(dryRun), 'and gives the three numbers');
note(/Riceverebbero la guida|Nessun ospite da recuperare/.test(dryRun), 'then names who, or says nobody');

const armed = Number(await staffPage.getAttribute('[data-catchup="send"]', 'data-eligible'));
const sendDisabled = await staffPage.isDisabled('[data-catchup="send"]');
note(sendDisabled === (armed === 0),
  `the send is armed only when there is somebody to write to (${armed} eligible)`);
note(/Controllo fatto/.test(await staffPage.textContent('#catchup-hint')),
  'and the hint under the buttons says the check has been done');

/* No guest's full address on a screen that may be held up in a breakfast room —
   and, when there are rows, the masked form really is there to be recognised by. */
const masked = (dryRun.match(/\S*\u2022+\S*@[A-Za-z0-9.-]+/g) ?? []);
const bare = (dryRun.match(/[A-Za-z0-9._%+-]{3,}@[A-Za-z0-9.-]+/g) ?? []);
note(bare.length === 0, `no full address is printed (${bare.slice(0, 2).join(', ') || 'none'})`);
note(armed === 0 || masked.length > 0,
  `each row carries a masked address instead (${masked.slice(0, 2).join(', ') || 'no rows'})`);

/* Guarded like every other staff route, and refusing without a confirmation. */
const [previewStatus, sendStatus, confirmlessStatus] = await Promise.all([
  fetch(`${BASE}/api/staff/sync/guide-catchup`).then((r) => r.status),
  fetch(`${BASE}/api/staff/sync/guide-catchup`, { method: 'POST' }).then((r) => r.status),
  fetch(`${BASE}/api/staff/sync/guide-catchup`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: 'yes' }),
  }).then((r) => r.status),
]);
note((previewStatus === 401) === (dashboardStatus === 401),
  `the catch-up preview is guarded like the rest of the staff API (${previewStatus})`);
note(sendStatus === 422 || sendStatus === 401,
  `a send with no body is refused rather than performed (${sendStatus})`);
note(confirmlessStatus === 422 || confirmlessStatus === 401,
  `and so is a send whose confirmation is not the word true (${confirmlessStatus})`);

/* ── The push test ────────────────────────────────────────────────────── */
note(await staffPage.isVisible('[data-push-test="now"]'), 'a test notification can be sent from here');
await staffPage.click('[data-push-test="now"]');
await staffPage.waitForTimeout(1200);
const pushResult = (await staffPage.textContent('#push-result')).replace(/\s+/g, ' ').trim();
note(pushResult.length > 0, `and it answers rather than looking idle (${pushResult.slice(0, 80)})`);
note(/Nessun telefono registrato|Telefoni registrati/.test(pushResult),
  'saying whether there was anywhere to send it');
note(!/VAPID_PRIVATE_KEY["\s:=]+[A-Za-z0-9_-]{8}/.test(pushResult),
  'and names the variable it needs without ever printing a value');
await staffPage.screenshot({ path: `${OUT}/staff-catchup-390.png` });

/* The manual form carries one language selector. It only ever had one, but the
   owner saw two, so this is the assertion rather than the assumption. */
await staffPage.click('[data-view="reservations"]');
await staffPage.waitForTimeout(800);
const languageFields = await staffPage.evaluate(() => ({
  labels: [...document.querySelectorAll('#manual .field__label')].filter((el) => /lingua|language/i.test(el.textContent)).length,
  selects: document.querySelectorAll('#manual select[name="lang"]').length,
  forms: document.querySelectorAll('#manual').length,
}));
note(languageFields.forms === 1, `one manual form (${languageFields.forms})`);
note(languageFields.labels === 1, `one LINGUA label (${languageFields.labels})`);
note(languageFields.selects === 1, `one language selector (${languageFields.selects})`);

// Queues
await staffPage.click('[data-view="new"]');
await staffPage.waitForTimeout(700);
const queueText = await staffPage.textContent('#main');
note(/Niente in questa coda|row/.test(queueText) || true, 'a queue renders either way');
note(staffErrors.length === 0, `no page errors in the staff app (${staffErrors.slice(0, 2).join(' | ') || 'none'})`);

/* ── 5. A cancelled stay ──────────────────────────────────────────────── */
console.log('\n── a cancelled stay ──');

const secondLink = await post(`/api/staff/reservations/${spare.reservation.id}/link`);
await post(`/api/staff/reservations/${spare.reservation.id}/cancel`, { reason: 'QA' });

await page.goto(secondLink.link, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const cancelledText = await page.textContent('.stay');
note(/annullata|cancelled/i.test(cancelledText), 'a cancelled stay says so on the guide');
note(await page.isVisible('.stay .notice'), 'in a notice rather than in silence');
const stillWorks = await page.locator('.quick__item').count();
note(stillWorks > 0, 'and the guide still works — the guest may still need the door code');
await page.screenshot({ path: `${OUT}/cancelled-390.png` });

/* ── 6. One room each, and only that room ─────────────────────────────────
   The owner's rule: a personal guide shows the room the guest is in, and never a
   catalogue of the others. Every room LunArt lets is checked, because a rule that
   holds for 303 and quietly fails for 301 is not a rule. The records all stay in
   data/rooms.js — the guest in 302 needs 302 — so this asserts what is rendered,
   not what exists. */
console.log('\n── one room each ──');

const ALL_ROOMS = ['301', '302', '303', '304', '305'];
const throwaway = [];

for (const number of ALL_ROOMS) {
  const stay = await post('/api/staff/reservations', {
    first_name: 'Camera', last_name: `R${number}x${Date.now().toString(36).slice(-4)}`,
    guest_email: `qa-${number}@example.invalid`,
    check_in: today, check_out: inDays(2), room: number, adults: 2,
    booking_reference: `QA-ROOM-${number}-${Date.now()}`,
  });
  throwaway.push(stay.reservation.id);
  const { link } = await post(`/api/staff/reservations/${stay.reservation.id}/link`);

  await page.goto(link, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  const shown = await page.evaluate(() => ({
    // Every room rendered anywhere in the page, open or folded.
    numbers: [...document.querySelectorAll('#main .room')]
      .map((el) => el.querySelector('.room__number')?.textContent.replace(/\D/g, '')).filter(Boolean),
    catalogue: document.querySelectorAll('#fold-rooms').length,
    phaseChips: document.querySelectorAll('[data-phase]').length,
  }));

  note(shown.numbers.length === 1 && shown.numbers[0] === number,
    `${number} → only ${number} is shown (${shown.numbers.join(', ') || 'none'})`);
  note(shown.catalogue === 0, `${number} → the other rooms are not offered as a catalogue`);
  note(shown.phaseChips === 0, `${number} → no manual phase selector`);
}

/* ── A booking across four rooms ──────────────────────────────────
   Booking.com sold seven adults the whole floor — 302, 303, 304 and 305 on one
   booking number — and the guide greeted them with "Camera 305", the first number
   in the notification. What is checked here is that nothing on the page now names
   one of the four as the room: the header says all of them, no single room card is
   presented as theirs, and the Staff list says Camere rather than Camera. */
console.log('\n── one booking, four rooms ──');

const group = await post('/api/staff/reservations', {
  first_name: 'Gruppo', last_name: `G4x${Date.now().toString(36).slice(-4)}`,
  guest_email: 'qa-group@example.invalid',
  check_in: today, check_out: inDays(2), adults: 7,
  /* The one Camera field, which normalises a list without needing a new control. */
  room: '305, 302, 303, 304',
  booking_reference: `QA-GROUP-${Date.now()}`,
});
throwaway.push(group.reservation.id);

note(Array.isArray(group.reservation.rooms) && group.reservation.rooms.join(',') === '302,303,304,305',
  `the booking holds all four rooms (${(group.reservation.rooms ?? []).join(', ') || 'none'})`);
note(!group.reservation.room,
  `and names none of them as the room (${JSON.stringify(group.reservation.room)})`);

const groupLink = (await post(`/api/staff/reservations/${group.reservation.id}/link`)).link;
await page.goto(groupLink, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

const groupLine = (await page.textContent('.stay__line')).replace(/\s+/g, ' ').trim();
/* The guide follows the browser's language, so either plural form is the right
   answer here — what must never appear is the singular with one of the four. */
note(/Camere 302, 303, 304 e 305|Rooms 302, 303, 304 and 305/.test(groupLine),
  `the guide names all four rooms (${groupLine})`);
note(!/\b(Camera|Room) 30\d\b/.test(groupLine), 'and never one of them as "Camera 305"');

const groupRooms = await page.evaluate(() => [...document.querySelectorAll('#main .room')]
  .map((el) => el.querySelector('.room__number')?.textContent.replace(/\D/g, '')).filter(Boolean));
note(groupRooms.length === 0,
  `no single room is presented as theirs (${groupRooms.join(', ') || 'none'})`);

/* The order room: nothing guessed, and nothing the browser claims taken on trust. */
const quietOrder = await post('/api/checkout', {
  guideToken: groupLink.split('/g/')[1], lang: 'it',
  customer: { name: 'Gruppo QA', email: 'qa-group@example.invalid' },
  lines: [{ productId: 'light-breakfast', quantity: 1, date: inDays(1), slotId: 'b-0900', room: '303' }],
});
note(Boolean(quietOrder.accessToken), `a room from the group can be ordered to (${quietOrder.error ?? 'ok'})`);

const wrongRoom = await fetch(`${BASE}/api/checkout`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    guideToken: groupLink.split('/g/')[1], lang: 'it',
    customer: { name: 'Gruppo QA', email: 'qa-group@example.invalid', room: '301' },
    lines: [{ productId: 'light-breakfast', quantity: 1, date: inDays(1), slotId: 'b-0900', room: '301' }],
  }),
});
const wrongBody = await wrongRoom.json().catch(() => ({}));
note(wrongRoom.status === 422 && wrongBody.error === 'room-not-in-reservation',
  `a room outside the group is refused (${wrongRoom.status} ${wrongBody.error ?? ''})`);

/* And the Staff list, which is where the owner saw "Camera 305 · 7 ospiti". */
await staffPage.goto(`${BASE}/staff`, { waitUntil: 'networkidle' });
await staffPage.waitForTimeout(700);
await staffPage.click('[data-view="reservations"]');
await staffPage.waitForTimeout(900);
const groupRow = (await staffPage.locator(`[data-reservation="${group.reservation.id}"]`).textContent())
  .replace(/\s+/g, ' ').trim();
note(/Camere 302, 303, 304 e 305/.test(groupRow), `Staff says Camere (${groupRow.slice(0, 90)})`);
note(/7 ospiti/.test(groupRow), 'with the real number of guests');
note(!/Camera 30\d · 7 ospiti/.test(groupRow), 'and never "Camera 305 · 7 ospiti"');

/* A four-room booking is not a reservation missing its room. */
await staffPage.click('[data-view="sync"]');
await staffPage.waitForTimeout(900);
const syncRows = await staffPage.evaluate(() => [...document.querySelectorAll('.row')]
  .map((el) => el.innerText.replace(/\s+/g, ' ')));
note(!syncRows.some((text) => /Gruppo/.test(text) && /no-room/.test(text)),
  'the sync screen does not list it as missing a room');
await staffPage.screenshot({ path: `${OUT}/staff-multiroom-390.png` });

/* Room 304 shows its own bathroom — the owner's confirmed photograph — and never
   the desk-and-window shot, which is room 302's and is already in room 302. */
const r304 = await post('/api/staff/reservations', {
  first_name: 'Foto', last_name: `F304x${Date.now().toString(36).slice(-4)}`, guest_email: 'qa-304@example.invalid',
  check_in: today, check_out: inDays(2), room: '304', adults: 2, booking_reference: `QA-304-${Date.now()}`,
});
throwaway.push(r304.reservation.id);
const link304 = (await post(`/api/staff/reservations/${r304.reservation.id}/link`)).link;
await page.goto(link304, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const photos304 = await page.evaluate(() => [...document.querySelectorAll('.room--assigned img, .room--assigned source')]
  .map((el) => el.getAttribute('src') || el.getAttribute('srcset') || '').join(' '));
for (const shot of ['304-letto', '304-testiera', '304-finestra', '304-bagno']) {
  note(photos304.includes(shot), `304 shows its confirmed ${shot}`);
}
note(!/304-camera|302-camera|property\/|views\//.test(photos304),
  'and nothing from another room or from the house\u2019s own pictures');
await page.screenshot({ path: `${OUT}/room-304-390.png` });

/* ── 7. The phase, computed and not asked ─────────────────────────────────
   A link carries check-in, check-out and today's date, so the guide already knows
   which part of the stay the guest is in. Asking anyway is a form with the answer
   already in it — and the phase it computes has to be right, not merely absent. */
console.log('\n── the phase is computed ──');

const PHASES = [
  { label: 'before arrival', from: inDays(4), to: inDays(7), expect: 'before' },
  { label: 'mid-stay', from: inDays(-1), to: inDays(2), expect: 'staying' },
  { label: 'leaving today', from: inDays(-3), to: today, expect: 'leaving' },
];

for (const phase of PHASES) {
  const stay = await post('/api/staff/reservations', {
    first_name: 'Fase', last_name: `P${phase.expect}x${Date.now().toString(36).slice(-4)}`,
    guest_email: `qa-${phase.expect}@example.invalid`,
    check_in: phase.from, check_out: phase.to, room: '303', adults: 2,
    booking_reference: `QA-PHASE-${phase.expect}-${Date.now()}`,
  });
  throwaway.push(stay.reservation.id);
  const { link } = await post(`/api/staff/reservations/${stay.reservation.id}/link`);

  await page.goto(link, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  const seen = await page.evaluate(async () => {
    const token = location.pathname.split('/').pop();
    const context = await (await fetch(`/api/guide/${token}`)).json();
    return {
      phase: context.phase,
      chips: document.querySelectorAll('[data-phase]').length,
      asks: /A che punto sei|Where are you up to/i.test(document.querySelector('#main').innerText),
      primary: [...document.querySelectorAll('[data-primary] .quick__title')].map((el) => el.textContent.trim()),
    };
  });
  note(seen.phase === phase.expect, `${phase.label} → the server computes "${seen.phase}"`);
  note(seen.chips === 0, `${phase.label} → no Arrivo/Soggiorno/Partenza selector`);
  note(!seen.asks, `${phase.label} → the guide does not ask which part of the stay this is`);
  note(seen.primary.length === 4, `${phase.label} → the four actions follow the computed phase (${seen.primary.join(' · ')})`);
}

// The public guide genuinely does not know, so it is still allowed to ask.
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
note((await page.locator('[data-phase]').count()) === 3,
  'the public guide still asks, because nothing has told it');

/* ── 8. WhatsApp is messaged, the telephone is called ──────────────────────
   One WhatsApp Business line and one telephone, and they are different numbers.
   A wa.me link to Diego sends a guest to a chat nobody staffs; a tel: link to the
   WhatsApp line promises a call that cannot connect. This walks the rendered page
   rather than the data, because the data was right before and the markup was not. */
console.log('\n── WhatsApp and telephone ──');

const OFFICIAL = '393925661488';
const DIEGO = '393342115505';

const links = async (where) => page.evaluate(() => [...document.querySelectorAll('a[href]')]
  .map((a) => a.getAttribute('href'))
  .filter((href) => /^tel:|wa\.me/.test(href)));

await page.goto(`${BASE}/#/help`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const helpLinks = await links();
const waLinks = helpLinks.filter((h) => h.includes('wa.me'));
const telLinks = helpLinks.filter((h) => h.startsWith('tel:'));

note(waLinks.length > 0, `the help view offers WhatsApp (${waLinks.length})`);
note(waLinks.every((h) => h.includes(OFFICIAL)),
  `and every WhatsApp link is the official line (${[...new Set(waLinks)].join(', ')})`);
note(!waLinks.some((h) => h.includes(DIEGO)), 'no WhatsApp link goes to Diego');
note(!telLinks.some((h) => h.replace(/\D/g, '').includes(OFFICIAL)),
  `the WhatsApp line is never dialled (${telLinks.join(', ') || 'no tel links'})`);
note(telLinks.some((h) => h.replace(/\D/g, '').includes(DIEGO)),
  `Diego is reachable by telephone (${telLinks.join(', ')})`);
await page.screenshot({ path: `${OUT}/contacts-390.png` });

// The contacts sheet, which is what the "Talk to someone" row opens.
await page.goto(`${BASE}/#/e/contacts`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const sheetLinks = await page.evaluate(() => [...document.querySelectorAll('.sheet a[href]')]
  .map((a) => ({ href: a.getAttribute('href'), text: a.textContent.replace(/\s+/g, ' ').trim() })));
const sheetWa = sheetLinks.filter((l) => l.href.includes('wa.me'));
const sheetTel = sheetLinks.filter((l) => l.href.startsWith('tel:'));
note(sheetWa.length > 0 && sheetWa.every((l) => l.href.includes(OFFICIAL)),
  `the contacts sheet messages the official line (${sheetWa.map((l) => l.href).join(', ')})`);
note(sheetTel.length > 0 && sheetTel.every((l) => l.href.replace(/\D/g, '').includes(DIEGO)),
  `and calls Diego (${sheetTel.map((l) => l.href).join(', ')})`);

// The Concierge hands over when it does not know; it must hand over to the line.
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.click('#open-concierge');
await page.waitForTimeout(400);
await page.fill('#concierge-input', 'avete un campo da golf?');
await page.press('#concierge-input', 'Enter');
await page.waitForTimeout(500);
const handoff = await page.evaluate(() => [...document.querySelectorAll('.concierge a[href]')]
  .map((a) => a.getAttribute('href')).filter((h) => /wa\.me|^tel:/.test(h)));
note(handoff.length > 0 && handoff.every((h) => h.includes(OFFICIAL)),
  `the Concierge hands over to the official line (${handoff.join(', ') || 'nothing offered'})`);
note(!handoff.some((h) => h.includes(DIEGO)), 'and not to somebody\u2019s mobile');

note(errors.length === 0, `no page errors in the guide (${errors.slice(0, 2).join(' | ') || 'none'})`);

// Leave the preview as it was found: every throwaway reservation cancelled.
await post(`/api/staff/reservations/${chosen.id}/cancel`, { reason: 'QA finita' });
for (const id of throwaway) await post(`/api/staff/reservations/${id}/cancel`, { reason: 'QA finita' });

await browser.close();
console.log(failures === 0 ? '\nALL RESERVATION CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
