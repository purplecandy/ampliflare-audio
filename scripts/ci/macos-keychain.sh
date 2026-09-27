#!/usr/bin/env bash
# Puts the Developer ID identity in a keychain that lives only for this CI job.
#
#   macos-keychain.sh setup     needs MACOS_CERT_P12 (base64), MACOS_CERT_PASSWORD,
#                               MACOS_SIGN_IDENTITY, MACOS_NOTARY_KEY (base64 .p8)
#   macos-keychain.sh cleanup   deletes the keychain and the decoded files
#
# setup writes APPLE_API_KEY_PATH to $GITHUB_ENV so `tauri build` can notarize.
set -euo pipefail

TMP="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
SECRETS="$TMP/signing"
KEYCHAIN="$TMP/ampliflare-signing.keychain-db"

setup() {
  : "${MACOS_CERT_P12:?}" "${MACOS_CERT_PASSWORD:?}" "${MACOS_SIGN_IDENTITY:?}" "${MACOS_NOTARY_KEY:?}"

  mkdir -p "$SECRETS"
  chmod 700 "$SECRETS"
  printf '%s' "$MACOS_CERT_P12" | base64 --decode > "$SECRETS/cert.p12"
  printf '%s' "$MACOS_NOTARY_KEY" | base64 --decode > "$SECRETS/notary.p8"
  chmod 600 "$SECRETS/cert.p12" "$SECRETS/notary.p8"

  local pass
  pass="$(uuidgen)"
  security create-keychain -p "$pass" "$KEYCHAIN"
  # Put ours first in the search list so codesign finds the identity.
  # shellcheck disable=SC2046
  security list-keychains -d user -s "$KEYCHAIN" $(security list-keychains -d user | tr -d '"')
  # No timeout, so it does not lock halfway through a long signing run.
  security set-keychain-settings "$KEYCHAIN"
  security unlock-keychain -p "$pass" "$KEYCHAIN"
  security import "$SECRETS/cert.p12" -k "$KEYCHAIN" -P "$MACOS_CERT_PASSWORD" -T /usr/bin/codesign
  # Lets codesign use the key without a prompt nobody in CI can answer.
  security set-key-partition-list -S apple-tool:,apple: -s -k "$pass" \
    -D "$MACOS_SIGN_IDENTITY" -t private "$KEYCHAIN" > /dev/null

  local found
  found="$(security find-identity -v -p codesigning "$KEYCHAIN")"
  echo "$found"
  if ! grep -qF "\"$MACOS_SIGN_IDENTITY\"" <<< "$found"; then
    echo "Identity \"$MACOS_SIGN_IDENTITY\" was not found in the keychain" >&2
    exit 1
  fi

  if [[ -n "${GITHUB_ENV:-}" ]]; then
    echo "APPLE_API_KEY_PATH=$SECRETS/notary.p8" >> "$GITHUB_ENV"
  fi
}

cleanup() {
  security delete-keychain "$KEYCHAIN" 2>/dev/null || true
  rm -rf "$SECRETS"
}

case "${1:-}" in
  setup) setup ;;
  cleanup) cleanup ;;
  *) echo "usage: $0 setup|cleanup" >&2; exit 2 ;;
esac
