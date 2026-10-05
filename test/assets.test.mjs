/**
 * The files the stylesheets and the code actually ask for.
 *
 * This suite exists because of a bug that was invisible in every other one. The Pass
 * set its artwork through an inline `--pass-artwork` custom property, and a relative
 * `url()` inside a custom property resolves against the *stylesheet* that consumes
 * it rather than the element — so `assets/img/pass/…` was fetched as
 * `/assets/css/assets/img/pass/…`. The dev server answers `200 text/html` for any
 * unknown path, so the browser received a page where an image should have been,
 * reported nothing, and painted an empty layer. The card looked generic for weeks
 * and no test, no console and no network panel said why.
 *
 * So: every asset a stylesheet references is resolved the way a browser would
 * resolve it, and checked against the disk.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, stat } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const exists = async (path) => { try { await access(path); return true; } catch { return false; } };

const STYLESHEETS = ['assets/css/app.css', 'assets/css/staff.css', 'assets/css/fonts.css'];

/** Every `url(...)` in a stylesheet, with the line it was on. */
function urlsIn(css) {
  const found = [];
  css.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      found.push({ url: match[1].trim(), line: index + 1 });
    }
  });
  return found;
}

test('every asset a stylesheet asks for is actually there', async () => {
  for (const sheet of STYLESHEETS) {
    const css = await readFile(resolve(ROOT, sheet), 'utf8');
    for (const { url, line } of urlsIn(css)) {
      if (/^(data:|https?:|#)/.test(url)) continue;
      // Resolved against the stylesheet's own folder, which is what a browser does.
      const target = resolve(ROOT, dirname(sheet), url);
      assert.ok(
        await exists(target),
        `${sheet}:${line} asks for ${url}, which resolves to ${relative(ROOT, target)} and is not there`,
      );
    }
  }
});

test('no stylesheet asset is addressed through a custom property', async () => {
  /**
   * The bug this file was written for.
   *
   * `background-image: var(--something)` where the variable was set inline carries a
   * relative URL that resolves against the wrong base. It is legal CSS, it throws
   * nothing, and it silently fetches the wrong path — so the rule is simply that
   * asset URLs live in the stylesheet, where the base is the stylesheet's own.
   */
  for (const sheet of STYLESHEETS) {
    const css = await readFile(resolve(ROOT, sheet), 'utf8');
    // `{` is excluded as well as `;` and `}`: without it the pattern walks out of a
    // selector like `.pass--privilege::before` and into the rule it opens.
    for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]*url\([^;{}]*)/g)) {
      assert.fail(`${sheet}: ${name} carries a url() (${value.trim().slice(0, 60)}…) — put it in a rule, not a variable`);
    }
  }
});

test('the Pass wears the voucher, at both densities', async () => {
  // The source, so the artwork can be rebuilt or replaced: the front of LunArt's
  // printed breakfast voucher, extracted from the PDF at its native resolution.
  assert.ok(await exists(resolve(ROOT, 'assets/img/_src/pass/lunart-voucher.jpg')), 'the voucher source is kept');

  // The two widths the card actually uses: 1x on a plain screen, 2x on a phone.
  for (const width of [700, 1024]) {
    assert.ok(await exists(resolve(ROOT, `assets/img/pass/lunart-voucher-${width}.webp`)), `lunart-voucher-${width}.webp`);
  }

  // Nothing heavy reaches a guest. The 1024 is what a dense phone takes.
  const { size } = await stat(resolve(ROOT, 'assets/img/pass/lunart-voucher-1024.webp'));
  assert.ok(size < 120 * 1024, `the served artwork stays small (${(size / 1024).toFixed(0)} KB)`);
});

test('one artwork serves both tiers', async () => {
  /**
   * Privilege used to have a plate of its own, which made it a different card rather
   * than the same card upgraded. The brief was one graphic family, so the rule is now
   * structural: every rule that paints a card face points at the same file, and the
   * tier is carried by the edge and the chip.
   */
  const css = await readFile(resolve(ROOT, 'assets/css/app.css'), 'utf8');
  const faces = [...css.matchAll(/\.(pass|privilege-card)::before\s*\{[^}]*\}/gs)].map((m) => m[0]);
  assert.equal(faces.length, 2, 'the Pass and the venue card are the two faces');
  for (const face of faces) {
    assert.match(face, /lunart-voucher-700\.webp/, 'at 1x');
    assert.match(face, /lunart-voucher-1024\.webp/, 'and at 2x');
  }

  // And no rule anywhere still reaches for the Arno stand-in that preceded it.
  assert.ok(!/lunart-pass(-privilege)?-\d+\.webp/.test(css), 'the stand-in plate is gone from the CSS');
  assert.equal(await exists(resolve(ROOT, 'assets/img/pass/lunart-pass-700.webp')), false, 'and from the assets');
});

test('the brand mark hook and its README agree on one path', async () => {
  const brand = await readFile(resolve(ROOT, 'src/ui/brand.js'), 'utf8');
  const path = /BRAND_WORDMARK = '([^']+)'/.exec(brand)?.[1];
  assert.ok(path, 'src/ui/brand.js exports the path it looks for');
  assert.equal(path, 'assets/img/brand/lunart-wordmark.svg');

  const readme = await readFile(resolve(ROOT, 'assets/img/brand/README.md'), 'utf8');
  assert.ok(
    readme.includes('lunart-wordmark.svg'),
    'the README names the file the code looks for, so the person providing it has one answer',
  );
});

test('the real LunArt mark is there, and is the artwork’s own shape', async () => {
  /**
   * This test used to assert the opposite — that no wordmark had been provided and
   * the header fell back to type on purpose. LunArt supplied the artwork, so it now
   * asserts the thing that actually matters: that the file is a usable mark and that
   * it still carries the proportions of the original rather than some convenient
   * square.
   */
  const file = resolve(ROOT, 'assets/img/brand/lunart-wordmark.svg');
  assert.ok(await exists(file), 'the mark is committed');

  const svg = await readFile(file, 'utf8');
  assert.match(svg, /^<svg\b/, 'it is an SVG and nothing else');
  assert.ok(!/<script/i.test(svg), 'with no script in it');
  assert.match(svg, /fill="currentColor"/, 'drawn in the ink it is given');
  assert.match(svg, /aria-label="LunArt"/, 'and named, since it replaces the words');

  // 885 × 532 trimmed to the ink — about 1.66 : 1. The header sizes by height and
  // lets the width follow, so the file is the only place this is written down.
  const [, w, h] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg) ?? [];
  assert.ok(w && h, 'it carries a viewBox');
  const ratio = Number(w) / Number(h);
  assert.ok(ratio > 1.6 && ratio < 1.73, `the artwork's own proportions are preserved (${ratio.toFixed(3)}:1)`);

  // No width/height attributes, or the header could not size it.
  assert.ok(!/<svg[^>]*\swidth=/.test(svg), 'and no baked-in width');

  // The source it was traced from is kept, so it can be rebuilt or replaced.
  assert.ok(await exists(resolve(ROOT, 'assets/img/_src/brand/lunart-logo.png')), 'the original is kept');
});

test('the custom-property rule would catch the bug it was written for', async () => {
  // A guard on the guard: the first version of this check walked out of the selector
  // `.pass--privilege::before` and failed on it, which is the kind of false positive
  // that gets a test deleted rather than fixed.
  const { readFile: read } = await import('node:fs/promises');
  const real = await read(resolve(ROOT, 'assets/css/app.css'), 'utf8');
  const offending = /(--[\w-]+)\s*:\s*([^;{}]*url\([^;{}]*)/g;

  assert.equal(real.match(offending), null, 'the real stylesheet is clean');
  assert.ok(
    ".pass { --pass-artwork: url('../img/x.webp'); }".match(offending),
    'and the pattern still catches an asset hidden in a variable',
  );
  assert.equal(
    '.pass--privilege::before { background-image: url("../img/x.webp"); }'.match(offending),
    null,
    'while leaving a double-dash class name alone',
  );
});
