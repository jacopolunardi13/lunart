#!/usr/bin/env node
/**
 * The LunArt Pass artwork, derived from LunArt's own view of the Arno.
 *
 * The Pass is a card a guest holds. Drawn as a dark rounded rectangle it reads as a
 * status panel; drawn on a plate it reads as a tessera somebody handed them. What it
 * should eventually wear is the printed identity of the breakfast vouchers — and
 * until that file exists, the honest stand-in is not an invented monogram but the
 * photograph the whole guide is already built around: the Uffizi loggia and the
 * river, seen from the apartment.
 *
 * Treated rather than cropped. A snapshot behind type is a snapshot; this is pushed
 * towards a printed plate — near-greyscale, then mapped between two brand inks, so
 * the result is a duotone in LunArt's own colours rather than a photograph with a
 * filter on it.
 *
 * Contrast is **not** this file's job. The plate is deliberately mid-dark and even;
 * the legibility of the holder's name over it is guaranteed by a CSS scrim in
 * `.pass__face`, which is a gradient we control and can test, rather than by hoping
 * a photograph happens to be dark in the corner where the type sits.
 *
 *   node tools/make-pass-plate.mjs      # writes assets/img/_src/pass/*.jpg
 *   node tools/optimize-images.mjs      # then the usual webp/jpg derivatives
 *
 * ── Replacing this with the real artwork ──────────────────────────────────────
 * Drop the final file at `assets/img/_src/pass/lunart-pass.jpg` (and
 * `lunart-pass-privilege.jpg`), run `node tools/optimize-images.mjs`, and the card
 * wears it. Nothing else changes: no code, no CSS, no build. Do not run this script
 * afterwards — it would overwrite the real thing.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SOURCE = join(ROOT, 'assets/img/_src/views/arno-uffizi.jpg');
const OUT = join(ROOT, 'assets/img/_src/pass');

const IM = (() => {
  const has = (c) => { try { execFileSync(c, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };
  if (has('magick')) return ['magick'];
  if (has('convert')) return ['convert'];
  throw new Error('ImageMagick not found (need `magick`, or `convert`, on PATH)');
})();
const convert = (args) => execFileSync(IM[0], [...IM.slice(1), ...args], { stdio: 'pipe' });

/**
 * The two plates.
 *
 * `ink` is what black becomes, `light` is what white becomes: the duotone's two
 * ends. Privilege is the same frame with a deeper ink and a gold high end, so the
 * upgrade reads as *the same card, better* rather than as a different object —
 * which is what actually happened to the guest.
 */
const PLATES = [
  { name: 'lunart-pass', ink: '#1a1610', light: '#c8b794', saturation: 15, brightness: 86 },
  /**
   * Privilege is *darker* than the standard plate, not brighter.
   *
   * It read as the premium one for about a minute, and then as the unreadable one:
   * a pale gold high end put white type at 2.05:1. Premium here is the hue, the
   * border and the chip — not luminance. The plate is deepened and the gold pushed
   * towards bronze so the type clears AA on the card that costs money.
   */
  { name: 'lunart-pass-privilege', ink: '#120d05', light: '#9c7a33', saturation: 26, brightness: 72 },
];

/** 85.6 × 54 — the proportions of a real card, which is what the Pass is drawn at. */
const RATIO = 85.6 / 54;

mkdirSync(OUT, { recursive: true });

for (const plate of PLATES) {
  const target = join(OUT, `${plate.name}.jpg`);
  if (existsSync(target) && !process.argv.includes('--force')) {
    console.log(`skip   ${plate.name}.jpg (exists; --force to rebuild)`);
    continue;
  }

  convert([
    SOURCE,
    // The loggia, the wall and the water. The sky is cropped away: it is the one
    // part of this frame with nothing Florentine in it.
    '-gravity', 'center',
    '-crop', `1024x${Math.round(1024 / RATIO)}+0+40`,
    '+repage',
    // Towards a plate: drop most of the colour, then map the greys between two inks.
    '-modulate', `${plate.brightness},${plate.saturation},100`,
    // Plate tonality rather than photographic: the midtones are pulled apart and
    // the highlights held down, so the architecture becomes a suggestion instead of
    // a subject competing with the guest's name.
    '-sigmoidal-contrast', '3,52%',
    '+level-colors', `${plate.ink},${plate.light}`,
    // A soft vignette, so the edges fall away rather than stopping.
    '-background', plate.ink,
    '(', '+clone', '-alpha', 'extract',
    '-virtual-pixel', 'background', '-background', 'black', '-blur', '0x24',
    ')',
    '-alpha', 'off', '-compose', 'copy_opacity', '-composite',
    '-background', plate.ink, '-alpha', 'remove', '-alpha', 'off',
    '-quality', '88',
    target,
  ]);
  console.log(`write  ${plate.name}.jpg`);
}
