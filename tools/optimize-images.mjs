#!/usr/bin/env node
/**
 * Generates responsive WebP + JPEG fallback variants from the source photos.
 *
 * Sources live in assets/img/_src (committed once, never served).
 * Output lands next to them as <name>-<width>.webp / <name>-800.jpg.
 *
 * Usage: node tools/optimize-images.mjs [--check]
 *   --check  only report what would change, write nothing
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'assets/img/_src');
const WIDTHS = [400, 700, 1024];
const FALLBACK_WIDTH = 800;
const check = process.argv.includes('--check');

/**
 * ImageMagick 7 exposes every operation as `magick <subcommand>`; version 6 ships
 * `convert` and `identify` as separate binaries. Resolve both shapes once.
 */
const IM = (() => {
  const has = (c) => { try { execFileSync(c, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };
  if (has('magick')) return { convert: ['magick'], identify: ['magick', 'identify'] };
  if (has('convert')) return { convert: ['convert'], identify: ['identify'] };
  throw new Error('ImageMagick not found (need `magick`, or `convert` + `identify`, on PATH)');
})();
const run = (kind, args) => execFileSync(IM[kind][0], [...IM[kind].slice(1), ...args], { stdio: 'pipe' });

/**
 * Folders under `_src` this sweep leaves alone.
 *
 * `brand/` holds the logo, whose source of record is a transparent PNG and whose
 * output is a vector built by `tools/make-brand-mark.mjs`. Swept through here it
 * produced four raster sizes nothing references, one of them flattened onto white —
 * a logo with its transparency silently removed, sitting next to the real one.
 *
 * `_archive/` holds real LunArt assets that are not in use: the breakfast voucher
 * the Pass wore before the painting, kept so reverting is possible. They are sources
 * worth keeping and derivatives worth not shipping — left in the sweep, every run
 * put four unused files back into the deployed tree.
 */
const SKIP = new Set(['brand', '_archive']);

function* sources(dir, folder = '') {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) yield* sources(p, entry.name);
    } else if (/\.(jpe?g|png)$/i.test(entry.name)) yield p;
  }
}

let written = 0, skipped = 0, bytes = 0;
for (const src of sources(SRC)) {
  const rel = src.slice(SRC.length + 1);
  const outDir = join(ROOT, 'assets/img', dirname(rel));
  const name = basename(rel, extname(rel));
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const srcWidth = Number(run('identify', ['-format', '%w', src]).toString().trim());

  for (const w of WIDTHS) {
    // Never upscale: a 1024px source has no business pretending to be wider.
    if (w > srcWidth && w !== Math.min(...WIDTHS.filter((x) => x >= srcWidth))) continue;
    const target = Math.min(w, srcWidth);
    const out = join(outDir, `${name}-${w}.webp`);
    if (existsSync(out)) { skipped++; bytes += statSync(out).size; continue; }
    if (check) { console.log('would write', out); written++; continue; }
    run('convert', [src, '-auto-orient', '-strip', '-resize', `${target}x`, '-quality', '78',
                    '-define', 'webp:method=6', out]);
    written++; bytes += statSync(out).size;
  }

  const fb = join(outDir, `${name}-${FALLBACK_WIDTH}.jpg`);
  if (!existsSync(fb)) {
    if (check) { console.log('would write', fb); written++; }
    else {
      run('convert', [src, '-auto-orient', '-strip', '-resize', `${Math.min(FALLBACK_WIDTH, srcWidth)}x`,
                      '-quality', '72', '-sampling-factor', '4:2:0', '-interlace', 'JPEG', fb]);
      written++; bytes += statSync(fb).size;
    }
  } else { skipped++; bytes += statSync(fb).size; }
}

console.log(`${check ? 'check' : 'done'}: ${written} written, ${skipped} up to date, ${(bytes / 1024).toFixed(0)} KB total`);
