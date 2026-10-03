#!/usr/bin/env node
/**
 * Measures what a phone actually downloads on a first visit.
 *
 * Counts bytes over the wire with an empty cache, which is the number that
 * matters to a guest on roaming data outside the front door. Pass two URLs to
 * compare (the pre-v2 page is recoverable with
 * `git show origin/main:index.html`).
 *
 * Usage: node tools/measure.mjs <url> [label] [...more url label pairs]
 */
import { chromium } from 'playwright';
import { gzipSync } from 'node:zlib';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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

const pairs = [];
for (let i = 2; i < process.argv.length; i += 2) pairs.push([process.argv[i], process.argv[i + 1] ?? process.argv[i]]);
if (pairs.length === 0) { console.error('usage: node tools/measure.mjs <url> [label] ...'); process.exit(1); }

const browser = await launch();
const rows = [];

for (const [url, label] of pairs) {
  // A fresh context each time, so nothing is served from a warm cache.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();

  const byType = new Map();
  let total = 0;
  let compressed = 0;
  let requests = 0;

  page.on('response', async (response) => {
    requests++;
    try {
      const body = await response.body();
      const type = (response.headers()['content-type'] ?? '').split(';')[0] || 'other';
      byType.set(type, (byType.get(type) ?? 0) + body.length);
      total += body.length;
      // The dev server sends everything uncompressed. Any real host — GitHub Pages
      // included — gzips text, and images and fonts are already compressed, so
      // this is what a guest's connection actually carries.
      const alreadyCompressed = /image|font|video|zip|gzip/.test(type);
      compressed += alreadyCompressed ? body.length : gzipSync(body, { level: 9 }).length;
    } catch { /* redirects and aborted requests carry no body */ }
  });

  const started = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  const loaded = Date.now() - started;
  await page.waitForTimeout(1500);   // let lazy images settle

  const paint = await page.evaluate(() => {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const nav = performance.getEntriesByType('navigation')[0];
    return { fcp: fcp ? Math.round(fcp.startTime) : null, domReady: nav ? Math.round(nav.domContentLoadedEventEnd) : null };
  });

  rows.push({ label, total, compressed, requests, loaded, ...paint, byType: [...byType.entries()].sort((a, b) => b[1] - a[1]) });
  await context.close();
}

await browser.close();

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
for (const row of rows) {
  console.log(`\n── ${row.label} ──`);
  console.log(`  transferred   ${kb(row.total)} raw · ${kb(row.compressed)} as a real host would send it, over ${row.requests} requests`);
  console.log(`  first paint   ${row.fcp ?? '?'} ms      DOM ready ${row.domReady ?? '?'} ms      load ${row.loaded} ms`);
  for (const [type, bytes] of row.byType) console.log(`    ${type.padEnd(26)} ${kb(bytes)}`);
}

if (rows.length === 2) {
  const [before, after] = rows;
  const saved = before.compressed - after.compressed;
  console.log(`\n  ${rows[1].label} is ${kb(saved)} lighter — ${(100 * saved / before.compressed).toFixed(1)}% less than ${rows[0].label}`);
}
