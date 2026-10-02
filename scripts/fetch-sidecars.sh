#!/usr/bin/env bash
# Downloads the sidecar binaries, deep-filter and ffmpeg, into src-tauri/binaries.
# Tauri looks for sidecars named <name>-<target-triple>. ffmpeg is saved as
# ampliflare-ffmpeg so the Linux packages do not clash with the system's
# /usr/bin/ffmpeg.
#
#   ./scripts/fetch-sidecars.sh                         # for this machine
#   ./scripts/fetch-sidecars.sh x86_64-apple-darwin     # for another target
#
# Every download is checked against the sha256 pinned below.
set -euo pipefail

DEEP_FILTER_VERSION="0.5.6"
# Prebuilt GPLv3 builds, copied to our bucket with their source. See README.txt there.
FFMPEG_VERSION="9.0.2"
FFMPEG_URL="https://static.purplecandy.dev/ampliflare-audio/ffmpeg/$FFMPEG_VERSION"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src-tauri/binaries"
mkdir -p "$OUT"

[[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"
TRIPLE="${1:-$(rustc -vV | sed -n 's/^host: //p')}"
case "$TRIPLE" in
  aarch64-apple-darwin)
    DF_ASSET="deep-filter-${DEEP_FILTER_VERSION}-${TRIPLE}"
    DF_SHA256="4601e7f4e4c03e59a4c5b5000216ef3add3e808799cfccd95e14e83ea4611081"
    FF_ASSET="ffmpeg-${TRIPLE}"
    FF_SHA256="2e11c6f90993cdb79fff84d3f90044d28316b310e75b3e030cfc9a54f2c9d384" ;;
  x86_64-apple-darwin)
    DF_ASSET="deep-filter-${DEEP_FILTER_VERSION}-${TRIPLE}"
    DF_SHA256="d3be84003acb7c23e738ad7f70a158ec779a8d233a82e7fa3e717d112eb5b50f"
    FF_ASSET="ffmpeg-${TRIPLE}"
    FF_SHA256="b25689cf2211c0582d317e849912769a1f1c93904fe102c485b5364a425633d1" ;;
  aarch64-unknown-linux-gnu)
    DF_ASSET="deep-filter-${DEEP_FILTER_VERSION}-${TRIPLE}"
    DF_SHA256="14e02a1c0028f3ca0bdf83b62b3336e56ba0556894ef295a95e8573f06557166"
    FF_ASSET="ffmpeg-${TRIPLE}"
    FF_SHA256="5cd127277d1750177dfe30e7e21aa9ee7cb653d66012866d52e729cf3f60bd6f" ;;
  x86_64-unknown-linux-gnu|x86_64-unknown-linux-musl)
    DF_ASSET="deep-filter-${DEEP_FILTER_VERSION}-x86_64-unknown-linux-musl"
    DF_SHA256="70775e251eee44c0f2451a1e833326cf8bcbbe304d3e7cd12851e6fce72ef7da"
    FF_ASSET="ffmpeg-x86_64-unknown-linux-gnu"
    FF_SHA256="1446a9fbfa0a48d59af5a62f0c590294caef40d2f21153c2b199c903a550e88f" ;;
  x86_64-pc-windows-msvc)
    DF_ASSET="deep-filter-${DEEP_FILTER_VERSION}-${TRIPLE}.exe"
    DF_SHA256="75e11fa16445f560cb6b021521ddb89e89270d13b83089705d98776f58fd7915"
    FF_ASSET="ffmpeg-${TRIPLE}.exe"
    FF_SHA256="f78373b58fa0a239ca062cbd9e03130285ec4e835e57abc22a5d4025e293d2b4" ;;
  *)
    echo "No prebuilt sidecars for $TRIPLE" >&2; exit 1 ;;
esac

sha256_of() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# fetch <name> <url> <sha256>
fetch() {
  local name=$1 url=$2 sha=$3
  local dest="$OUT/${name}-${TRIPLE}"
  [[ "$TRIPLE" == *windows* ]] && dest="$dest.exe"

  if [[ -f "$dest" && "$(sha256_of "$dest")" == "$sha" ]]; then
    echo "Already have $dest"
    return
  fi

  echo "Downloading $url"
  curl -fL --retry 3 --progress-bar -o "$dest.part" "$url"
  local got
  got="$(sha256_of "$dest.part")"
  if [[ "$got" != "$sha" ]]; then
    rm -f "$dest.part"
    echo "sha256 mismatch for $url: got $got, want $sha" >&2
    exit 1
  fi
  mv "$dest.part" "$dest"
  chmod +x "$dest"
  xattr -d com.apple.quarantine "$dest" 2>/dev/null || true
  echo "Saved $dest"
}

fetch deep-filter "https://github.com/Rikorose/DeepFilterNet/releases/download/v${DEEP_FILTER_VERSION}/${DF_ASSET}" "$DF_SHA256"
fetch ampliflare-ffmpeg "$FFMPEG_URL/$FF_ASSET" "$FF_SHA256"
