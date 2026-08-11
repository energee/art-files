// check-release.mjs — enforce desktop version and release-note metadata.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { releaseNotes } from "./release-notes.mjs";

const VERSION_FILES = [
  "package.json",
  "package-lock.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json",
];

const BINARY_FILES = new Set([
  "index.html",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "presets.json",
  "scripts/configure-updater.mjs",
  "tsconfig.json",
  "vite.config.ts",
]);

const BINARY_PREFIXES = ["public/", "src/", "src-tauri/"];
const NON_BINARY_FILES = new Set(["src-tauri/.gitignore"]);

function abort(message) {
  console.error(`Release metadata check failed: ${message}`);
  process.exit(1);
}

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    abort(detail);
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    abort(`could not read ${path}: ${error.message}`);
  }
}

function manifestVersion(text, path) {
  const packageHeading = /^\[package\]\s*$/m.exec(text);
  if (!packageHeading) abort(`could not find [package] in ${path}`);
  const afterHeading = text.slice(packageHeading.index + packageHeading[0].length);
  const nextSection = afterHeading.search(/^\[/m);
  const packageSection = nextSection === -1 ? afterHeading : afterHeading.slice(0, nextSection);
  const version = packageSection?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!version) abort(`could not find the package version in ${path}`);
  return version;
}

function lockVersion(text) {
  const block = text
    .split(/(?=^\[\[package\]\]$)/m)
    .find((candidate) => /^name\s*=\s*"label-lab"\s*$/m.test(candidate));
  const version = block?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!version) abort("could not find the label-lab package version in src-tauri/Cargo.lock");
  return version;
}

function currentVersions() {
  const packageJson = readJson("package.json");
  const packageLock = readJson("package-lock.json");
  const tauriConfig = readJson("src-tauri/tauri.conf.json");

  return new Map([
    ["package.json", packageJson.version],
    ["package-lock.json", packageLock.version],
    ["package-lock.json packages['']", packageLock.packages?.[""]?.version],
    [
      "src-tauri/Cargo.toml",
      manifestVersion(readFileSync("src-tauri/Cargo.toml", "utf8"), "src-tauri/Cargo.toml"),
    ],
    ["src-tauri/Cargo.lock", lockVersion(readFileSync("src-tauri/Cargo.lock", "utf8"))],
    ["src-tauri/tauri.conf.json", tauriConfig.version],
  ]);
}

function semverParts(version, source) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  if (!match) {
    abort(`${source} has invalid release version ${JSON.stringify(version)}; expected x.y.z`);
  }
  return match.slice(1).map(Number);
}

function isNewerVersion(candidate, base) {
  const next = semverParts(candidate, "current metadata");
  const previous = semverParts(base, "base package.json");
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== previous[index]) return next[index] > previous[index];
  }
  return false;
}

function isBinaryImpacting(path) {
  if (NON_BINARY_FILES.has(path)) return false;
  return BINARY_FILES.has(path) || BINARY_PREFIXES.some((prefix) => path.startsWith(prefix));
}

const args = process.argv.slice(2);
const releaseMode = args[0] === "--release";
const baseRef = releaseMode ? args[1] : args[0];
if (!baseRef || args.length !== (releaseMode ? 2 : 1)) {
  abort("usage: node scripts/check-release.mjs [--release] <base-ref>");
}

const baseCommit = git(["rev-parse", "--verify", `${baseRef}^{commit}`]);
const changedAgainstBase = git([
  "diff",
  "--name-only",
  "--diff-filter=ACDMRTUXB",
  baseCommit,
])
  .split("\n")
  .filter(Boolean);
const untrackedFiles = git(["ls-files", "--others", "--exclude-standard"])
  .split("\n")
  .filter(Boolean);
const changedFiles = [...new Set([...changedAgainstBase, ...untrackedFiles])].sort();
const binaryFiles = changedFiles.filter(isBinaryImpacting);

const versions = currentVersions();
const version = versions.get("package.json");
for (const [source, foundVersion] of versions) {
  if (foundVersion !== version) {
    abort(`${source} is ${JSON.stringify(foundVersion)}, but package.json is ${JSON.stringify(version)}`);
  }
}
semverParts(version, "current metadata");

let baseVersion;
try {
  baseVersion = JSON.parse(git(["show", `${baseCommit}:package.json`])).version;
} catch (error) {
  abort(`could not read package.json at ${baseRef}: ${error.message}`);
}

const requiresIncrement = releaseMode || binaryFiles.length > 0;
if (requiresIncrement && !isNewerVersion(version, baseVersion)) {
  const reason = releaseMode
    ? "a release must be newer than the latest release tag"
    : `binary-impacting files changed (${binaryFiles.join(", ")})`;
  abort(`${reason}, but version ${version} is not newer than ${baseVersion} at ${baseRef}`);
}
if (binaryFiles.length > 0 && !changedFiles.includes("CHANGELOG.md")) {
  abort("binary-impacting files changed, but CHANGELOG.md was not updated");
}

let notesHeading;
try {
  notesHeading = releaseNotes(version).heading;
} catch (error) {
  abort(error.message);
}
console.log(`Release metadata check passed for ${version}.`);
console.log(
  binaryFiles.length > 0
    ? `Binary-impacting changes: ${binaryFiles.join(", ")}`
    : "No binary-impacting changes detected.",
);
console.log(`Release notes: ${notesHeading}`);
console.log(`Synchronized metadata: ${VERSION_FILES.join(", ")}`);
