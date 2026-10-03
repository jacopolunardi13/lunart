# Source photographs

These are the original files, recovered from the base64 blobs that were inlined in
the pre-v2 `index.html`. They are the only copy we hold, so they stay in the repo
even though nothing serves them directly.

Everything under `assets/img/<folder>/` is generated from here by:

    node tools/optimize-images.mjs

The script never upscales and never overwrites: delete a derived file to rebuild it.
Add a new photo here, run the script, then reference it from `data/`.

## One file whose name is wrong

`rooms/304-camera.jpg` is **not** room 304. The owner confirmed in October 2026
that it is room 302 — it is the same shot as `rooms/302-scrivania.jpg`, cropped
tighter, and 302 already carries the full version, so it was removed from room
304 and **not** added to 302: the photograph was already there.

It is kept here because this is the only copy we hold, but **do not reference it
from a room gallery**. The filename is the mistake, not a fact.

`rooms/304-bagno.jpg` is fine. The owner confirmed it is room 304's own bathroom,
and it is the one photograph that room currently has.

## Three files waiting on a name

The owner has verified a fuller photo set for room 304 — the Arno through the
window, the room with its bed and window, and the grey padded headboard. The
closest candidates we hold are `property/camera-finestra.jpg`,
`property/camera-dettaglio.jpg` and `views/finestra-arno.jpg`, all unreferenced
and all named after what they show rather than where they were taken.

None of them is published for room 304 yet, and the reason is worth keeping: every
LunArt room is furnished the same way, so `property/camera-dettaglio.jpg` is not
visually distinguishable from `rooms/302-camera.jpg`. Attributing it by eye is the
exact move that put room 302's desk in room 304 in the first place. What is needed
is the owner confirming the **file**, not the description — then rename it to
`rooms/304-…`, run the optimiser, and reference it. The name is what carries the
attribution, which is why nothing enters a room gallery under a generic one.
