# The LunArt mark

**This folder is empty on purpose.** LunArt's artwork has not been handed over yet,
and the guide will not ship an invented one.

## What to put here

| file | what it is | where it appears |
|---|---|---|
| `lunart-wordmark.svg` | the horizontal wordmark, on its own — no tagline, no frame, no background | the header of the guest guide, top left |

Requirements, and they are all about one thing — it is drawn at **22 px tall on a
phone**, next to three icons:

- **SVG, not PNG.** It is redrawn at every screen density and inside the sheet.
- **Horizontal lock-up.** The slot is about 150 × 22 CSS px. A stacked or square
  mark will be scaled down until it is unreadable.
- **No background.** Transparent. The header is warm white and goes translucent
  when the page scrolls under it.
- **One colour, and let it be inherited.** Use `fill="currentColor"` — or plain
  black, which the stylesheet recolours. The mark has to work on warm white today
  and on anything the guide is themed to later.
- **Trimmed.** No padding baked into the viewBox; the header does the spacing.

Drop the file in, and that is the whole job: `src/ui/brand.js` looks for it at
startup and swaps it in for the text if it is there. Nothing else changes — no
code, no CSS, no build step. If the file is absent, or malformed, the typographic
wordmark stays and nothing breaks.

To check it landed: open the guide and look at the top left. `LUNART` set in
letterspaced Cormorant is the fallback; the artwork is the artwork.

## What is already here, and is not this

`assets/icon.svg` is the **app icon** — the "LA" monogram on a dark rounded tile,
for the home-screen shortcut and the PWA manifest. It is a 512 × 512 square built
for an icon grid, so it is not the header mark and should not be stretched into one.
