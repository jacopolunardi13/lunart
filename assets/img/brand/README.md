# The LunArt mark

`lunart-wordmark.svg` is the mark in the guide's header. It is a faithful vector
trace of the artwork LunArt supplied, not a redrawing.

## Where it came from

| | |
|---|---|
| **source** | `assets/img/_src/brand/lunart-logo.png` — the official lock-up (LA monogram with "Lun Art" set across it), 1024 × 1024, transparent |
| **built by** | `node tools/make-brand-mark.mjs` |
| **output** | `lunart-wordmark.svg`, viewBox 2655 × 1596 — the artwork's own proportions, 1.66 : 1 |
| **fidelity** | 147 pixels of 470,820 differ from the source (0.031%), which is the antialiasing on the edges |

The logo PDF in Dropbox (`/LunArt B&B/UFFICIO/logo/logo GPT lunart_hd.pdf`) was not
reachable from the machine this was built on, and the breakfast voucher's copy of the
mark is baked into a flattened raster, so the PNG was the best original available.

Nothing was re-set, re-spaced or chosen: the trace follows the outline that is in the
bitmap, and `make-brand-mark.mjs` rasterises its own output back at the source's size
and **refuses to write the file** if more than 0.1% of pixels differ. A mark that is
nearly right is a different logo.

## If a true vector original turns up

Put the `.svg` straight into this folder as `lunart-wordmark.svg` and stop running
the build script. A real original always beats a trace of a raster — and it will be
smaller than this file’s 27 KB of path data.

Whatever replaces it must still be: **horizontal or stacked but trimmed to the ink**
(the header sizes by height and lets the width follow from the viewBox),
**transparent**, and **one colour** — `fill="currentColor"`, which the header
resolves. No baked-in padding; the header does the spacing.

## How it is loaded

`src/ui/brand.js` loads it off-document and only puts it in the header once it has
decoded, then sets `data-logo` so the stylesheet knows. If the file is missing or
malformed the typographic wordmark in `index.html` stays and nothing breaks — which
is what happens on any deployment that has not got this file.

It is drawn at 30 px tall. That is the size at which the monogram reads and "Lun Art"
is still legible as words; smaller and the inner line closes into a grey bar.

## What is already here, and is not this

`assets/icon.svg` is the **app icon** — the "LA" monogram on a dark rounded tile, for
the home-screen shortcut and the PWA manifest. It is a 512 × 512 square built for an
icon grid, so it is not the header mark and should not be stretched into one.
