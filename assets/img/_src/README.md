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
