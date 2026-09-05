// updater.test.ts — release-note line classification for the update dialog
// (src/components/DesktopUpdater.tsx).
import { describe, expect, it } from "vitest";
import { releaseNoteLines } from "@/components/DesktopUpdater";

describe("releaseNoteLines", () => {
  it("classifies headings, bullets, and plain text, dropping blank lines", () => {
    const body = "## What's new\r\n\n* Workspace tabs\n- Faster PSD build\n\nSee the docs.\n";
    expect(releaseNoteLines(body)).toEqual([
      { kind: "heading", text: "What's new" },
      { kind: "bullet", text: "Workspace tabs" },
      { kind: "bullet", text: "Faster PSD build" },
      { kind: "text", text: "See the docs." },
    ]);
  });

  it("folds a wrapped changelog bullet's indented continuation into the bullet", () => {
    expect(releaseNoteLines("- Show status in the bar,\n  including after closing.\nPlain line.")).toEqual([
      { kind: "bullet", text: "Show status in the bar, including after closing." },
      { kind: "text", text: "Plain line." },
    ]);
  });

  it("does not treat bare punctuation as markup", () => {
    expect(releaseNoteLines("#hashtag\n*emphasis*")).toEqual([
      { kind: "text", text: "#hashtag" },
      { kind: "text", text: "*emphasis*" },
    ]);
  });
});
