# Source photographs

These are the original files, recovered from the base64 blobs that were inlined in
the pre-v2 `index.html`. They are the only copy we hold, so they stay in the repo
even though nothing serves them directly.

Everything under `assets/img/<folder>/` is generated from here by:

    node tools/optimize-images.mjs

The script never upscales and never overwrites: delete a derived file to rebuild it.
Add a new photo here, run the script, then reference it from `data/`.

## Two files whose names are wrong

`rooms/304-camera.jpg` is **not** room 304. The owner confirmed in October 2026
that it is room 302 — it is the same shot as `rooms/302-scrivania.jpg`, cropped
tighter, and 302 already carries the full version. `rooms/304-bagno.jpg` is a
generic LunArt bathroom, the same one as `property/bagno-doccia.jpg` from a wider
angle; nothing establishes which room it is in.

Both were attributed to room 304 and both have been removed from `data/rooms.js`.
They are kept here because this is the only copy we hold, but **do not reference
either from a room gallery**: the filename is the mistake, not a fact. Room 304
has no photograph until somebody takes one of room 304.
