#!/usr/bin/env bash
# Notarizes and staples the disk image, then checks it the way a download is checked.
# `tauri build` already signed, notarized and stapled the .app, and signed the .dmg.
# The image still needs its own ticket, or a quarantined download will not mount.
#
#   macos-notarize-dmg.sh <file.dmg>
#
# Needs APPLE_API_KEY (key id), APPLE_API_ISSUER and APPLE_API_KEY_PATH (.p8 file).
set -euo pipefail

DMG="${1:?usage: $0 <file.dmg>}"
: "${APPLE_API_KEY:?}" "${APPLE_API_ISSUER:?}" "${APPLE_API_KEY_PATH:?}"

echo "==> Notarizing $DMG"
if ! xcrun notarytool submit "$DMG" --wait --timeout 30m \
  --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" \
  --output-format json | tee "${RUNNER_TEMP:-/tmp}/notary.json"; then
  echo "notarytool failed or timed out. The submission may still finish." >&2
  echo "Check with: xcrun notarytool history --key ... --key-id ... --issuer ..." >&2
  exit 1
fi
if ! grep -q '"status":"Accepted"' "${RUNNER_TEMP:-/tmp}/notary.json"; then
  id="$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' "${RUNNER_TEMP:-/tmp}/notary.json")"
  xcrun notarytool log "$id" \
    --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" || true
  exit 1
fi

xcrun stapler staple -v "$DMG"
xcrun stapler validate -v "$DMG"

echo "==> Checking the image as a quarantined download"
CHECK="$(mktemp -d)"
cp "$DMG" "$CHECK/test.dmg"
xattr -w com.apple.quarantine "0083;$(printf %x "$(date +%s)");Safari;$(uuidgen)" "$CHECK/test.dmg"
spctl --assess --type open --context context:primary-signature -vv "$CHECK/test.dmg" 2>&1 | tee "$CHECK/dmg.txt"
grep -q "source=Notarized Developer ID" "$CHECK/dmg.txt"

MOUNT="$CHECK/mnt"
mkdir "$MOUNT"
hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$CHECK/test.dmg" > /dev/null
trap 'hdiutil detach "$MOUNT" -quiet || true; rm -rf "$CHECK"' EXIT
APP="$(find "$MOUNT" -maxdepth 1 -name '*.app' -print -quit)"
ditto "$APP" "$CHECK/$(basename "$APP")"
APP="$CHECK/$(basename "$APP")"
xattr -w com.apple.quarantine "0083;$(printf %x "$(date +%s)");Safari;$(uuidgen)" "$APP"

spctl --assess --type execute -vv "$APP" 2>&1 | tee "$CHECK/app.txt"
grep -q "source=Notarized Developer ID" "$CHECK/app.txt"
xcrun stapler validate "$APP"
codesign --verify --deep --strict -vv "$APP"
codesign -dvv "$APP" 2>&1 | grep -E "Authority=Developer ID Application|Timestamp=|flags=.*runtime"
if codesign -d --entitlements :- "$APP" 2>/dev/null | grep -q "get-task-allow"; then
  echo "App ships get-task-allow. Notarized builds must not." >&2
  exit 1
fi
for bin in "$APP/Contents/MacOS/"*; do
  echo "$(basename "$bin"): $(lipo -archs "$bin")"
done
echo "==> $DMG is notarized, stapled and opens as a download"
