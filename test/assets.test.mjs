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
import { readFile, access } from 'node:fs/promises';
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

test('the Pass wears a plate for each tier, at both densities', async () => {
  for (const tier of ['lunart-pass', 'lunart-pass-privilege']) {
    // The source the plate is generated from, so it can be rebuilt or replaced.
    assert.ok(await exists(resolve(ROOT, `assets/img/_src/pass/${tier}.jpg`)), `${tier}.jpg source`);
    // And the two widths the card actually uses: 1x on a plain screen, 2x on a phone.
    for (const width of [700, 1024]) {
      assert.ok(await exists(resolve(ROOT, `assets/img/pass/${tier}-${width}.webp`)), `${tier}-${width}.webp`);
    }
  }

  const css = await readFile(resolve(ROOT, 'assets/css/app.css'), 'utf8');
  assert.match(css, /\.pass::before[^}]*lunart-pass-700\.webp/s, 'the standard plate is on .pass');
  assert.match(css, /\.pass--privilege::before[^}]*lunart-pass-privilege-700\.webp/s, 'and Privilege overrides it');
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

  /**
   * The artwork is deliberately absent, and this asserts that rather than tolerating
   * it: shipping an invented wordmark as "the LunArt logo" would be worse than the
   * typographic one the guide falls back to. Delete this assertion on the day the
   * real file lands.
   */
  assert.equal(
    await exists(resolve(ROOT, 'assets/img/brand/lunart-wordmark.svg')),
    false,
    'no wordmark has been provided yet; the header falls back to type on purpose',
  );
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
