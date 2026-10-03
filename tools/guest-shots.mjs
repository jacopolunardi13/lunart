#!/usr/bin/env node
/**
 * Phone-size screenshots of the guide a booked guest actually opens.
 *
 * The other QA tools answer "is it broken?"; this one answers "what does it look
 * like?", which is a question only a person can settle. It walks the personalised
 * home at 390 px — the top, the extras, the bottom bar, the guest's own room — in
 * both languages, and leaves the files in tools/.qa-screens/.
 *
 * It needs a server with a demo reservation behind it:
 *   LUNART_PREVIEW=1 STAFF_TOKEN=x node server/index.js &
 *   node tools/guest-shots.mjs
 *
 * Give it a personal link as an argument to shoot a particular stay; with none, it
 * reads the first one the preview seeded for itself.
 */
import { chromium, devices } from 'playwright';
import { mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = new URL('.qa-screens/', import.meta.url).pathname;
const BASE = (process.env.BASE_URL ?? 'http://localhost:4173/').replace(/\/$/, '');
await mkdir(OUT, { recursive: true });

/** The container ships its own Chromium; use it rather than downloading another. */
async function launch() {
  try {
    return await chromium.launch();
  } catch (error) {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (!root) throw error;
    for (const dir of (await readdir(root)).filter((d) => d.startsWith('chromium-'))) {
      const executablePath = join(root, dir, 'chrome-linux', 'chrome');
      if (existsSync(executablePath)) return chromium.launch({ executablePath });
    }
    throw error;
  }
}

/** A personal link: the one given, or the first the preview invented for itself. */
async function personalLink() {
  const given = process.argv[2];
  if (given) return given;
  const page = await (await fetch(`${BASE}/preview`)).text().catch(() => '');
  const match = /https?:\/\/[^"]*\/g\/[A-Za-z0-9_-]+/.exec(page);
  if (!match) {
    throw new Error('No personal link found. Pass one as an argument, or run the server with LUNART_PREVIEW=1.');
  }
  // The preview prints its own origin, which is not necessarily the one we asked.
  return match[0].replace(/^https?:\/\/[^/]+/, BASE);
}

const link = await personalLink();
const browser = await launch();
const shots = [];

for (const lang of ['it', 'en']) {
  const context = await browser.newContext({ ...devices['iPhone 13'], locale: lang === 'it' ? 'it-IT' : 'en-GB' });
  const page = await context.newPage();
  const shot = async (name) => {
    const path = `${OUT}/guest-${name}-${lang}.png`;
    await page.screenshot({ path });
    shots.push(path);
  };

  await page.goto(link, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);

  // 1. The top: who they are, which room, which dates, and the four actions.
  await shot('home-top');

  // 2. The guest's own room, which is the only one on this page.
  await page.locator('.room--assigned').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot('room');

  // 3. Experiences & Extras, as an offer rather than a menu.
  await page.locator('.offers').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot('extras');

  // 4. The bottom of the page, and with it the bar that is always there.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(600);
  await shot('bottom-nav');

  // 5. One fold open, because the point of the short home is what is behind it.
  await page.click('#fold-stay .fold__summary');
  await page.waitForTimeout(400);
  await page.locator('#fold-stay').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot('fold-open');

  await page.screenshot({ path: `${OUT}/guest-home-full-${lang}.png`, fullPage: true });
  shots.push(`${OUT}/guest-home-full-${lang}.png`);
  await context.close();
}

await browser.close();
console.log(shots.map((s) => s.replace(OUT, '')).join('\n'));
console.log(`\n${shots.length} screenshots in ${OUT}`);
