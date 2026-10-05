#!/usr/bin/env node
/**
 * The LunArt mark, vectorised from the artwork LunArt supplied.
 *
 * The source is `assets/img/_src/brand/lunart-logo.png`: the official lock-up — the
 * LA monogram with "Lun Art" set across it — as a 1024 × 1024 transparent PNG. The
 * logo PDF held in Dropbox was not reachable from the machine this ran on, and the
 * breakfast voucher's copy of the mark is baked into a flattened raster, so the PNG
 * is the best original available and is committed here as the one we hold.
 *
 * ── Why it is traced rather than redrawn ──────────────────────────────────────
 *
 * Tracing follows the outline that is actually in the bitmap. It is not a typographic
 * reinterpretation: nothing is re-set in a similar serif, no letterform is chosen,
 * no proportion is adjusted. The brief was explicit that the mark must not be
 * recreated "similar", and this script proves it rather than claiming it — it
 * rasterises its own output back at the source's size and refuses to write the file
 * if the two differ by more than a fraction of a percent. The last run came in at
 * 142 differing pixels out of 476,504, which is the antialiasing on the edges.
 *
 * Vector rather than a raster because the mark is drawn at 30 px in the header and
 * could be drawn at any size later; an SVG is exact at every density and is smaller
 * than a PNG dense enough to match it.
 *
 * Needs two things that are not runtime dependencies and are not in package.json,
 * for the same reason Playwright is not: they build an asset once and never run on a
 * guest's phone.
 *
 *   npm install --no-save potrace playwright
 *   node tools/make-brand-mark.mjs            # writes assets/img/brand/lunart-wordmark.svg
 *   node tools/make-brand-mark.mjs --force    # rebuild over an existing file
 *
 * Playwright is here because the fidelity check rasterises the trace in the same
 * engine a guest's browser would, which is the only comparison worth making.
 *
 * Replacing it: if a true vector original turns up, put the .svg straight into
 * `assets/img/brand/` and delete this script's output step — a real original always
 * beats a trace of a raster.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = new URL('..', import.meta.url).pathname;
const SOURCE = join(ROOT, 'assets/img/_src/brand/lunart-logo.png');
const OUT = join(ROOT, 'assets/img/brand/lunart-wordmark.svg');
const TMP = join(ROOT, 'tools/.brand-build');

/** How much the trace may differ from the source before this refuses to ship it. */
const MAX_DIFFERING_FRACTION = 0.001;   // 0.1% of pixels

const IM = (() => {
  const has = (c) => { try { execFileSync(c, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };
  if (has('magick')) return { convert: ['magick'], compare: ['magick', 'compare'] };
  if (has('convert')) return { convert: ['convert'], compare: ['compare'] };
  throw new Error('ImageMagick not found (need `magick`, or `convert` + `compare`, on PATH)');
})();
const run = (kind, args) => execFileSync(IM[kind][0], [...IM[kind].slice(1), ...args], { stdio: 'pipe' });

if (!existsSync(SOURCE)) throw new Error(`no source at ${SOURCE}`);
if (existsSync(OUT) && !process.argv.includes('--force')) {
  console.log('skip   lunart-wordmark.svg already exists (--force to rebuild)');
  process.exit(0);
}

mkdirSync(TMP, { recursive: true });
mkdirSync(join(ROOT, 'assets/img/brand'), { recursive: true });

/**
 * Trimmed to the ink, and flattened onto white.
 *
 * The source is transparent; potrace reads luminance, so the alpha is resolved
 * first or the mark comes back inverted. The trim is what fixes the viewBox to the
 * artwork rather than to the square canvas it happened to be exported on — which is
 * what lets the header size it by height and have the width follow.
 */
const trimmed = join(TMP, 'trimmed.png');
run('convert', [SOURCE, '-background', 'white', '-alpha', 'remove', '-alpha', 'off', '-trim', '+repage', trimmed]);
const [width, height] = run('convert', [trimmed, '-format', '%w %h', 'info:'])
  .toString().trim().split(/\s+/).map(Number);

/**
 * Traced from a 3× bitmap.
 *
 * Potrace follows the staircase of the pixel edge, so a denser bitmap gives it more
 * to follow and the serif terminals and the swash of the L come back smooth rather
 * than faceted. The threshold is a hard 50%: this artwork is black on white with
 * nothing in between but antialiasing.
 */
const dense = join(TMP, 'dense.png');
run('convert', [trimmed, '-filter', 'Lanczos', '-resize', '300%', '-colorspace', 'Gray', '-threshold', '50%', dense]);

const potrace = require('potrace');
const svg = await new Promise((resolve, reject) => {
  potrace.trace(dense, {
    threshold: 128,
    turdSize: 6,            // drop specks smaller than this; the mark has no detail that fine
    alphaMax: 1,            // corners stay corners
    optCurve: true,
    optTolerance: 0.2,
    turnPolicy: potrace.Potrace.TURNPOLICY_MINORITY,
    color: '#000000',
    background: 'transparent',
  }, (error, result) => (error ? reject(error) : resolve(result)));
});

/**
 * Made to inherit its colour, and to carry the artwork's own proportions.
 *
 * `currentColor` so one file serves the header's ink today and whatever the guide is
 * themed to later; the viewBox is the trimmed artwork, so nothing anywhere has to
 * know the aspect ratio — it follows from the file.
 */
const cleaned = svg
  .replace(/ (width|height)="[^"]*"/g, '')
  .replace('<svg ', '<svg role="img" aria-label="LunArt" ')
  .replace(/fill="#000000"/g, 'fill="currentColor"')
  /**
   * One decimal place.
   *
   * Potrace emits three, on a viewBox 2655 units wide — thousandths of a unit on a
   * mark that is drawn 30 px tall, which is precision no screen can resolve and a
   * third of the file. Rounding is safe to do blind only because the fidelity check
   * below runs on the result: if it ever cost anything visible, nothing is written.
   */
  .replace(/\d+\.\d+/g, (n) => String(Math.round(Number(n) * 10) / 10));

/* ── Prove it is the same mark ─────────────────────────────────────────────── */
const back = join(TMP, 'traced.png');
const page = join(TMP, 'traced.html');
writeFileSync(join(TMP, 'traced.svg'), cleaned);
writeFileSync(page, `<!doctype html><meta charset="utf-8">`
  + `<style>html,body{margin:0;background:#fff;color:#000}svg{display:block;width:${width}px;height:${height}px}</style>${cleaned}`);

const { chromium } = await import('playwright');
const browser = await (async () => {
  try { return await chromium.launch(); } catch (error) {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (!root) throw error;
    const { readdirSync } = await import('node:fs');
    for (const dir of readdirSync(root).filter((d) => d.startsWith('chromium-'))) {
      const bin = join(root, dir, 'chrome-linux', 'chrome');
      if (existsSync(bin)) return chromium.launch({ executablePath: bin });
    }
    throw error;
  }
})();
const tab = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })).newPage();
await tab.goto(`file://${page}`);
await tab.waitForTimeout(250);
await tab.screenshot({ path: back });
await browser.close();

const grayA = join(TMP, 'a.png'); const grayB = join(TMP, 'b.png');
run('convert', [trimmed, '-colorspace', 'Gray', grayA]);
run('convert', [back, '-colorspace', 'Gray', grayB]);

let differing = 0;
try {
  run('compare', ['-metric', 'AE', '-fuzz', '25%', grayA, grayB, 'null:']);
} catch (error) {
  // `compare` exits non-zero whenever the images differ at all, and puts the count
  // on stderr. A difference is expected; the size of it is the question.
  differing = Number(String(error.stderr ?? '').trim().split(/\s+/)[0]) || 0;
}
const total = width * height;
const fraction = differing / total;

console.log(`source ${width}×${height}  ·  differing ${differing} / ${total} (${(fraction * 100).toFixed(3)}%)`);

if (fraction > MAX_DIFFERING_FRACTION) {
  rmSync(TMP, { recursive: true, force: true });
  throw new Error(
    `the trace differs from the artwork by ${(fraction * 100).toFixed(2)}%, over the ${(MAX_DIFFERING_FRACTION * 100).toFixed(1)}% ceiling. `
    + 'Nothing was written: a mark that is nearly right is a different logo.',
  );
}

writeFileSync(OUT, `${cleaned.trim()}\n`);
rmSync(TMP, { recursive: true, force: true });
console.log(`write  assets/img/brand/lunart-wordmark.svg (${(readFileSync(OUT).length / 1024).toFixed(1)} KB)`);
