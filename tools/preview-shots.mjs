#!/usr/bin/env node
/**
 * One screenshot per preview path, at phone size.
 *
 * For when the preview cannot be shared as a URL: the same pages, as pictures,
 * so they can be looked at without running anything.
 */
import { chromium, devices } from 'playwright';
import { mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = new URL('.preview/', import.meta.url).pathname;
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

const browser = await launch();
const context = await browser.newContext({ ...devices['iPhone 13'] });
const page = await context.newPage();

const staff = await (await fetch(`${BASE}/api/staff/reservations`)).json();
const live = staff.reservations.find((r) => r.status === 'active' || r.status === 'modified');
const link = live
  ? (await (await fetch(`${BASE}/api/staff/reservations/${live.id}/link`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  })).json()).link
  : null;

const shots = [
  ['guide', `${BASE}/`],
  ['guide-personal', link],
  ['shop', `${BASE}/#/product/hair-service`],
  ['staff', `${BASE}/staff`],
  ['recover', `${BASE}/recover`],
  ['validate-card', `${BASE}/validate-card`],
  ['partner', `${BASE}/partner/opera-caffe`],
].filter(([, url]) => url);

for (const [name, url] of shots) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: false });
  console.log(`${name.padEnd(16)} ${url}`);
}

await browser.close();
