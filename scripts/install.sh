#!/usr/bin/env bash
set -euo pipefail

say() {
  printf '==> %s\n' "$*"
}

die() {
  say "Error: $*" >&2
  exit 1
}

usage() {
  say 'Usage: bash install.sh [--version VERSION] [--system] [--uninstall] [--help]'
  say 'Install or remove Ampliflare Audio on Linux.'
  say 'By default, install for the current user without sudo.'
}

cleanup() {
  if [ -n "${TEMP_DIR:-}" ]; then
    rm -rf "$TEMP_DIR"
  fi
}

download() {
  local url=$1 file=$2
  say "Downloading $(basename "$file")"
  curl -fL --retry 3 --silent --show-error --output "$file.part" "$url"
  mv "$file.part" "$file"
}

verify_file() {
  local file=$1 name=$2 expected actual
  expected=$(awk -v name="$name" '$2 == name || $2 == "*" name { print $1 }' "$TEMP_DIR/SHA256SUMS")
  [ "${#expected}" -eq 64 ] || die "Missing or invalid SHA256SUMS entry for $name."
  case "$expected" in
    *[!0-9a-fA-F]*) die "Invalid SHA256SUMS entry for $name." ;;
  esac

  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$file" | awk '{ print $1 }')
  else
    actual=$(shasum -a 256 "$file" | awk '{ print $1 }')
  fi
  expected=$(printf '%s' "$expected" | tr 'A-F' 'a-f')
  actual=$(printf '%s' "$actual" | tr 'A-F' 'a-f')
  [ "$actual" = "$expected" ] || die "SHA256 mismatch for $name. Download was not installed."
  say "Verified $name"
}

refresh_caches() {
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$applications_dir" >/dev/null 2>&1 || true
  fi
  if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f -t "$icons_dir/hicolor" >/dev/null 2>&1 || true
  fi
}

has_fuse2() {
  if command -v ldconfig >/dev/null 2>&1; then
    ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2' && return 0
  fi
  find /lib /usr/lib -name 'libfuse.so.2*' -print -quit 2>/dev/null | grep -q .
}

warn_dependencies() {
  local missing_fuse=0
  if ! command -v ffmpeg >/dev/null 2>&1; then
    say 'Warning: ffmpeg is missing. Install it with apt, dnf, or pacman.'
  fi
  if ! has_fuse2; then
    say 'Warning: libfuse2 is missing. AppImage needs FUSE.'
    say 'Try sudo apt install libfuse2 (Ubuntu 24.04: libfuse2t64).'
    missing_fuse=1
  fi
  if [ ! -e /dev/fuse ]; then
    say 'Warning: /dev/fuse is missing. AppImage may not start.'
    missing_fuse=1
  fi
  if [ "$missing_fuse" -eq 1 ]; then
    say 'Use APPIMAGE_EXTRACT_AND_RUN=1 as a fallback.'
  fi
}

main() {
  local system=0 uninstall=0 version='' repo arch asset base marker
  local app_dir appimage link icon desktop bin_dir
  TEMP_DIR=''

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version)
        [ "$#" -ge 2 ] || die '--version needs a value.'
        version=$2
        shift 2 ;;
      --system) system=1; shift ;;
      --uninstall) uninstall=1; shift ;;
      --help|-h) usage; return 0 ;;
      *) die "Unknown option: $1" ;;
    esac
  done

  [ "$(uname -s)" = Linux ] || die 'This installer runs on Linux only.'
  if [ "$(id -u)" -eq 0 ]; then
    [ "$system" -eq 1 ] || die 'Do not run as root without --system.'
  elif [ "$system" -eq 1 ]; then
    die 'Run with sudo for --system.'
  fi

  if [ "$system" -eq 1 ]; then
    app_dir=/opt/ampliflare-audio
    bin_dir=/usr/local/bin
    icons_dir=/usr/share/icons
    applications_dir=/usr/share/applications
  else
    [ -n "${HOME:-}" ] || die 'HOME is not set.'
    case "$HOME" in /*) ;; *) die 'HOME must be an absolute path.' ;; esac
    local data_home=${XDG_DATA_HOME:-$HOME/.local/share}
    case "$data_home" in /*) ;; *) die 'XDG_DATA_HOME must be an absolute path.' ;; esac
    app_dir="$data_home/ampliflare-audio"
    bin_dir="$HOME/.local/bin"
    icons_dir="$data_home/icons"
    applications_dir="$data_home/applications"
  fi

  appimage="$app_dir/Ampliflare-Audio.AppImage"
  link="$bin_dir/ampliflare-audio"
  icon="$icons_dir/hicolor/512x512/apps/com.ampliflare.audio.png"
  desktop="$applications_dir/com.ampliflare.audio.desktop"
  marker='# Installed by Ampliflare Audio install.sh'

  if [ "$uninstall" -eq 1 ]; then
    if [ ! -f "$desktop" ] || ! grep -Fqx "$marker" "$desktop"; then
      say 'No Ampliflare Audio install from this script was found.'
      return 0
    fi
    if [ -L "$link" ] && [ "$(readlink "$link")" = "$appimage" ]; then
      rm "$link"
    fi
    rm -f "$desktop" "$icon" "$appimage"
    rmdir "$app_dir" 2>/dev/null || true
    refresh_caches
    say 'Ampliflare Audio was removed.'
    say "User data in $HOME/.config and $HOME/.local/share/com.ampliflare.audio was left in place."
    return 0
  fi

  repo=${AMPLIFLARE_REPO:-purplecandy/ampliflare-audio}
  if [[ ! "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
    die 'AMPLIFLARE_REPO must be an owner/repo name.'
  fi
  case "$(uname -m)" in
    x86_64|amd64) arch=x86_64 ;;
    aarch64|arm64) arch=aarch64 ;;
    *) die "Unsupported CPU: $(uname -m). Need x86_64 or aarch64." ;;
  esac
  command -v curl >/dev/null 2>&1 || die 'curl is required.'
  if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
    die 'sha256sum or shasum is required.'
  fi

  if [ -f "$desktop" ] && ! grep -Fqx "$marker" "$desktop"; then
    die "An unrelated desktop entry already exists at $desktop."
  fi
  if [ ! -f "$desktop" ]; then
    for file in "$appimage" "$icon"; do
      [ ! -e "$file" ] && [ ! -L "$file" ] || die "An unrelated file already exists at $file."
    done
  fi
  if [ -L "$link" ]; then
    [ "$(readlink "$link")" = "$appimage" ] || die "An unrelated link already exists at $link."
  elif [ -e "$link" ]; then
    die "An unrelated file already exists at $link."
  fi

  TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ampliflare-audio.XXXXXX")
  trap cleanup EXIT
  trap 'exit 1' HUP INT TERM

  if [ -z "$version" ]; then
    download "https://github.com/$repo/releases/latest/download/latest.json" "$TEMP_DIR/latest.json"
    version=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TEMP_DIR/latest.json" | head -n 1)
  fi
  case "$version" in
    [0-9]*) ;;
    *) die 'Could not find a valid release version.' ;;
  esac
  case "$version" in
    *[!A-Za-z0-9.+-]*) die 'Release version has invalid characters.' ;;
  esac

  asset="Ampliflare-Audio_${version}_linux_${arch}.AppImage"
  base="https://github.com/$repo/releases/download/v$version"
  download "$base/SHA256SUMS" "$TEMP_DIR/SHA256SUMS"
  download "$base/$asset" "$TEMP_DIR/$asset"
  download "$base/icon.png" "$TEMP_DIR/icon.png"
  verify_file "$TEMP_DIR/$asset" "$asset"
  verify_file "$TEMP_DIR/icon.png" icon.png
  if [ -f "$TEMP_DIR/latest.json" ]; then
    verify_file "$TEMP_DIR/latest.json" latest.json
  fi

  mkdir -p "$app_dir" "$bin_dir" "$(dirname "$icon")" "$applications_dir"
  install -m 755 "$TEMP_DIR/$asset" "$appimage.part"
  mv -f "$appimage.part" "$appimage"
  install -m 644 "$TEMP_DIR/icon.png" "$icon.part"
  mv -f "$icon.part" "$icon"
  if [ ! -L "$link" ]; then
    ln -s "$appimage" "$link"
  fi
  {
    printf '%s\n' "$marker"
    printf '%s\n' '[Desktop Entry]' 'Name=Ampliflare Audio' \
      'Comment=Edit and clean up audio files' \
      "Exec=\"$appimage\" %F" \
      'Icon=com.ampliflare.audio' 'Terminal=false' 'Type=Application' \
      'Categories=AudioVideo;Audio;' \
      'MimeType=audio/mpeg;audio/mp4;audio/x-wav;audio/wav;audio/flac;audio/x-flac;audio/ogg;audio/x-vorbis+ogg;audio/webm;audio/aac;audio/x-aiff;audio/x-m4a;' \
      'StartupWMClass=ampliflare-audio'
  } > "$desktop.part"
  chmod 644 "$desktop.part"
  mv -f "$desktop.part" "$desktop"
  refresh_caches

  say "Installed Ampliflare Audio $version at $appimage"
  warn_dependencies
  if [ "$system" -eq 1 ]; then
    say 'In-app updates for this system install need root.'
  else
    case ":$PATH:" in
      *":$bin_dir:"*) ;;
      *) say "Warning: $bin_dir is not on PATH." ;;
    esac
  fi
}

main "$@"
