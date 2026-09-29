# Ampliflare Audio

Desktop audio toolkit built with Tauri v2. Rust stays a thin glue layer.
Heavy work runs in sidecar binaries: `deep-filter` for noise reduction and
`ffmpeg` for decode, encode, convert and cut.

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
  These only work in debug builds.
