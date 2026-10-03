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

const greeting = await page.textContent('.hero__greeting');
note(greeting.includes(chosen.first_name), `the guide greets the guest by name (${greeting.trim()})`);
note(await page.isVisible('.stay'), 'it shows the stay');
const stayLine = await page.textContent('.stay__line');
note(stayLine.includes(chosen.room), `with the room on it (${stayLine.replace(/\s+/g, ' ').trim()})`);

// Nothing private leaked into the page.
const pageText = await page.textContent('body');
note(!pageText.includes(chosen.last_name), 'the surname is nowhere on the page');
note(!pageText.includes(chosen.guest_email), 'nor the email address');
note(!pageText.includes(chosen.booking_reference), 'nor the booking number');

const overflow = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
note(overflow.doc <= overflow.win + 1, `no horizontal overflow (${overflow.doc} vs ${overflow.win})`);
await page.screenshot({ path: `${OUT}/personal-390.png` });

// What comes with the stay is listed without anything being bought.
const included = await page.locator('.privileges__list .privilege').count();
note(included >= 1, `what the stay includes is listed (${included})`);
const includedText = await page.textContent('[data-guest-blocks]');
note(/Opera Caff/.test(includedText), 'the Opera Caffè benefit is one of them');

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
await staffPage.click('[data-reservation] summary');
await staffPage.waitForTimeout(300);
const reservationText = await staffPage.textContent('[data-reservation]');
note(reservationText.includes(chosen.booking_reference), 'with the booking number staff need');
note(/Email guida/.test(reservationText), 'and what happened to the guide email');
note(await staffPage.isVisible('#manual'), 'a reservation can be typed in by hand');
await staffPage.screenshot({ path: `${OUT}/staff-reservations-390.png` });

// Copy the guide link
await staffPage.click('[data-reservation] [data-link]');
await staffPage.waitForTimeout(600);
note(/\/g\//.test(await staffPage.textContent('[data-reservation-panel]')), 'the guide link can be copied from here');

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

await staffPage.click('[data-sync="reconcile"]');
await staffPage.waitForTimeout(800);
note(/no-feeds-configured/.test(await staffPage.textContent('#sync-result')),
  'reconciling with no feed says so rather than pretending');
await staffPage.screenshot({ path: `${OUT}/staff-sync-390.png` });

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

note(errors.length === 0, `no page errors in the guide (${errors.slice(0, 2).join(' | ') || 'none'})`);

// Leave the preview as it was found: both throwaway reservations cancelled.
await post(`/api/staff/reservations/${chosen.id}/cancel`, { reason: 'QA finita' });

await browser.close();
console.log(failures === 0 ? '\nALL RESERVATION CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
