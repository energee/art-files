// is-entry.mjs — the CLI entry guard shared by scripts/release-notes.mjs and
// scripts/golden-diff.mts: run main() only when the module is the process's
// entry point, never when a test imports it.

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** True when `moduleUrl` (pass `import.meta.url`) is the script node started.
 *  argv[1] goes through realpath because node reports `import.meta.url` at the
 *  real path: a plain resolve() never matched a run through a symlinked
 *  checkout, so the script silently did nothing and exited 0 (#110). */
export function isEntry(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === moduleUrl;
  } catch {
    return false; // argv[1] is not a file on disk, so it is not this module
  }
}
