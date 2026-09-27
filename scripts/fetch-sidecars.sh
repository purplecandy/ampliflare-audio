#!/usr/bin/env bash
# Downloads the deep-filter binary into src-tauri/binaries.
# Tauri looks for sidecars named <name>-<target-triple>.
#
#   ./scripts/fetch-sidecars.sh                         # for this machine
#   ./scripts/fetch-sidecars.sh x86_64-apple-darwin     # for another target
#
# Every download is checked against the sha256 pinned below.
set -euo pipefail

VERSION="0.5.6"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src-tauri/binaries"
mkdir -p "$OUT"

[[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"
TRIPLE="${1:-$(rustc -vV | sed -n 's/^host: //p')}"
case "$TRIPLE" in
  aarch64-apple-darwin)
    ASSET="deep-filter-${VERSION}-${TRIPLE}"
    SHA256="4601e7f4e4c03e59a4c5b5000216ef3add3e808799cfccd95e14e83ea4611081" ;;
  x86_64-apple-darwin)
    ASSET="deep-filter-${VERSION}-${TRIPLE}"
    SHA256="d3be84003acb7c23e738ad7f70a158ec779a8d233a82e7fa3e717d112eb5b50f" ;;
  aarch64-unknown-linux-gnu)
    ASSET="deep-filter-${VERSION}-${TRIPLE}"
    SHA256="14e02a1c0028f3ca0bdf83b62b3336e56ba0556894ef295a95e8573f06557166" ;;
  x86_64-unknown-linux-gnu|x86_64-unknown-linux-musl)
    ASSET="deep-filter-${VERSION}-x86_64-unknown-linux-musl"
    SHA256="70775e251eee44c0f2451a1e833326cf8bcbbe304d3e7cd12851e6fce72ef7da" ;;
  x86_64-pc-windows-msvc)
    ASSET="deep-filter-${VERSION}-${TRIPLE}.exe"
    SHA256="75e11fa16445f560cb6b021521ddb89e89270d13b83089705d98776f58fd7915" ;;
  *)
    echo "No prebuilt deep-filter for $TRIPLE" >&2; exit 1 ;;
esac

DEST="$OUT/deep-filter-${TRIPLE}"
[[ "$TRIPLE" == *windows* ]] && DEST="$DEST.exe"

sha256_of() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

if [[ -f "$DEST" && "$(sha256_of "$DEST")" == "$SHA256" ]]; then
  echo "Already have $DEST"
  exit 0
fi

URL="https://github.com/Rikorose/DeepFilterNet/releases/download/v${VERSION}/${ASSET}"
echo "Downloading $URL"
curl -fL --retry 3 --progress-bar -o "$DEST.part" "$URL"
GOT="$(sha256_of "$DEST.part")"
if [[ "$GOT" != "$SHA256" ]]; then
  rm -f "$DEST.part"
  echo "sha256 mismatch for $ASSET: got $GOT, want $SHA256" >&2
  exit 1
fi
mv "$DEST.part" "$DEST"
chmod +x "$DEST"
xattr -d com.apple.quarantine "$DEST" 2>/dev/null || true
echo "Saved $DEST"
