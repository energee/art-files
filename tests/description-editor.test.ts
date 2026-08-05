// description-editor.test.ts — round-trip tests for the pure markdown<->lines
// mapping behind the WYSIWYG description editor (src/components/
// DescriptionEditor.tsx). These stay thin adapter tests: the actual
// markdown grammar is description.ts's job and is covered there.
import { describe, expect, it } from "vitest";
import { linesToMarkdown, markdownToLines, type EditorLine } from "../src/components/DescriptionEditor";
import { GOLD } from "../src/layout";

const base = { fill: GOLD, layer: "metallic" } as const;
const whiteBase = { fill: "none", layer: "white" } as const;

describe("description editor mapping", () => {
  it("round-trips the default block", () => {
    const md = "# HOPS\nFreestyle Motueka\n**_Roy Farms_**";
    const lines = markdownToLines(md, base);
    expect(lines[0]).toMatchObject({ text: "HOPS", header: true });
    expect(lines[1]).toMatchObject({ text: "Freestyle Motueka", bold: false, white: false });
    expect(lines[2]).toMatchObject({ text: "Roy Farms", bold: true, white: true });
    expect(linesToMarkdown(lines, base)).toBe(md);
  });

  it("handles a headerless block", () => {
    const lines = markdownToLines("just a line", base);
    expect(lines).toHaveLength(1);
    expect(lines[0].header).toBe(false);
    expect(linesToMarkdown(lines, base)).toBe("just a line");
  });

  // Regression (data loss): with the block's base layer set to white, every
  // line resolves white FROM THE BASE. Writing a `_…_` marker for those
  // baked the base into the text, so switching Layer back to metallic no
  // longer restored gold — the description printed with no gold ink and the
  // whole block sat on the white plate.
  describe("a white base layer never leaks into per-line markers", () => {
    const md = "# HOPS\nFreestyle Motueka";

    it("keeps base-resolved white lines unmarked", () => {
      const lines = markdownToLines(md, whiteBase);
      // They RENDER white (that is what the field paints)...
      expect(lines.every((l) => l.white)).toBe(true);
      // ...but carry no marker of their own, so the text is unchanged.
      expect(linesToMarkdown(lines, whiteBase)).toBe(md);
    });

    it("survives switching the base back to metallic", () => {
      const stored = linesToMarkdown(markdownToLines(md, whiteBase), whiteBase);
      const backToGold = markdownToLines(stored, base);
      expect(backToGold.every((l) => l.white)).toBe(false);
      expect(backToGold.map((l) => l.text)).toEqual(["HOPS", "Freestyle Motueka"]);
    });

    it("still writes a marker for a real per-line override on a gold base", () => {
      const lines = markdownToLines("plain", base);
      lines[0].white = true;
      expect(linesToMarkdown(lines, base)).toBe("_plain_");
    });
  });

  // Regression (data loss): pressing Enter inside the header made the browser
  // clone the header div, so the field reported TWO header lines. The
  // serializer kept the first and filtered the rest out entirely, deleting
  // everything after the split point.
  it("demotes a second header line to body text instead of dropping it", () => {
    const lines: EditorLine[] = [
      { text: "HO", bold: true, white: false, header: true },
      { text: "PS", bold: true, white: false, header: true },
      { text: "Freestyle Motueka", bold: false, white: false, header: false },
    ];
    const md = linesToMarkdown(lines, base);
    expect(md).toBe("# HO\n**PS**\nFreestyle Motueka");
    expect(markdownToLines(md, base).map((l) => l.text)).toEqual([
      "HO", "PS", "Freestyle Motueka",
    ]);
  });

  // The same '#'-body-line round-trip description.ts is fixed for, through
  // the editor helpers: a first line typed as "#3 Citra" with the Header
  // toggle off must stay a body line, not reappear as the header.
  it("keeps a typed '#' first line a body line", () => {
    const lines: EditorLine[] = [
      { text: "#3 Citra", bold: false, white: false, header: false },
      { text: "Mosaic", bold: false, white: false, header: false },
    ];
    const md = linesToMarkdown(lines, base);
    expect(markdownToLines(md, base)).toEqual(lines);
  });

  it("keeps a header flag that isn't on the first line as body text", () => {
    const lines: EditorLine[] = [
      { text: "first", bold: false, white: false, header: false },
      { text: "stray", bold: false, white: false, header: true },
    ];
    expect(linesToMarkdown(lines, base)).toBe("first\nstray");
  });
});
