// description-editor-dom.test.ts — the DOM half of the WYSIWYG description
// field (src/components/DescriptionEditor.tsx): seedDom paints a line's
// inline markdown runs as spans, readLineEl re-encodes those spans back into
// the stored `**`/`_` markers, and the Bold/White toggles edit the live
// nodes. That half used to be verified only by driving a real browser, which
// is why the two data-loss regressions below shipped at all.
//
// Scoped to a DOM environment per-file rather than globally (vite.config's
// `test.dir` stays a plain node run) so the rest of the suite — pure,
// DOM-free logic by design, see conventions.md — keeps its faster node
// environment. happy-dom over jsdom: it is the lighter install and its
// Selection/Range implementation is all these tests need.
// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  markdownToLines, readLineEl, seedDom, useDescriptionField,
  type EditorLine, type LinePaint,
} from "../src/components/DescriptionEditor";
import { GOLD } from "../src/layout";

// React only honours act() when the environment opts in; without this every
// act() call still works but logs "not configured to support act(...)".
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = { fill: GOLD, layer: "metallic" } as const;
const whiteBase = { fill: "none", layer: "white" } as const;

/** Painting is the consumer's job (sidebar classes vs label metrics) and none
 *  of it affects the span<->marker mapping under test, so these run with a
 *  painter that writes nothing. */
const noPaint: LinePaint = () => {};

const plainLine = (text: string): EditorLine =>
  ({ text, bold: false, white: false, header: false });

/** seedDom + readLineEl are documented inverses; this drives one line through
 *  both and returns what came back. */
function roundTrip(line: EditorLine): EditorLine {
  const root = document.createElement("div");
  seedDom(root, [line], noPaint);
  return readLineEl(root.children[0] as HTMLDivElement);
}

describe("seedDom / readLineEl round trip", () => {
  it.each([
    ["plain text", plainLine("just a line")],
    ["an inline white run", plainLine("_a_ b")],
    ["an inline bold run", plainLine("**a** b")],
    ["a nested bold+white run", plainLine("**_a_** b")],
    ["a run mid-line", plainLine("hops: **Citra** and _Mosaic_")],
    ["an empty line", plainLine("")],
    ["a header", { text: "HOPS", bold: true, white: false, header: true }],
  ])("keeps %s unchanged", (_label, line) => {
    expect(roundTrip(line)).toEqual(line);
  });

  it("keeps a multi-line block with a header unchanged", () => {
    const md = "# HOPS\nFreestyle Motueka\n**_Roy Farms_**\n\ntail";
    const lines = markdownToLines(md, base);
    const root = document.createElement("div");
    seedDom(root, lines, noPaint);
    expect(Array.from(root.children).map((el) => readLineEl(el as HTMLDivElement)))
      .toEqual(lines);
  });

  it("gives an empty description one focusable line", () => {
    const root = document.createElement("div");
    seedDom(root, [], noPaint);
    expect(root.children).toHaveLength(1);
    expect(readLineEl(root.children[0] as HTMLDivElement)).toEqual(plainLine(""));
  });

  // Regression (data loss). Runs are parsed against a PLAIN base so a run's
  // flags mean "carries this marker", never "renders this way". Parsed
  // against the real base instead, a run whose emphasis the line (or the
  // block's base layer) already supplied came back flagless, seedDom emitted
  // it as a bare text node, and the markers were gone from the stored text on
  // the very next keystroke.
  describe("markers survive a base or line that already renders that way", () => {
    it("keeps an inline `_a_` when the block's base layer is white", () => {
      const line = markdownToLines("_a_ b", whiteBase)[0];
      expect(line.white).toBe(true); // the whole line renders white...
      const root = document.createElement("div");
      seedDom(root, [line], noPaint);
      // ...and the run is still a span of its own, not swallowed into text.
      expect(root.querySelectorAll("span")).toHaveLength(1);
      expect(readLineEl(root.children[0] as HTMLDivElement).text).toBe("_a_ b");
    });

    it("keeps an inline `**a**` inside a line that is itself bold", () => {
      const line: EditorLine = { text: "**a** b", bold: true, white: false, header: false };
      const root = document.createElement("div");
      seedDom(root, [line], noPaint);
      expect(root.querySelectorAll("span")).toHaveLength(1);
      expect(readLineEl(root.children[0] as HTMLDivElement)).toEqual(line);
    });
  });
});

// ---- the toggles, driven through the hook -----------------------------
// The Bold/White actions live in useDescriptionField's closure, so they need
// the hook mounted. React's own createRoot + act is enough — no testing
// library, since every assertion here is on the emitted markdown.

/** Mounts the rich field over `md` and hands back its toggle, the live root,
 *  and every markdown string onChange emitted. `value` never changes (the
 *  harness only records), so the seed effect runs once and an edit is never
 *  reseeded out from under the assertions. */
function mountField(md: string, style = base) {
  const emitted: string[] = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  let toggle!: (attr: "bold" | "white") => void;
  function Harness(): ReactNode {
    const f = useDescriptionField({
      value: md, base: style, paint: noPaint, onChange: (out) => { emitted.push(out); },
    });
    toggle = f.toggle;
    return createElement("div", f.fieldProps);
  }
  act(() => { createRoot(container).render(createElement(Harness)); });
  return {
    emitted,
    el: container.firstElementChild as HTMLDivElement,
    toggle: (attr: "bold" | "white") => act(() => { toggle(attr); }),
  };
}

/** Puts a real selection over `text` inside `el` — or a collapsed caret just
 *  before it when `collapsed`. Walks text nodes because a line's runs are
 *  spans, so its text is spread across several. */
function select(el: HTMLElement, text: string, collapsed = false) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = (n.textContent ?? "").indexOf(text);
    if (i === -1) continue;
    const range = document.createRange();
    range.setStart(n, i);
    range.setEnd(n, collapsed ? i : i + text.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }
  throw new Error(`no text node containing ${JSON.stringify(text)}`);
}

describe("Bold / White ink toggles over the live field", () => {
  beforeEach(() => { document.body.replaceChildren(); });

  // Regression: computeCaret reports the toggle as PRESSED for a bare caret
  // inside a run, so pressing it has to turn that run OFF. It used to fall
  // through to the line-level flag and embolden the whole line instead — a
  // pressed toggle that adds emphasis rather than removing it.
  it("unwraps the run a collapsed caret sits in", () => {
    const { emitted, toggle, el } = mountField("**a** b");
    select(el, "a", true);
    toggle("bold");
    expect(emitted.at(-1)).toBe("a b");
  });

  it("wraps a partial selection in a run, and a second press unwraps it", () => {
    const { emitted, toggle, el } = mountField("hello world");
    select(el, "hello");
    toggle("bold");
    expect(emitted.at(-1)).toBe("**hello** world");
    // wrapSelection leaves the new run selected, so the same press undoes it.
    toggle("bold");
    expect(emitted.at(-1)).toBe("hello world");
  });

  it("wraps a partial selection in white ink", () => {
    const { emitted, toggle, el } = mountField("hello world");
    select(el, "world");
    toggle("white");
    expect(emitted.at(-1)).toBe("hello _world_");
  });

  it("falls through to the whole line when the selection fills it", () => {
    const { emitted, toggle, el } = mountField("hello");
    select(el, "hello");
    toggle("bold");
    expect(emitted.at(-1)).toBe("**hello**");
  });
});
