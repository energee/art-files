// description-editor.test.ts — round-trip tests for the pure markdown<->lines
// mapping behind the WYSIWYG description editor (src/components/
// DescriptionEditor.tsx). These stay thin adapter tests: the actual
// markdown grammar is description.ts's job and is covered there.
import { describe, expect, it } from "vitest";
import { linesToMarkdown, markdownToLines } from "../src/components/DescriptionEditor";
import { GOLD } from "../src/layout";

const base = { fill: GOLD, layer: "metallic" } as const;

describe("description editor mapping", () => {
  it("round-trips the default block", () => {
    const md = "# HOPS\nFreestyle Motueka\n**_Roy Farms_**";
    const lines = markdownToLines(md, base);
    expect(lines[0]).toMatchObject({ text: "HOPS", header: true });
    expect(lines[1]).toMatchObject({ text: "Freestyle Motueka", bold: false, white: false });
    expect(lines[2]).toMatchObject({ text: "Roy Farms", bold: true, white: true });
    expect(linesToMarkdown(lines)).toBe(md);
  });

  it("handles a headerless block", () => {
    const lines = markdownToLines("just a line", base);
    expect(lines).toHaveLength(1);
    expect(lines[0].header).toBe(false);
    expect(linesToMarkdown(lines)).toBe("just a line");
  });
});
