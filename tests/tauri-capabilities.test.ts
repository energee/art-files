// tauri-capabilities.test.ts — the desktop app must be able to re-read a
// .master it previously applied, and Open Master must use the native dialog
// so the index stores a real path rather than a basename.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const caps = JSON.parse(readFileSync("src-tauri/capabilities/default.json", "utf8")) as {
  permissions: Array<string | { identifier: string; allow?: { path: string }[] }>;
};

describe("desktop master-file access", () => {
  it("can re-read .master files from disk", () => {
    const read = caps.permissions.find((p) => typeof p === "object" && p.identifier === "fs:allow-read-file");
    expect(read && typeof read === "object" ? read.allow?.map((a) => a.path) : []).toContain(
      "**/*.[mM][aA][sS][tT][eE][rR]",
    );
  });

  it("can open a native file dialog", () => {
    expect(caps.permissions).toContain("dialog:allow-open");
  });
});
