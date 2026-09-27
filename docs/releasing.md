# Releasing

Two workflows do the work.

- `.github/workflows/build.yml` runs on every pull request and every push to `main`.
  It builds for macOS (arm64 and x64), Windows x64 and Linux (x64 and arm64), and
  uploads the packages as workflow artifacts.
- `.github/workflows/release.yml` runs when a `v*` tag is pushed. It runs the same
  build with signing required, then publishes a GitHub release.

## What each platform gets

| Platform | Files | Signed with |
|---|---|---|
| macOS | `.dmg`, `.app.tar.gz` (updater) | Developer ID, hardened runtime. App and DMG are both notarized and stapled |
| Windows | `-setup.exe` (NSIS), `.msi` | Updater key only. No Authenticode, so SmartScreen warns on first run |
| Linux | `.AppImage`, `.deb`, `.rpm`, `install.sh` | Updater key |

Every release also has `latest.json` for the in-app updater, `SHA256SUMS`, `install.sh` and `icon.png`.

File names look like `Ampliflare-Audio_0.2.0_macos_aarch64.dmg`.

## Secrets

Set these once in the repo settings. Set them from files so no value passes
through a chat window or shell history.

```sh
R=purplecandy/ampliflare-audio
base64 -i DeveloperID.p12 | gh secret set MACOS_CERT_P12 -R $R
gh secret set MACOS_CERT_PASSWORD -R $R            # prompts
gh secret set MACOS_SIGN_IDENTITY -R $R            # "Developer ID Application: Name (TEAMID)"
base64 -i AuthKey_XXXXXXXXXX.p8 | gh secret set MACOS_NOTARY_KEY -R $R
gh secret set MACOS_NOTARY_KEY_ID -R $R            # the 10 character key id
gh secret set MACOS_NOTARY_ISSUER -R $R            # the issuer id above the keys table
gh secret set TAURI_SIGNING_PRIVATE_KEY -R $R < ~/.tauri/ampliflare-audio/updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R $R < ~/.tauri/ampliflare-audio/updater.key.password
```

The updater key pair lives in `~/.tauri/ampliflare-audio/`. The public half is in
`src-tauri/tauri.conf.json` under `plugins.updater.pubkey`. Back up the private key.
If it is lost, apps already installed can never update again.

Without secrets the build still runs. macOS is signed ad hoc, there are no updater
files, and the artifact name ends in `-unsigned`. Pull requests from forks never
get secrets, so they always get that build. To open an unsigned Mac build, run
`xattr -dr com.apple.quarantine "/Applications/Ampliflare Audio.app"` first.

## Cut a release

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json`. `node scripts/ci/check-version.mjs` checks they match.
2. Commit, then tag and push:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. The release workflow checks the tag matches the version, builds everything,
   makes a draft release with notes from the merged pull requests, uploads the
   files, and then publishes it. `latest.json` only goes live once every file is
   uploaded, so users never get pointed at a missing file.

A failed run can be re-run. It picks up the draft from the last try.

A version with a dash, like `0.2.0-beta.1`, makes a pre-release. It is not marked
latest, so the in-app updater and `install.sh` skip it unless asked for it by
version. Windows gets only the NSIS installer, because MSI needs a numbers only version.

## Check a Mac release on a second Mac

CI already checks the image with a fake quarantine tag. The honest test is still a
real download on a Mac that did not build it.

```sh
xattr -l Ampliflare-Audio_*.dmg          # must show com.apple.quarantine
spctl --assess --type open --context context:primary-signature -vv Ampliflare-Audio_*.dmg
spctl --assess --type execute -vv "/Applications/Ampliflare Audio.app"
xcrun stapler validate "/Applications/Ampliflare Audio.app"
```

Both `spctl` lines should say `source=Notarized Developer ID`.

## Linux install

```sh
curl -fsSL https://github.com/purplecandy/ampliflare-audio/releases/latest/download/install.sh | bash
```

It installs the AppImage into `~/.local/share/ampliflare-audio`, adds a menu entry,
and checks the download against `SHA256SUMS`. The in-app updater can replace that
AppImage in place. Use `--version 0.2.0` to pick a version and `--uninstall` to remove it.

## Test the Linux job locally

Linux jobs run on a Mac with `act` and Docker:

```sh
act pull_request -W .github/workflows/build.yml -j package \
  --matrix target:aarch64-unknown-linux-gnu \
  -P ubuntu-22.04-arm=catthehacker/ubuntu:act-24.04 \
  --container-architecture linux/arm64 --artifact-server-path /tmp/act-artifacts
```

## Icons

All icons come from `src-tauri/icons/source/icon.svg`, drawn on Apple's template
(an 824 point rounded square on a 1024 canvas, corner radius 185, soft shadow).
After changing it, run:

```sh
pnpm tauri icon "$PWD/src-tauri/icons/source/icon.svg" -o "$PWD/src-tauri/icons"
rm -rf src-tauri/icons/android src-tauri/icons/ios
```
