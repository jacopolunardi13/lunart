#!/usr/bin/env node
/**
 * Walks the whole purchase in a real browser, on a phone-sized screen.
 *
 * Not a unit test: it clicks what a guest clicks. Pick a bottle, choose an
 * evening, add it, check out, pay on the stand-in, come back to a paid order —
 * then buy a card, open it, and validate it on the venue's page.
 *
 * Needs the server running:
 *   npm run dev &
 *   npm install --no-save playwright && node tools/qa-commerce.mjs
 */
import { chromium, devices } from 'playwright';
import { mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = new URL('.qa-screens/', import.meta.url).pathname;
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
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
const today = new Date().toISOString().slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const browser = await launch();
const context = await browser.newContext({ ...devices['iPhone 13'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

/* ── The shop ─────────────────────────────────────────────────────────── */
console.log('\n── shop ──');
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

note(await page.isVisible('[data-shop]'), 'the guide shows an Extras section');
await page.click('[data-shop]');
await page.waitForTimeout(500);
const productCount = await page.locator('[data-product]').count();
note(productCount >= 5, `the shop lists products (${productCount})`);

const overflow = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
note(overflow.doc <= overflow.win + 1, `no horizontal overflow (${overflow.doc} vs ${overflow.win})`);
await page.screenshot({ path: `${OUT}/shop-390.png` });

/* ── Buying a bottle ──────────────────────────────────────────────────── */
console.log('\n── wine ──');
await page.click('[data-product="wine-in-room"]');
await page.waitForTimeout(500);
note(await page.isVisible('.sheet[data-open="true"]'), 'the product sheet opens');

const addButton = page.locator('[data-add]');
note(await addButton.isDisabled(), 'cannot add before the choices are made');

await page.selectOption('select[name="variantId"]', 'brunello');
await page.fill('input[name="date"]', inDays(3));
await page.selectOption('select[name="slotId"]', 'w-1900');
await page.fill('input[name="room"]', '303');
await page.waitForTimeout(400);

const summary = await page.textContent('[data-summary]');
note(/70/.test(summary), `the sheet shows the price (${summary.replace(/\s+/g, ' ').trim().slice(0, 60)})`);
note(/preavviso|notice/i.test(summary), 'it states the notice the bottle needs');
await page.screenshot({ path: `${OUT}/product-390.png` });

note(!(await addButton.isDisabled()), 'adding is allowed once the form is complete');
await addButton.click();
await page.waitForTimeout(700);
note(await page.isVisible('.cart-line'), 'the cart opens with the bottle in it');

/* ── A second item, and the quantity stepper ──────────────────────────── */
await page.click('.sheet [data-close]');
await page.waitForTimeout(500);
await page.goto(`${BASE}#/product/brunch`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.click('.chip--choice:has-text("Opera")');
await page.fill('input[name="date"]', inDays(2));
await page.selectOption('select[name="slotId"]', 'b-0830');
await page.selectOption('select[name="option:hotDrink"]', 'cappuccino');
await page.fill('input[name="room"]', '303');
await page.waitForTimeout(400);
await page.click('[data-add]');
await page.waitForTimeout(700);

note((await page.locator('.cart-line').count()) === 2, 'the cart holds two different lines');
const badge = await page.textContent('.cart-button__count').catch(() => '');
note(badge.trim() === '2', `the header badge counts them (${badge.trim()})`);

await page.click('.cart-line .stepper__button[data-step="1"]');
await page.waitForTimeout(400);
const totalText = await page.textContent('.cart-total');
// One more Brunello on top of the brunch: 2 x 70 + 50.
note(/190/.test(totalText.replace(/\s/g, '')), `the total follows the stepper (${totalText.replace(/\s+/g, ' ').trim()})`);
await page.click('.cart-line .stepper__button[data-step="-1"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/cart-390.png` });

/* ── Checkout ─────────────────────────────────────────────────────────── */
console.log('\n── checkout ──');
await page.fill('input[name="name"]', 'Jacopo Lunardi');
await page.fill('input[name="email"]', 'jacopo@example.com');
await page.fill('input[name="room"]', '303');
await page.click('.checkout-form button[type="submit"]');
await page.waitForURL(/mock-checkout/, { timeout: 8000 });
note(true, 'checkout hands over to the payment page');
note(await page.isVisible('.banner'), 'the stand-in is labelled as a test environment');
await page.screenshot({ path: `${OUT}/checkout-390.png` });

await page.click('[data-pay]');
await page.waitForURL(/#\/order\//, { timeout: 8000 });
await page.waitForTimeout(900);
const status = await page.textContent('.status-pill');
note(/pagato|paid/i.test(status), `the order comes back confirmed (${status.trim()})`);
await page.screenshot({ path: `${OUT}/order-390.png` });

/* ── Persistence ──────────────────────────────────────────────────────── */
console.log('\n── cart persistence ──');
await page.goto(`${BASE}#/product/wine-in-room`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.selectOption('select[name="variantId"]', 'vermentino');
await page.fill('input[name="date"]', inDays(4));
await page.selectOption('select[name="slotId"]', 'w-2000');
await page.fill('input[name="room"]', '303');
await page.waitForTimeout(300);
await page.click('[data-add]');
await page.waitForTimeout(600);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const afterReload = await page.textContent('.cart-button__count').catch(() => '0');
note(afterReload.trim() === '1',
  `the paid basket was emptied and the new bottle survives a reload (${afterReload.trim()})`);

/* ── The Privilege Card ───────────────────────────────────────────────── */
console.log('\n── privilege card ──');
await page.evaluate(() => localStorage.removeItem('lunart.cart.v1'));
await page.goto(`${BASE}#/product/privilege-card`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.click('.chip--choice:has-text("5")');
await page.fill('input[name="date"]', today);
await page.fill('input[name="field:holderName"]', 'Jacopo Lunardi');
await page.waitForTimeout(400);
await page.click('[data-add]');
await page.waitForTimeout(700);
await page.fill('input[name="name"]', 'Jacopo Lunardi');
await page.fill('input[name="email"]', 'jacopo@example.com');
await page.click('.checkout-form button[type="submit"]');
await page.waitForURL(/mock-checkout/, { timeout: 8000 });
await page.click('[data-pay]');
await page.waitForURL(/#\/order\//, { timeout: 8000 });
await page.waitForTimeout(900);

note(await page.isVisible('[data-card]'), 'the paid order carries the card');
await page.click('[data-card]');
await page.waitForTimeout(1200);
note(await page.isVisible('.privilege-card'), 'the card screen opens');
note(await page.isVisible('.card-code__qr svg'), 'a QR is drawn');
const manual = (await page.textContent('[data-manual]')).trim();
note(/^[0-9A-Z]{6}-[0-9A-Z]{6}$/.test(manual), `a spoken code is offered (${manual})`);
await page.screenshot({ path: `${OUT}/card-390.png` });

const countdownBefore = Number(await page.textContent('[data-countdown]'));
await page.waitForTimeout(2500);
const countdownAfter = Number(await page.textContent('[data-countdown]'));
note(countdownAfter < countdownBefore, `the code counts down (${countdownBefore} → ${countdownAfter})`);

/* ── The venue's page ─────────────────────────────────────────────────── */
console.log('\n── validation ──');
const [reference, code] = manual.split('-');
const venue = await context.newPage();
await venue.goto(`${BASE}validate-card?c=${reference}&k=${code}`, { waitUntil: 'networkidle' });
await venue.waitForTimeout(900);
note((await venue.getAttribute('#verdict', 'data-tone')) === 'good', 'the venue page says the card is valid');
note(/Jacopo/.test(await venue.textContent('#result')), 'it shows who is holding it');
note(/30%/.test(await venue.textContent('#result')), 'it shows the benefit');
await venue.screenshot({ path: `${OUT}/validate-390.png` });

await venue.reload({ waitUntil: 'networkidle' });
await venue.waitForTimeout(900);
note((await venue.getAttribute('#verdict', 'data-tone')) === 'bad', 'the same code a second time is refused');

await venue.goto(`${BASE}validate-card`, { waitUntil: 'networkidle' });
await venue.fill('#code', 'ZZZZZZ-ZZZZZZ');
await venue.click('#manual button[type="submit"]');
await venue.waitForTimeout(700);
note((await venue.getAttribute('#verdict', 'data-tone')) === 'bad', 'an invented code is refused');

note(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ') || 'none'})`);

/* ── With no commerce server behind it ────────────────────────────────── */
{
  const offline = await browser.newContext({ ...devices['iPhone 13'] });
  const shop = await offline.newPage();
  const errs = [];
  shop.on('pageerror', (e) => errs.push(String(e)));
  // The guide is served as static files from GitHub Pages with no API behind it.
  // It has to stay useful: a guest looking for the Wi-Fi password should not pay
  // for a shop they did not open.
  await shop.route('**/api/**', (route) => route.abort());

  console.log('\n── no commerce server ──');
  await shop.goto(BASE, { waitUntil: 'domcontentloaded' });
  await shop.waitForTimeout(1500);

  note((await shop.locator('.card').count()) > 10, 'the guide still renders in full');
  note((await shop.locator('.quick .quick__item').count()) === 4, 'quick actions are there');
  note((await shop.locator('[data-shop]').count()) === 0, 'the extras teaser stays out of the way');
  note(await shop.locator('#cart-button').isHidden(), 'the cart button is hidden');

  await shop.goto(`${BASE}#/shop`, { waitUntil: 'domcontentloaded' });
  await shop.waitForTimeout(900);
  const explained = await shop.textContent('.section__blurb').catch(() => '');
  note(/non sono raggiungibili|not reachable/i.test(explained), 'the shop explains itself and points at a person');
  note(errs.length === 0, `no page errors (${errs.slice(0, 2).join(' | ') || 'none'})`);
  await offline.close();
}

await browser.close();
console.log(`\n${failures === 0 ? 'ALL COMMERCE CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
