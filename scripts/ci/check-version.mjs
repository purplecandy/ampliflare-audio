#!/usr/bin/env node
// Checks that package.json, Cargo.toml and tauri.conf.json hold the same version.
// With a tag argument, also checks the tag is exactly "v" plus that version.
// Prints the version on success.
//
//   node scripts/ci/check-version.mjs
//   node scripts/ci/check-version.mjs v0.2.0
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");

const found = {
  "package.json": JSON.parse(read("package.json")).version,
  "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
  "src-tauri/Cargo.toml": read("src-tauri/Cargo.toml").match(/^\[package\][^[]*?^version\s*=\s*"([^"]+)"/m)?.[1],
};

const versions = new Set(Object.values(found));
if (versions.size !== 1 || versions.has(undefined)) {
  console.error("Versions do not match:");
  for (const [file, v] of Object.entries(found)) console.error(`  ${file}: ${v}`);
  process.exit(1);
}

const [version] = versions;
const tag = process.argv[2];
if (tag !== undefined && tag !== `v${version}`) {
  console.error(`Tag ${tag} does not match version ${version}. Expected v${version}.`);
  process.exit(1);
}

console.log(version);
