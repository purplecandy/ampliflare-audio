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

- Frontend: React + TypeScript + Vite in `src/`
- Backend: Rust in `src-tauri/`, commands only spawn sidecars and report progress
- Package manager: pnpm
