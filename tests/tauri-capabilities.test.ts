// tauri-capabilities.test.ts — the desktop app must be able to re-read a
// .master it previously applied, write back to .label/.master paths that did
// not come from a dialog (Finder/argv opens, remembered masters), reach files
// inside hidden folders, and Open Master must use the native dialog so the
// index stores a real path rather than a basename.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const caps = JSON.parse(readFileSync("src-tauri/capabilities/default.json", "utf8")) as {
  permissions: Array<string | { identifier: string; allow?: { path: string }[] }>;
};
const tauriConf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as {
  plugins?: { fs?: { requireLiteralLeadingDot?: boolean } };
};

/** Glob paths a scoped fs permission allows; [] when missing or unscoped. */
function scopedPaths(identifier: string): string[] {
  const perm = caps.permissions.find((p) => typeof p === "object" && p.identifier === identifier);
  return perm && typeof perm === "object" ? (perm.allow ?? []).map((a) => a.path) : [];
}

describe("desktop master-file access", () => {
  it("can re-read .master files from disk", () => {
    expect(scopedPaths("fs:allow-read-file")).toContain("**/*.[mM][aA][sS][tT][eE][rR]");
  });

  // #103: an unscoped fs:allow-write-file only permits paths the dialog plugin
  // added to the runtime scope, so Save to an OS-opened .label or a remembered
  // .master failed with "forbidden path". Write must cover what read covers.
  it("can write back to every .label/.master path it can read", () => {
    const read = scopedPaths("fs:allow-read-file");
    expect(read.length).toBeGreaterThan(0);
    expect(scopedPaths("fs:allow-write-file")).toEqual(read);
  });

  // #112: on unix `**` skips dot-directories unless this is false, so a
  // .label under ~/.something/ was forbidden for both read and write.
  it("matches .label/.master files inside hidden folders", () => {
    expect(tauriConf.plugins?.fs?.requireLiteralLeadingDot).toBe(false);
  });

  it("can open a native file dialog", () => {
    expect(caps.permissions).toContain("dialog:allow-open");
  });
});
