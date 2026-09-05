// text-editor.test.ts — the pure TextLine[] <-> EditorLine[] adapters behind
// the WYSIWYG text-layer field (src/components/TextEditor.tsx). The DOM half
// is tests/text-editor-dom.test.ts. These stay thin: a TextLine's inline
// `**`/`_` runs are description.ts's grammar (parseRuns) and are covered
// there; what is pinned here is how the per-LINE flags (bold, white-ink
// layer, header) map onto the stored line objects and back.
import { describe, expect, it } from "vitest";
import { fromEditorLines, toEditorLines, type EditorLine } from "../src/components/TextEditor";
import type { TextLine } from "../src/model/layers";
import { GOLD } from "../src/layout";

const base = { fill: GOLD, layer: "metallic" } as const;
const whiteBase = { fill: "none", layer: "white" } as const;

/** Lines shaped exactly as model/lolevLayers.ts authors them: the block's
 *  style spread onto each line, `bold`/`header` present only when true. */
const block: TextLine[] = [
  { text: "HOPS", ...base, bold: true, header: true },
  { text: "Freestyle **Motueka**", ...base },
  { text: "_Roy_ Farms", ...base },
  { text: "", ...base },
  { text: "tail", ...base, layer: "white" },
];

describe("toEditorLines", () => {
  it("reads the per-line flags and keeps inline markers in the text", () => {
    expect(toEditorLines(block)).toEqual([
      { text: "HOPS", bold: true, white: false, header: true },
      { text: "Freestyle **Motueka**", bold: false, white: false, header: false },
      { text: "_Roy_ Farms", bold: false, white: false, header: false },
      { text: "", bold: false, white: false, header: false },
      { text: "tail", bold: false, white: true, header: false },
    ]);
  });
});

describe("fromEditorLines", () => {
  it("round-trips the Lolev-shaped block byte-for-byte", () => {
    expect(fromEditorLines(toEditorLines(block), base)).toStrictEqual(block);
  });

  it("writes the block style onto a new line, flags only when set", () => {
    const styled = { ...base, stroke: "#ffffff", strokeWidth: 20, letterSpacing: 1 } as const;
    const plain: EditorLine = { text: "new", bold: false, white: false, header: false };
    expect(fromEditorLines([plain], styled)).toStrictEqual([{ ...styled, text: "new" }]);
  });

  // The old markdown format had no "not white" marker, so under a white base
  // a line could never opt out of the white plate. Lines carry their own
  // layer now: the toggle IS the per-line layer control, so off means the
  // metallic plate regardless of what the block's base says.
  it("writes an explicit layer per line, independent of the base layer", () => {
    const lines: EditorLine[] = [
      { text: "on", bold: false, white: true, header: false },
      { text: "off", bold: false, white: false, header: false },
    ];
    expect(fromEditorLines(lines, whiteBase).map((l) => l.layer)).toEqual(["white", "metallic"]);
  });

  it("gives an empty field one empty line rather than none", () => {
    expect(fromEditorLines([], base)).toStrictEqual([{ ...base, text: "" }]);
  });
});
