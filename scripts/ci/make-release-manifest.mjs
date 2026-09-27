#!/usr/bin/env node
// Writes latest.json for the Tauri updater and SHA256SUMS for every file in a folder.
// Run it after all platform builds are gathered into one folder.
//
//   node scripts/ci/make-release-manifest.mjs <dir> <owner/repo> [notes-file]
//
// latest.json points at https://github.com/<repo>/releases/download/v<version>/<file>.
// Keys follow the updater's lookup order: "{os}-{arch}-{installer}" first, then "{os}-{arch}".
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [dir, repo, notesFile] = process.argv.slice(2);
if (!dir || !repo) {
  console.error("usage: make-release-manifest.mjs <dir> <owner/repo> [notes-file]");
  process.exit(2);
}

const root = fileURLToPath(new URL("../..", import.meta.url));
const conf = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
const version = conf.version;
const stem = `${conf.productName.replaceAll(" ", "-")}_${version}`;
const base = `https://github.com/${repo}/releases/download/v${version}`;

// [file suffix, updater os, installer name, is the default for "{os}-{arch}"]
const kinds = [
  [".app.tar.gz", "darwin", "app", true],
  ["-setup.exe", "windows", "nsis", true],
  [".msi", "windows", "msi", false],
  [".AppImage", "linux", "appimage", true],
  [".deb", "linux", "deb", false],
  [".rpm", "linux", "rpm", false],
];
const osNames = { darwin: "macos", windows: "windows", linux: "linux" };

const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
const platforms = {};
for (const arch of ["x86_64", "aarch64"]) {
  for (const [suffix, os, installer, isDefault] of kinds) {
    const name = `${stem}_${osNames[os]}_${arch}${suffix}`;
    if (!files.includes(name)) continue;
    if (!files.includes(name + ".sig")) {
      console.warn(`No signature for ${name}, it will not self update`);
      continue;
    }
    const entry = {
      signature: readFileSync(join(dir, name + ".sig"), "utf8").trim(),
      url: `${base}/${encodeURIComponent(name)}`,
    };
    platforms[`${os}-${arch}-${installer}`] = entry;
    if (isDefault) platforms[`${os}-${arch}`] = entry;
  }
}

if (Object.keys(platforms).length === 0) {
  console.error(`No signed updater bundles found in ${dir}`);
  process.exit(1);
}

const manifest = {
  version,
  notes: notesFile && existsSync(notesFile) ? readFileSync(notesFile, "utf8").trim() : "",
  pub_date: new Date().toISOString(),
  platforms,
};
writeFileSync(join(dir, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`latest.json: ${Object.keys(platforms).sort().join(", ")}`);

const sums = readdirSync(dir)
  .filter((f) => f !== "SHA256SUMS" && statSync(join(dir, f)).isFile())
  .sort()
  .map((f) => `${createHash("sha256").update(readFileSync(join(dir, f))).digest("hex")}  ${f}`);
writeFileSync(join(dir, "SHA256SUMS"), sums.join("\n") + "\n");
console.log(`SHA256SUMS: ${sums.length} files`);
