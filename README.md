# Ampliflare Audio

A small desktop audio toolkit. Drop in files, pick an action, get clean files back.
Everything runs on your machine. Nothing is uploaded.

What it does today:

- **Remove noise** with DeepFilterNet3, a speech noise reduction model that runs on device
- **Enhance** by evening out loudness and cutting low rumble
- **Cut** a file down to a start and end time, picked on a spectrogram
- **Split** a file into pieces at points you mark on the spectrogram
- **Convert** between wav, mp3, m4a, flac, ogg and opus

## How it is built

- [Tauri v2](https://v2.tauri.app) shell. The window is a system webview showing a React app.
- [Pico CSS](https://picocss.com) for styling. Plain HTML tags look right, so there is very little custom CSS.
- The spectrogram is computed in Rust with `rustfft` and drawn on a canvas. See `src-tauri/src/analyze.rs` and `src/components/Spectrogram.tsx`.
- The Rust side is thin. It builds command lines, runs two outside programs and reports progress.
- `deep-filter` does the noise reduction. It ships inside the app as a sidecar binary.
- `ffmpeg` does decode, encode, cut and loudness. For now it must be installed on the machine.

```
src/            React + TypeScript UI
src-tauri/src/  Rust. lib.rs wires plugins, jobs.rs runs the work, analyze.rs makes the spectrogram
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

## Test it faster

Debug builds can start with files already loaded and a tab already open:

```sh
AMPLIFLARE_DEV_FILES="/path/a.wav:/path/b.mp3" AMPLIFLARE_DEV_ACTION=cut pnpm tauri dev
```

Rust tests need ffmpeg installed:

```sh
cd src-tauri && cargo test
```

## Build a release

```sh
pnpm tauri build
```

The result lands in `src-tauri/target/release/bundle/`.

CI builds, signs and notarizes every pull request. Pushing a `v*` tag publishes a
release with an in-app updater feed. See [docs/releasing.md](docs/releasing.md).

## Install on Linux

```sh
curl -fsSL https://static.purplecandy.dev/ampliflare-audio/releases/latest/download/install.sh | bash
```

## Not done yet

- Bundle a static ffmpeg so users do not need to install it. Use an LGPL build.
- Dereverb. Needs a second model and a real inference runtime.
- Windows testing. CI builds it, but nobody has run it yet. It is not Authenticode signed.
