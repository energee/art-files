// tauri-capabilities.test.ts — the desktop app must be able to re-read a
// .master it previously applied, write back to .label/.master paths that did
// not come from a dialog (Finder/argv opens, remembered masters), reach files
// inside hidden folders, and Open Master must use the native dialog so the
// index stores a real path rather than a basename. The window also enforces
// a content security policy that keeps it to its own bundled code.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const caps = JSON.parse(readFileSync("src-tauri/capabilities/default.json", "utf8")) as {
  permissions: Array<string | { identifier: string; allow?: { path: string }[] }>;
};
const tauriConf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as {
  plugins?: { fs?: { requireLiteralLeadingDot?: boolean } };
  app: { security: { csp: string | null } };
};

/** Glob paths a scoped fs permission allows, across every entry for it;
 *  [] when missing or unscoped. */
function scopedPaths(identifier: string): string[] {
  return caps.permissions.flatMap((p) =>
    typeof p === "object" && p.identifier === identifier ? (p.allow ?? []).map((a) => a.path) : []);
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
    expect(scopedPaths("fs:allow-write-file")).toEqual(expect.arrayContaining(read));
  });

  // An export pair asks once: the mask is written beside the art file the
  // dialog chose, replacing whatever is there (useExport.ts), so the pair
  // never checks for it. Only the one-file print PDF looks for an older
  // `-mask.pdf` beside it, to warn that it is stale; no PSD check exists.
  it("can write an export's mask beside its art file, and check only for a stale -mask.pdf", () => {
    const mask = ["**/*-mask.[pP][dD][fF]", "**/*-mask.[pP][sS][dD]"];
    expect(scopedPaths("fs:allow-write-file")).toEqual(expect.arrayContaining(mask));
    expect(scopedPaths("fs:allow-exists")).toContain("**/*-mask.[pP][dD][fF]");
    expect(scopedPaths("fs:allow-exists")).not.toContain("**/*-mask.[pP][sS][dD]");
  });

  // #390: the atomic save writes a temp .label/.master beside the target,
  // renames it over the original and removes it on failure.
  it("can rename and remove the atomic-save temp wherever it can read", () => {
    const read = scopedPaths("fs:allow-read-file");
    expect(scopedPaths("fs:allow-rename")).toEqual(read);
    expect(scopedPaths("fs:allow-remove")).toEqual(read);
  });

  // File → Open Recent checks a remembered .label still exists before
  // opening it, so a moved file gets a readable error.
  it("can check whether a readable .label/.master still exists", () => {
    expect(scopedPaths("fs:allow-exists")).toEqual(expect.arrayContaining(scopedPaths("fs:allow-read-file")));
  });

  // Crash recovery reads a .label's modified time before handing a restored
  // tab its file back (recovery.ts canRebind).
  it("can read when a .label was last written", () => {
    expect(scopedPaths("fs:allow-stat")).toContain("**/*.[lL][aA][bB][eE][lL]");
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

// A null CSP let any injected markup load and run remote code. Everything the
// app loads is bundled ('self', blob: previews, data: inlined assets) and the
// updater downloads from Rust, so no directive names a remote host or eval.
describe("desktop content security policy", () => {
  it("is enforced, allows no eval and names no remote host", () => {
    const csp = tauriConf.app.security.csp ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toMatch(/unsafe-eval|https?:\/\/(?!ipc\.localhost)|\*/);
  });
});
