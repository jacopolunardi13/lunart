# Source photographs

These are the original files, recovered from the base64 blobs that were inlined in
the pre-v2 `index.html`. They are the only copy we hold, so they stay in the repo
even though nothing serves them directly.

Everything under `assets/img/<folder>/` is generated from here by:

    node tools/optimize-images.mjs

The script never upscales and never overwrites: delete a derived file to rebuild it.
Add a new photo here, run the script, then reference it from `data/`.

## Room 304, and the two photographs that were in the wrong gallery

The owner confirmed room 304's Booking listing in October 2026, and two
attributions were wrong in opposite directions:

- `rooms/304-camera.jpg` was the desk-and-window shot. That is **room 302** — the
  same frame room 302 already held as `302-scrivania.jpg`, cropped tighter. It was
  removed from room 304 and *not* added to 302, because 302 already had it. It is
  archived here as `rooms/302-scrivania-crop.jpg`, which is what it actually is.
- `rooms/302-camera.jpg` was the grey-headboard shot, published as room 302. That
  room is **304**. It is archived under its old name and is no longer referenced;
  room 304 publishes the Booking frame of the same room instead, as
  `rooms/304-testiera.jpg`, once and in one gallery.

Three files were renamed into the rooms folder so that their names carry the
confirmed attribution:

| was | is now | shows |
|---|---|---|
| `views/finestra-arno.jpg` | `rooms/304-finestra.jpg` | the Arno through the window |
| `property/camera-finestra.jpg` | `rooms/304-letto.jpg` | the bed and the open window |
| `property/camera-dettaglio.jpg` | `rooms/304-testiera.jpg` | the grey padded headboard |

`rooms/304-bagno.jpg` was always right and stays.

**Nothing enters a room gallery under a `property/` or `views/` name.** Those are
the house's own pictures and belong to no room; every LunArt room is furnished the
same way, so a photograph is identified by what the owner says it is, not by what
it looks like. Re-attributing one means renaming it — which is why there is a test
that no room reaches outside `rooms/`, and another that no gallery holds a
photograph belonging to a different room.

## Brand and Pass artwork

Two folders here are not photographs of the property, and are not fed to the
responsive pipeline in the same spirit as the rest.

### `brand/lunart-logo.png`

LunArt's own mark — the LA lock-up with "Lun Art" set across it — 1024 × 1024,
transparent. It is the source for `assets/img/brand/lunart-wordmark.svg`, which
`node tools/make-brand-mark.mjs` traces from it. The script checks its own work
against this file and refuses to write a trace that differs by more than 0.1%.

The vector original (`/LunArt B&B/UFFICIO/logo/logo GPT lunart_hd.pdf` in Dropbox)
was not reachable from the machine this was built on. If it turns up, put the `.svg`
straight into `assets/img/brand/` and stop running the script — a real original
always beats a trace of a raster.

### `pass/lunart-voucher.jpg`

The front of the printed breakfast voucher: a watercolour of Florence with the LA
mark across it, 2048 × 1365. Extracted from
`LunArt_voucher_colazione_8.5x5.5cm_FONT_ELEGANTE_PIXART.pdf` with `pdfimages`, which
takes the embedded image at its native resolution rather than re-rendering the page —
so this is the artwork itself and not a screenshot of a PDF.

**It is unaltered, and it should stay that way.** The LunArt Pass is built on it with
the framing, the type and two soft washes all applied in CSS; nothing is baked in.
That is deliberate: the painting is the identity, and a card that needed the painting
darkened to be legible would be the wrong card. See `.pass` in `assets/css/app.css`.

The pale Arno duotone that preceded it (`lunart-pass.jpg`,
`lunart-pass-privilege.jpg`, and `tools/make-pass-plate.mjs`) was always a stand-in
for this file and was removed when it arrived.
