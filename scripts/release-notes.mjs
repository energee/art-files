// release-notes.mjs — read the current version's canonical changelog section.

import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function releaseNotes(version, changelog = readFileSync("CHANGELOG.md", "utf8")) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingPattern = new RegExp(
    `^## \\[${escapedVersion}\\] - (\\d{4}-\\d{2}-\\d{2})\\s*$`,
    "m",
  );
  const match = headingPattern.exec(changelog);
  if (!match) throw new Error(`CHANGELOG.md has no dated ## [${version}] release-note section`);

  const bodyStart = match.index + match[0].length;
  const remaining = changelog.slice(bodyStart);
  const nextHeading = remaining.search(/^## /m);
  const body = (nextHeading === -1 ? remaining : remaining.slice(0, nextHeading)).trim();
  if (!/^-\s+\S/m.test(body)) {
    throw new Error(`CHANGELOG.md section ${version} has no release-note bullets`);
  }

  return { heading: `## [${version}] - ${match[1]}`, body };
}

/** The bullets queued under `## [Unreleased]` for the next release, or null
 *  when there is no such section or it lists nothing. Binary-impacting PRs
 *  add here instead of bumping; cutting a release renames the heading. */
export function pendingNotes(changelog = readFileSync("CHANGELOG.md", "utf8")) {
  const match = /^## \[Unreleased\]\s*$/m.exec(changelog);
  if (!match) return null;
  const remaining = changelog.slice(match.index + match[0].length);
  const next = remaining.search(/^## /m);
  const body = (next === -1 ? remaining : remaining.slice(0, next)).trim();
  return /^-\s+\S/m.test(body) ? body : null;
}

/** Changelog versions newer than `baseVersion` that are not `version`. A
 *  branch publishes exactly one section (the current version's); any other
 *  section it introduces is never read by release.yml, so its notes vanish.
 *  Pure so check-release.mjs and the tests share one rule. */
export function unreleasedSections(version, baseVersion, changelog = readFileSync("CHANGELOG.md", "utf8")) {
  const parts = (v) => v.split(".").map(Number);
  const newer = (a, b) => {
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
  };
  return [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)]
    .map((m) => m[1])
    .filter((v) => v !== version && newer(v, baseVersion));
}

function currentVersion() {
  return JSON.parse(readFileSync("package.json", "utf8")).version;
}

function writeGitHubOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error("GITHUB_OUTPUT is not set");

  const delimiter = `release-notes-${randomUUID()}`;
  appendFileSync(outputPath, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, "utf8");
}

function main() {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== "--github-output")) {
      throw new Error("usage: node scripts/release-notes.mjs [--github-output]");
    }

    const version = currentVersion();
    const notes = releaseNotes(version);
    if (args[0] === "--github-output") {
      writeGitHubOutput("body", notes.body);
      console.log(`Prepared GitHub release notes from ${notes.heading}.`);
    } else {
      process.stdout.write(`${notes.body}\n`);
    }
  } catch (error) {
    console.error(`Release notes failed: ${error.message}`);
    process.exitCode = 1;
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryUrl === import.meta.url) main();
