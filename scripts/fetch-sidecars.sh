#!/usr/bin/env bash
# Downloads the deep-filter binary for this machine into src-tauri/binaries.
# Tauri looks for sidecars named <name>-<target-triple>.
set -euo pipefail

VERSION="0.5.6"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src-tauri/binaries"
mkdir -p "$OUT"

[[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
case "$TRIPLE" in
  aarch64-apple-darwin|x86_64-apple-darwin|x86_64-unknown-linux-musl|aarch64-unknown-linux-gnu)
    ASSET="deep-filter-${VERSION}-${TRIPLE}" ;;
  x86_64-unknown-linux-gnu)
    ASSET="deep-filter-${VERSION}-x86_64-unknown-linux-musl" ;;
  x86_64-pc-windows-msvc)
    ASSET="deep-filter-${VERSION}-${TRIPLE}.exe" ;;
  *)
    echo "No prebuilt deep-filter for $TRIPLE" >&2; exit 1 ;;
esac

DEST="$OUT/deep-filter-${TRIPLE}"
[[ "$TRIPLE" == *windows* ]] && DEST="$DEST.exe"

if [[ -x "$DEST" ]]; then
  echo "Already have $DEST"
  exit 0
fi

URL="https://github.com/Rikorose/DeepFilterNet/releases/download/v${VERSION}/${ASSET}"
echo "Downloading $URL"
curl -fL --progress-bar -o "$DEST" "$URL"
chmod +x "$DEST"
xattr -d com.apple.quarantine "$DEST" 2>/dev/null || true
echo "Saved $DEST"
