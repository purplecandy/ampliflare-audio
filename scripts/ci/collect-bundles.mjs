#!/usr/bin/env node
// Copies what `tauri build` made into one folder with clean names, so the
// release has no spaces in file names and two macOS builds never collide.
//
//   node scripts/ci/collect-bundles.mjs <target-triple> <out-dir>
//
// Names look like Ampliflare-Audio_<version>_<os>_<arch>.<ext>
// Each updater bundle keeps its .sig file next to it.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [triple, outDir] = process.argv.slice(2);
if (!triple || !outDir) {
  console.error("usage: collect-bundles.mjs <target-triple> <out-dir>");
  process.exit(2);
}

const root = fileURLToPath(new URL("../..", import.meta.url));
const conf = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
const version = conf.version;
const product = conf.productName;
const arch = triple.split("-")[0];
const os = triple.includes("apple") ? "macos" : triple.includes("windows") ? "windows" : "linux";
const stem = `${product.replaceAll(" ", "-")}_${version}_${os}_${arch}`;

const bundleDir = join(root, "src-tauri/target", triple, "release/bundle");
if (!existsSync(bundleDir)) {
  console.error(`No bundle folder at ${bundleDir}`);
  process.exit(1);
}

// [folder inside bundle/, file name suffix, new suffix, needed]
// The .app.tar.gz only exists when the updater key was there.
// MSI is skipped for pre-release versions, since it only takes numeric versions.
const isPrerelease = version.includes("-");
const rules = {
  macos: [
    ["dmg", ".dmg", ".dmg"],
    ["macos", ".app.tar.gz", ".app.tar.gz", false],
  ],
  windows: [
    ["nsis", "-setup.exe", "-setup.exe"],
    ["msi", ".msi", ".msi", !isPrerelease],
  ],
  linux: [
    ["appimage", ".AppImage", ".AppImage"],
    ["deb", ".deb", ".deb"],
    ["rpm", ".rpm", ".rpm"],
  ],
}[os];

mkdirSync(outDir, { recursive: true });
let copied = 0;
for (const [folder, suffix, newSuffix, needed = true] of rules) {
  const dir = join(bundleDir, folder);
  if (!existsSync(dir) && !needed) continue;
  if (!existsSync(dir)) {
    console.error(`Missing bundle folder ${folder}`);
    process.exit(1);
  }
  const matches = readdirSync(dir).filter((f) => f.endsWith(suffix) && statSync(join(dir, f)).isFile());
  if (matches.length === 0 && !needed) continue;
  if (matches.length !== 1) {
    console.error(`Expected one *${suffix} in ${folder}, found: ${matches.join(", ") || "none"}`);
    process.exit(1);
  }
  const from = join(dir, matches[0]);
  const to = join(outDir, stem + newSuffix);
  copyFileSync(from, to);
  console.log(`${matches[0]} -> ${to}`);
  copied++;
  if (existsSync(from + ".sig")) {
    copyFileSync(from + ".sig", to + ".sig");
    console.log(`${matches[0]}.sig -> ${to}.sig`);
  }
}

console.log(`Collected ${copied} bundles for ${os} ${arch}`);
