#!/usr/bin/env node
/**
 * Mobile and accessibility QA, driven through a real browser.
 *
 * Checks the things that were actually broken before: the navigation leaving the
 * viewport on a phone, horizontal overflow, tap targets too small to hit, images
 * without alt text, and the Concierge answering "avete biscotti?" with anything at
 * all. Screenshots land in tools/.qa-screens/ for a look by eye.
 *
 * Needs the preview server running:
 *   node tools/serve.mjs &
 *   npm install --no-save playwright && node tools/qa.mjs
 */
import { chromium, devices } from 'playwright';
import { mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = new URL('.qa-screens/', import.meta.url).pathname;
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
await mkdir(OUT, { recursive: true });
/**
 * The container ships a Chromium build under PLAYWRIGHT_BROWSERS_PATH. When the
 * installed playwright pins a different build number, point it at the one that is
 * actually here rather than downloading another copy.
 */
async function launch() {
  try {
    return await chromium.launch();
  } catch (error) {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (!root) throw error;
    const candidates = (await readdir(root))
      .filter((d) => d.startsWith('chromium-'))
      .map((d) => join(root, d, 'chrome-linux', 'chrome'));
    for (const executablePath of candidates) {
      if (existsSync(executablePath)) return chromium.launch({ executablePath });
    }
    throw error;
  }
}

const browser = await launch();
let failures = 0;
const note = (ok, msg) => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${msg}`); };

for (const width of [360, 390, 430]) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  console.log(`\n── ${width}px ──`);
  note(errors.length === 0, `no console errors (${errors.slice(0,3).join(' | ') || 'none'})`);

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
    wide: [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 5).map((el) => el.className || el.tagName),
  }));
  note(overflow.doc <= overflow.win + 1, `no horizontal overflow (doc ${overflow.doc} vs win ${overflow.win}) ${overflow.wide.join(', ')}`);

  const nav = await page.evaluate(() => {
    const r = document.querySelector('#tabbar').getBoundingClientRect();
    return { left: r.left, right: r.right, win: window.innerWidth, visible: r.width > 0 };
  });
  note(nav.left >= -1 && nav.right <= nav.win + 1 && nav.visible, `tabbar inside viewport (${nav.left}→${nav.right} of ${nav.win})`);

  const small = await page.evaluate(() => [...document.querySelectorAll('button, a[href]')]
    .filter((el) => el.offsetParent !== null)
    .map((el) => ({ c: el.className || el.tagName, h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width) }))
    .filter((x) => x.h < 40 || x.w < 40));
  note(small.length === 0, `tap targets >= 40px (${small.length} small: ${small.slice(0,4).map(s=>`${s.c} ${s.w}x${s.h}`).join(', ')})`);

  const counts = await page.evaluate(() => ({
    cards: document.querySelectorAll('.card').length,
    quick: document.querySelectorAll('.quick__item').length,
    sliders: document.querySelectorAll('[data-slider]').length,
    h1: document.querySelectorAll('h1').length,
    imgNoAlt: [...document.querySelectorAll('img')].filter((i) => !i.getAttribute('alt')).length,
  }));
  note(counts.cards > 10, `entry cards rendered (${counts.cards})`);
  note(counts.quick === 4, `quick actions rendered (${counts.quick})`);
  note(counts.h1 === 1, `exactly one h1 (${counts.h1})`);
  note(counts.imgNoAlt === 0, `every image has alt (${counts.imgNoAlt} missing)`);

  await page.screenshot({ path: `${OUT}/home-${width}.png`, fullPage: false });
  await context.close();
}

// Interaction pass at 390
const context = await browser.newContext({ ...devices['iPhone 13'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'networkidle' });
console.log('\n── interactions (390px) ──');

await page.click('.quick__item');
await page.waitForTimeout(450);
note(await page.isVisible('.sheet[data-open="true"]'), 'quick action opens the sheet');
note((await page.locator('.sheet__title').textContent()).length > 0, 'sheet has a title');
await page.screenshot({ path: `${OUT}/sheet-390.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(450);
note(!(await page.isVisible('.sheet[data-open="true"]')), 'Escape closes the sheet');

await page.click('#open-concierge');
await page.waitForTimeout(450);
note(await page.isVisible('.concierge[data-open="true"]'), 'concierge opens');
await page.fill('#concierge-input', 'qual è la password del wifi');
await page.press('#concierge-input', 'Enter');
await page.waitForTimeout(350);
const reply = await page.locator('.bubble--concierge').last().textContent();
note(reply.includes('LOPERACAFFE62R'), `concierge answers wifi (${reply.slice(0, 60).trim()}…)`);
await page.fill('#concierge-input', 'avete biscotti?');
await page.press('#concierge-input', 'Enter');
await page.waitForTimeout(350);
const fallback = await page.locator('.bubble--concierge').last().textContent();
note(!fallback.includes('culla') && !fallback.includes('cot'), `biscotti falls back (${fallback.slice(0, 50).trim()}…)`);
await page.screenshot({ path: `${OUT}/concierge-390.png` });
await page.click('.concierge [data-close]');
await page.waitForTimeout(450);

await page.click('[data-open-search]');
await page.waitForTimeout(300);
await page.fill('#search-input', 'colazione');
await page.waitForTimeout(300);
const results = await page.locator('#search-results .card').count();
note(results > 0, `search returns results (${results})`);
await page.screenshot({ path: `${OUT}/search-390.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

await page.click('[data-view="florence"]');
await page.waitForTimeout(400);
note((await page.locator('.place').count()) > 5, `florence view lists places (${await page.locator('.place').count()})`);
await page.screenshot({ path: `${OUT}/florence-390.png`, fullPage: false });

await page.click('[data-view="help"]');
await page.waitForTimeout(400);
note((await page.locator('.card').count()) > 4, 'help view lists contacts');
await page.screenshot({ path: `${OUT}/help-390.png` });

note(errors.length === 0, `no page errors during interaction (${errors.slice(0,2).join(' | ') || 'none'})`);

await browser.close();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
