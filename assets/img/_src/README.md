# Source photographs

These are the original files, recovered from the base64 blobs that were inlined in
the pre-v2 `index.html`. They are the only copy we hold, so they stay in the repo
even though nothing serves them directly.

Everything under `assets/img/<folder>/` is generated from here by:

    node tools/optimize-images.mjs

The script never upscales and never overwrites: delete a derived file to rebuild it.
Add a new photo here, run the script, then reference it from `data/`.
