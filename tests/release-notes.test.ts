// release-notes.test.ts — the changelog rules check-release.mjs enforces:
// the current section must exist with bullets, and a branch may not leave
// an intermediate section no release will ever publish.
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no declaration file
import { pendingNotes, releaseNotes, unreleasedSections } from "../scripts/release-notes.mjs";

const log = `# Changelog

## [0.1.52] - 2026-09-05
- Reorder layers by dragging.

## [0.1.51] - 2026-09-05
- Master picker uses Select.

## [0.1.50] - 2026-09-01
- Show up-to-date status.
`;

describe("unreleasedSections", () => {
  it("flags a section newer than the base that is not the current version", () => {
    expect(unreleasedSections("0.1.52", "0.1.50", log)).toEqual(["0.1.51"]);
  });
  it("accepts a single bump", () => {
    expect(unreleasedSections("0.1.51", "0.1.50", log.replace(/## \[0\.1\.52\][^#]*/, ""))).toEqual([]);
  });
  it("ignores sections at or below the base", () => {
    expect(unreleasedSections("0.1.52", "0.1.51", log)).toEqual([]);
  });
});

describe("releaseNotes", () => {
  it("returns the current section's heading and bullets", () => {
    expect(releaseNotes("0.1.52", log)).toEqual({
      heading: "## [0.1.52] - 2026-09-05", body: "- Reorder layers by dragging.",
    });
  });
});

describe("pendingNotes", () => {
  const pending = `# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- Undo restores images.\n\n${log.slice(log.indexOf("## [0.1.52]"))}`;
  it("returns the bullets queued under [Unreleased] for the next release", () => {
    expect(pendingNotes(pending)).toBe("### Fixed\n\n- Undo restores images.");
  });
  it("is null without an [Unreleased] section, or with one that has no bullets", () => {
    expect(pendingNotes(log)).toBeNull();
    expect(pendingNotes(pending.replace("- Undo restores images.", ""))).toBeNull();
  });
  it("does not count [Unreleased] as a numbered section", () => {
    expect(unreleasedSections("0.1.52", "0.1.52", pending)).toEqual([]);
  });
});
