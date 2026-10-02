# Ampliflare Audio

Desktop audio toolkit built with Tauri v2. Rust stays a thin glue layer.
Heavy work runs in sidecar binaries: `deep-filter` for noise reduction and
`ffmpeg` for decode, encode, convert and cut. Both are bundled as sidecars
(ffmpeg as `ampliflare-ffmpeg`) and fetched by `scripts/fetch-sidecars.sh`.

## Commit messages

- Write like a 6th grader would. Plain words, short sentences.
- One line subject, under 60 characters. Body only if needed.
- No jargon, no filler phrases, no long punctuation like dashes or semicolons.
- Say what changed, not how clever it was.
- Good: `Add drop zone for audio files`
- Bad: `Implement comprehensive drag-and-drop ingestion pipeline — refactor UI`

## Stack

- Frontend: React + TypeScript + Vite in `src/`, styled with Pico CSS. Prefer plain
  HTML tags and Pico classes over custom CSS. Keep `App.css` small.
- Backend: Rust in `src-tauri/`. Commands spawn sidecars and report progress.
  The one exception is `analyze.rs`, which computes the spectrogram in Rust.
- Package manager: pnpm

## Testing

- `cd src-tauri && cargo test` for Rust. Tests need ffmpeg installed.
- To see the UI with files loaded, run `pnpm tauri dev` with
  `AMPLIFLARE_DEV_FILES=/a.wav:/b.mp3` and `AMPLIFLARE_DEV_ACTION=cut`.
  `AMPLIFLARE_DEV_LOOK=mac/dark/blue` sets the style, colours and accent.
  `AMPLIFLARE_DEV_MARKS=9.5,46` sets the cut, or the split points, on the
  first file.
  These only work in debug builds.
- Only CI builds set `AMPLIFLARE_OFFICIAL_BUILD`, which turns on the weekly
  limit and the license key. Any other build is a source build, free for any
  use. Set it by hand, like `AMPLIFLARE_OFFICIAL_BUILD=1 pnpm tauri dev`, to
  try the limit.
