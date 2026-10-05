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
// The Brunello at LunArt's own confirmed price, with the notice an order under
// ninety euros needs.
note(/89/.test(summary), `the sheet shows the price (${summary.replace(/\s+/g, ' ').trim().slice(0, 60)})`);
note(/12|ore|hours/.test(summary), 'and the notice the order needs');
note(/preavviso|notice/i.test(summary), 'it states the notice the bottle needs');

// What happens if they change their mind, said before they decide rather than
// after. Drawn from the product's own policy, so it cannot drift from the rule the
// server applies when the cancellation actually arrives.
const policyLine = await page.textContent('.terms--policy').catch(() => '');
note(/annullabile|cancellable/i.test(policyLine), `the cancellation policy is stated up front (${policyLine.replace(/\s+/g, ' ').trim().slice(0, 60)})`);
note(/3 ore|3 hours/i.test(policyLine), 'and it is the bottle’s own three-hour rule');
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
await page.check('input[name="variantId"][value="opera"]', { force: true });
await page.fill('input[name="date"]', inDays(2));
await page.selectOption('select[name="slotId"]', 'b-0900');
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
// Two Brunello on top of the brunch: 2 x 89 + 69.
note(/247/.test(totalText.replace(/\s/g, '')), `the total follows the stepper (${totalText.replace(/\s+/g, ' ').trim()})`);
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

/* ── Changing their mind ──────────────────────────────────────────────── */
console.log('\n── cancelling a line ──');
// The brunch is for the day after tomorrow, so it is inside its own window; the
// Brunello is three days out and inside its own.
const cancelButtons = page.locator('.cart-line__cancel');
note((await cancelButtons.count()) >= 1, `the guest is offered a cancellation (${await cancelButtons.count()})`);
const deadlineNote = (await page.locator('.cart-line__note').allTextContents()).join(' ');
note(/fino al|until/i.test(deadlineNote), 'with the deadline printed next to it');

// The confirmation is in front of the request, not behind it: this is the one
// button in the guide that moves money.
let asked = '';
page.once('dialog', (dialog) => { asked = dialog.message(); dialog.accept(); });
const linesBefore = await page.locator('.cart-line').count();
await cancelButtons.first().click();
await page.waitForTimeout(1200);

note(/rimborsiamo|refund/i.test(asked), `it asks first, in money terms (${asked.replace(/\s+/g, ' ').slice(0, 70)})`);
note((await page.locator('.cart-line--cancelled').count()) >= 1, 'the cancelled line stays, struck through');
note((await page.locator('.cart-line').count()) === linesBefore, 'nothing is removed from the record');
const afterCancel = (await page.locator('.cart-line__note').allTextContents()).join(' ');
note(/annullato|cancelled/i.test(afterCancel), 'and it says it was cancelled');
note(/rimborsat|refunded/i.test(afterCancel), 'and what came back');
await page.screenshot({ path: `${OUT}/order-cancelled-390.png` });

// The Privilege Card is sold outright, so it is never offered a cancel button.
await page.goto(`${BASE}#/product/privilege-card`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const cardPolicy = await page.textContent('.terms--policy').catch(() => '');
note(/non annullabile|not cancellable/i.test(cardPolicy), `the card says it cannot be cancelled (${cardPolicy.replace(/\s+/g, ' ').trim().slice(0, 60)})`);
await page.click('.sheet [data-close]');
await page.waitForTimeout(400);

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
await page.check('input[name="variantId"][value="5d"]', { force: true });
await page.fill('input[name="date"]', today);
await page.fill('input[name="field:holderName"]', 'Jacopo Lunardi');
await page.waitForTimeout(400);
const cardSummary = await page.textContent('[data-summary]');
note(/25/.test(cardSummary), `the five-day card is EUR 25 (${cardSummary.replace(/\s+/g, ' ').trim().slice(0, 40)})`);

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
await page.waitForTimeout(1300);

const cardText = await page.textContent('.sheet__body');
note(await page.isVisible('.privilege-card'), 'the card screen opens');
// The mark used to be drawn in CSS next to the title; it is now in the artwork —
// the LA lock-up is the centre of the voucher's own painting — so what is checked is
// that the card is actually wearing that painting.
const cardPlate = await page.evaluate(() => getComputedStyle(
  document.querySelector('.privilege-card'), '::before').backgroundImage);
// Not named: the artwork is allowed to change, and `qa:pass` is what checks that
// every card face wears the *same* one. Here it only has to be wearing a real image.
note(/\.webp/.test(cardPlate), `it carries the LunArt artwork (${cardPlate.match(/[^/]+\.webp/)?.[0] ?? cardPlate.slice(0, 40)})`);
const cardMark = await page.evaluate(() => {
  const img = document.querySelector('.privilege-card .pass__mark');
  return img ? img.naturalWidth > 0 : false;
});
note(cardMark, 'and the LunArt mark, since the artwork no longer contains one');
// Named on the screen, not necessarily on the card. The face used to repeat
// "LunArt Privilege Card" under a mark that already said LunArt; the sheet's own
// title carries the product name and the face carries the tier chip.
const cardScreen = await page.textContent('.sheet');
note(/Privilege Card/i.test(cardScreen), 'and names the product');
note(/privilege/i.test(await page.textContent('.privilege-card__kind')), 'with the tier on the card itself');
note(/Jacopo Lunardi/.test(cardText), 'it shows the holder');
note(/2 (persone|guests)/i.test(cardText), 'it says it is valid for two');
note(await page.isVisible('.card-qr__frame svg'), 'a QR is drawn');
note((await page.locator('.sheet .status-pill').allTextContents()).some((t) => /Attiva|Active/.test(t)),
  'it shows the status');
note(await page.isVisible('.privileges'), 'privileges are listed');
// Whatever card partner the preview has, with its benefit — and never the Opera
// Caffè 30%, which comes with the stay and is listed in the guide instead.
const privilegeText = await page.textContent('.privileges');
note(privilegeText.trim().length > 20, 'with the partner and the benefit');
note(!/Opera Caff/.test(privilegeText), 'the stay benefit is not sold as a card benefit');
await page.screenshot({ path: `${OUT}/card-390.png` });

// The rotation is deliberately invisible: a membership card should not read like
// a security product.
note((await page.locator('[data-countdown]').count()) === 0, 'no countdown is shown');
for (const phrase of ['si aggiorna', 'prossimo codice', 'scade', 'refresh', 'countdown']) {
  note(!cardText.toLowerCase().includes(phrase), `the screen never says "${phrase}"`);
}

// ...but it is still rotating underneath.
const qrUrl = await page.evaluate(async () => {
  const token = JSON.parse(localStorage.getItem('lunart.cards.v1'))[0];
  const card = await (await fetch(`/api/card/${token}`)).json();
  return card.qr;
});
note(/\/validate-card\?c=.+&k=/.test(qrUrl), 'the QR points at a validation URL');

/* ── The venue's own page ─────────────────────────────────────────────── */
console.log('\n── partner page ──');
const scanned = new URL(qrUrl);
const reference = scanned.searchParams.get('c');
const code = scanned.searchParams.get('k');

const venue = await context.newPage();
await venue.goto(`${BASE}partner/opera-caffe`, { waitUntil: 'networkidle' });
await venue.waitForTimeout(800);
note((await venue.textContent('#partner-name')).includes('Opera'), 'the page knows which venue it belongs to');
note((await venue.locator('link[rel="manifest"]').count()) === 1, 'it offers its own home-screen install');

await venue.goto(`${BASE}partner/opera-caffe?c=${reference}&k=${code}`, { waitUntil: 'networkidle' });
await venue.waitForTimeout(1000);
note((await venue.getAttribute('#verdict', 'data-tone')) === 'good', 'a scan shows the card as valid');
const verdictText = await venue.textContent('#verdict');
note(/CARD VALID/.test(verdictText), 'in the agreed words');
note(/Jacopo Lunardi/.test(verdictText), 'with the holder');
note(/2 persone/.test(verdictText), 'the two-guest limit');
note(/Opera Caff/.test(verdictText) && /30%/.test(verdictText), 'and that venue’s own benefit');
await venue.screenshot({ path: `${OUT}/partner-390.png` });

// Scanned again and again: a card is a membership, not a voucher book.
for (let scan = 0; scan < 3; scan++) {
  await venue.reload({ waitUntil: 'networkidle' });
  await venue.waitForTimeout(700);
}
note((await venue.getAttribute('#verdict', 'data-tone')) === 'good', 'repeated scans stay valid — nothing is consumed');

await venue.goto(`${BASE}partner/opera-caffe?c=ZZZZZZ&k=ZZZZZZ`, { waitUntil: 'networkidle' });
await venue.waitForTimeout(900);
note((await venue.getAttribute('#verdict', 'data-tone')) === 'bad', 'an invented code is refused');
note(/CARD NOT VALID/.test(await venue.textContent('#verdict')), 'in the agreed words');
await venue.screenshot({ path: `${OUT}/partner-invalid-390.png` });
await venue.close();

/* ── Private Hair Service ─────────────────────────────────────────────── */
console.log('\n── private hair service ──');
await page.evaluate(() => localStorage.removeItem('lunart.cart.v1'));
await page.goto(`${BASE}#/product/hair-service`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

note(await page.isVisible('.product-form'), 'the hair service opens');
const services = await page.locator('.chip--choice').count();
note(services === 6, `every bookable service is listed (${services})`);
const serviceText = await page.textContent('.product-form');
note(!/cerimonia|ceremony/i.test(serviceText), 'the ceremony styling is not shown at all');
// Colour is absent from the choices; the terms do mention it, to say it is not
// available, which is the point.
const serviceLabels = await page.locator('.chip--choice').allTextContents();
note(!serviceLabels.some((label) => /colore|colour|highlight|balayage/i.test(label)),
  'no colour service is offered');
// Every `.terms` paragraph, not the first one: the sheet now opens its small print
// with the cancellation policy, and the prose this is looking for is below it.
const serviceTerms = (await page.locator('.terms').allTextContents()).join(' ');
note(/non sono al momento disponibili|are not available at the moment/i.test(serviceTerms),
  'and the terms say so plainly');

const dayOptions = await page.locator('select[name="date"] option').count();
note(dayOptions > 1, `only days the professional is free are offered (${dayOptions - 1})`);
note(await page.locator('select[name="time"]').isDisabled(), 'the time cannot be picked before the day');

// Chosen by value, not by label: this browser runs in English.
await page.check('input[name="variantId"][value="women-cut-blow"]', { force: true });
await page.selectOption('select[name="date"]', { index: 1 });
await page.waitForTimeout(900);
const timeOptions = await page.locator('select[name="time"] option').count();
note(timeOptions > 1, `times appear once a day is chosen (${timeOptions - 1})`);

await page.selectOption('select[name="time"]', { index: 1 });
await page.fill('input[name="room"]', '303');
await page.fill('input[name="field:guestName"]', 'Jacopo Lunardi');
await page.fill('input[name="field:phone"]', '+39 392 472 5263');
await page.waitForTimeout(500);
const hairSummary = await page.textContent('[data-summary]');
note(/95/.test(hairSummary), `the price follows the service (${hairSummary.replace(/\s+/g, ' ').trim().slice(0, 36)})`);
await page.screenshot({ path: `${OUT}/hair-390.png` });

await page.click('[data-add]');
await page.waitForTimeout(700);
note(await page.isVisible('.cart-line'), 'it goes in the basket');
await page.fill('input[name="name"]', 'Jacopo Lunardi');
await page.fill('input[name="email"]', 'jacopo@example.com');
await page.click('.checkout-form button[type="submit"]');
await page.waitForURL(/mock-checkout/, { timeout: 8000 });
await page.click('[data-pay]');
await page.waitForURL(/#\/order\//, { timeout: 8000 });
await page.waitForTimeout(900);
note(/pagato|paid/i.test(await page.textContent('.status-pill')), 'the booking is paid');
note(/Hair Service/i.test(await page.textContent('.sheet__body')), 'the order names the service');
await page.screenshot({ path: `${OUT}/hair-order-390.png` });

note(errors.length === 0, `no page errors during interaction (${errors.slice(0, 2).join(' | ') || 'none'})`);

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
