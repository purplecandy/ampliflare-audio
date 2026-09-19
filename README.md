# Ampliflare Audio

A small desktop audio toolkit. Drop in files, pick an action, get clean files back.
Everything runs on your machine. Nothing is uploaded.

What it does today:

- **Remove noise** with DeepFilterNet3, a speech noise reduction model that runs on device
- **Enhance** by evening out loudness and cutting low rumble
- **Cut** a file down to a start and end time
- **Convert** between wav, mp3, m4a, flac, ogg and opus

## How it is built

- [Tauri v2](https://v2.tauri.app) shell. The window is a system webview showing a React app.
- The Rust side is thin. It builds command lines, runs two outside programs and reports progress.
- `deep-filter` does the noise reduction. It ships inside the app as a sidecar binary.
- `ffmpeg` does decode, encode, cut and loudness. For now it must be installed on the machine.

```
src/            React + TypeScript UI
src-tauri/src/  Rust. lib.rs wires plugins, jobs.rs runs the work
src-tauri/binaries/  sidecar binaries, not committed, fetched by a script
scripts/        helper scripts
```

## Run it

You need Node 22, pnpm, Rust and ffmpeg.

```sh
brew install ffmpeg
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
pnpm install
./scripts/fetch-sidecars.sh
pnpm tauri dev
```

## Build a release

```sh
pnpm tauri build
```

The result lands in `src-tauri/target/release/bundle/`.

## Not done yet

- Bundle a static ffmpeg so users do not need to install it. Use an LGPL build.
- Code signing and notarization for macOS.
- Dereverb. Needs a second model and a real inference runtime.
- Waveform view and a visual cut tool.
- Windows build and testing.
