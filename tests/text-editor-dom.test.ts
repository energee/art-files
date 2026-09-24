// text-editor-dom.test.ts — the DOM half of the text-layer field
// (src/components/TextEditor.tsx): useTextField seeds a TextLine[] into
// line-divs and run-spans and reads them back on every input, the Bold /
// White ink / Header toggles edit the live nodes, a single-line field
// swallows Enter and pasted newlines, and the TextEditor component picks the
// number / code / rich widget off `input`. Same harness as
// tests/description-editor-dom.test.ts (which this file will replace when
// the old editor is deleted): happy-dom per-file, react-dom/client + act,
// no testing library — every assertion is on the emitted lines or the DOM.
// @vitest-environment happy-dom
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TextEditor, TextToolbarButtons, useTextField } from "../src/components/TextEditor";
import { TooltipProvider } from "../src/components/ui/tooltip";
import type { TextLine } from "../src/model/layers";
import { GOLD } from "../src/layout";

// React only honours act() when the environment opts in; without this every
// act() call still works but logs "not configured to support act(...)".
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = { fill: GOLD, layer: "metallic" } as const;
const line = (text: string, extra: Partial<TextLine> = {}): TextLine => ({ ...base, text, ...extra });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

/** Mounts the hook over `lines` and hands back its actions, the live root,
 *  and every TextLine[] onChange emitted. `lines` never changes (the harness
 *  only records), so the seed effect runs once and an edit is never reseeded
 *  out from under the assertions. */
function mountField(lines: TextLine[], opts: { multiline?: boolean; uppercase?: boolean } = {}) {
  const emitted: TextLine[][] = [];
  let api!: ReturnType<typeof useTextField>;
  function Harness(): ReactNode {
    api = useTextField({
      lines, base, multiline: opts.multiline ?? true, uppercase: opts.uppercase,
      onChange: (out) => { emitted.push(out); },
    });
    return createElement("div", api.fieldProps);
  }
  act(() => { root.render(createElement(Harness)); });
  const el = container.firstElementChild as HTMLDivElement;
  return {
    emitted, el,
    toggle: (attr: "bold" | "white") => act(() => { api.toggle(attr); }),
    toggleHeader: () => act(() => { api.toggleHeader(); }),
    /** A native input event — what every keystroke fires. */
    input: () => act(() => { el.dispatchEvent(new Event("input", { bubbles: true })); }),
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

describe("useTextField round-trips lines through the DOM", () => {
  const block: TextLine[] = [
    line("HOPS", { bold: true, header: true }),
    line("Freestyle **Motueka**"), // an inline bold run
    line("_Roy_ Farms"), // an inline white run
    line(""), // a blank line — renders as a vertical gap
    line("tail", { layer: "white" }), // a whole white-ink line
  ];

  it("paints one line-div per line, runs as spans, and reads them back unchanged", () => {
    const { emitted, el, input } = mountField(block);
    expect(el.children).toHaveLength(5);
    expect(el.querySelectorAll("span")).toHaveLength(2);
    expect(el.children[0].getAttribute("data-header")).toBe("true");
    input();
    expect(emitted.at(-1)).toStrictEqual(block);
  });

  it("gives an empty layer one focusable line", () => {
    const { emitted, el, input } = mountField([]);
    expect(el.children).toHaveLength(1);
    input();
    expect(emitted.at(-1)).toStrictEqual([line("")]);
  });
});

describe("Bold / White ink / Header toggles over the live field", () => {
  it("wraps a partial selection in a bold run, and a second press unwraps it", () => {
    const { emitted, toggle, el } = mountField([line("hello world")]);
    select(el, "hello");
    toggle("bold");
    expect(emitted.at(-1)).toStrictEqual([line("**hello** world")]);
    toggle("bold");
    expect(emitted.at(-1)).toStrictEqual([line("hello world")]);
  });

  it("wraps a partial selection in white ink", () => {
    const { emitted, toggle, el } = mountField([line("hello world")]);
    select(el, "world");
    toggle("white");
    expect(emitted.at(-1)).toStrictEqual([line("hello _world_")]);
  });

  // Regression carried over: a bare caret inside a run reads as pressed, so
  // pressing it turns THAT run off rather than emboldening the whole line.
  it("unwraps the run a collapsed caret sits in", () => {
    const { emitted, toggle, el } = mountField([line("**a** b")]);
    select(el, "a", true);
    toggle("bold");
    expect(emitted.at(-1)).toStrictEqual([line("a b")]);
  });

  it("falls through to the whole line when the selection fills it", () => {
    const { emitted, toggle, el } = mountField([line("hello")]);
    select(el, "hello");
    toggle("bold");
    expect(emitted.at(-1)).toStrictEqual([line("hello", { bold: true })]);
    select(el, "hello");
    toggle("white");
    expect(emitted.at(-1)).toStrictEqual([line("hello", { bold: true, layer: "white" })]);
  });

  // `header` is a flag on any line now (TextLayer.headerScale sets every
  // header line), not the markdown format's single first-line slot.
  it("toggles header on the line the caret is in, whichever line that is", () => {
    const { emitted, toggleHeader, el } = mountField([line("first"), line("second")]);
    select(el, "second", true);
    toggleHeader();
    expect(emitted.at(-1)).toStrictEqual([line("first"), line("second", { header: true })]);
    toggleHeader();
    expect(emitted.at(-1)).toStrictEqual([line("first"), line("second")]);
  });
});

describe("single-line fields", () => {
  it("swallows Enter", () => {
    const { el } = mountField([line("Peregrine")], { multiline: false });
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    el.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(el.getAttribute("aria-multiline")).toBe("false");
  });

  it("lets Enter through on a multiline field", () => {
    const { el } = mountField([line("first")]);
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    el.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(el.getAttribute("aria-multiline")).toBe("true");
  });

  it("flattens pasted newlines into spaces", () => {
    const { emitted, el } = mountField([line("Pere")], { multiline: false });
    // Caret after the existing text: the fallback insert lands there.
    window.getSelection()!.collapse(el.firstChild!.firstChild, 4);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "grine\nFalcon\n" },
    });
    act(() => { el.dispatchEvent(paste); });
    expect(emitted.at(-1)).toStrictEqual([line("Peregrine Falcon ")]);
  });

  it("emits only the first line even if the DOM grew a second one", () => {
    const { emitted, el, input } = mountField([line("one")], { multiline: false });
    const stray = document.createElement("div");
    stray.textContent = "two";
    el.appendChild(stray);
    input();
    expect(emitted.at(-1)).toStrictEqual([line("one")]);
  });
});

describe("uppercase", () => {
  it("displays uppercase without touching the stored text", () => {
    const { emitted, el, input } = mountField([line("peregrine")], { uppercase: true });
    expect(el.style.textTransform).toBe("uppercase");
    expect(el.textContent).toBe("peregrine");
    input();
    expect(emitted.at(-1)).toStrictEqual([line("peregrine")]);
  });

  it("leaves the transform off by default", () => {
    const { el } = mountField([line("peregrine")]);
    expect(el.style.textTransform).toBe("");
  });
});

// ---- the TextEditor component ------------------------------------------

type EditorProps = Parameters<typeof TextEditor>[0];
function renderEditor(props: Partial<EditorProps> & Pick<EditorProps, "lines">) {
  const onChange = vi.fn();
  const full: EditorProps = {
    id: "layer", label: "Layer", base, multiline: true, onChange, ...props,
  };
  act(() => {
    root.render(createElement(TooltipProvider, null, createElement(TextEditor, full)));
  });
  return { onChange };
}

/** Drives a controlled <input> the way React listens for it. */
function change(el: Element, value: string) {
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const focusTextbox = () => {
  const box = container.querySelector('[role="textbox"]') as HTMLElement;
  act(() => { box.focus(); });
  return box;
};

describe("TextEditor", () => {
  it("renders the label and the rich field with the layer's lines", () => {
    renderEditor({ id: "description", label: "Description", lines: [line("HOPS", { header: true })] });
    expect(container.textContent).toContain("Description");
    const box = container.querySelector("#description") as HTMLElement;
    expect(box.getAttribute("role")).toBe("textbox");
    expect(box.textContent).toBe("HOPS");
  });

  it("shows the toolbar with Header only while focused on a multiline field", () => {
    renderEditor({ lines: [line("x")], multiline: true });
    expect(container.querySelector('[aria-label="Toggle bold"]')).toBeNull();
    focusTextbox();
    expect(container.querySelector('[aria-label="Toggle bold"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Toggle white ink underlay"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Toggle header"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/markdown/i);
  });

  // Issue #120: Shift+Tab out of the field lands on the toolbar, so the
  // toggles must stay mounted while focus is anywhere in the field's row —
  // and still act on the selection the field left behind.
  it("keeps the toolbar reachable by keyboard from the field", () => {
    const { onChange } = renderEditor({ lines: [line("x")], multiline: true });
    const box = focusTextbox();
    act(() => { window.getSelection()!.selectAllChildren(box.firstElementChild!); });
    const bold = container.querySelector('[aria-label="Toggle bold"]') as HTMLElement;
    act(() => { bold.focus(); });
    expect(container.querySelector('[aria-label="Toggle bold"]')).toBe(bold);
    act(() => { bold.click(); });
    expect(onChange.mock.lastCall?.[0][0]).toMatchObject({ text: "x", bold: true });
    act(() => { bold.blur(); });
    expect(container.querySelector('[aria-label="Toggle bold"]')).toBeNull();
  });

  it("hides Header on a single-line field", () => {
    renderEditor({ lines: [line("x")], multiline: false });
    focusTextbox();
    expect(container.querySelector('[aria-label="Toggle bold"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Toggle header"]')).toBeNull();
  });

  it("never shows the layer's placeholder in the field; the canvas draws it", () => {
    renderEditor({ lines: [line("")] });
    expect(container.querySelector("[placeholder]")).toBeNull();
  });

  it("passes uppercase through to the field", () => {
    renderEditor({ id: "name", lines: [line("peregrine")], uppercase: true });
    const box = container.querySelector("#name") as HTMLElement;
    expect(box.style.textTransform).toBe("uppercase");
  });

  describe("input: number", () => {
    it("renders a number box that writes one plain line, with the suffix shown after it", () => {
      const { onChange } = renderEditor({
        id: "abv", label: "ABV", lines: [line("")], multiline: false,
        input: "number", min: 0, max: 20, suffix: "% alc by vol",
      });
      const box = container.querySelector("#abv") as HTMLInputElement;
      expect(box.type).toBe("number");
      expect(box.min).toBe("0");
      expect(box.max).toBe("20");
      expect(box.placeholder).toBe("");
      expect(container.textContent).toContain("% alc by vol");
      expect(container.querySelector('[role="textbox"]')).toBeNull();
      change(box, "6.5");
      expect(onChange).toHaveBeenCalledWith([line("6.5")]);
    });

    it("shows the current value and flags one outside min/max", () => {
      renderEditor({
        id: "abv", lines: [line("25")], multiline: false, input: "number", min: 0, max: 20,
      });
      expect((container.querySelector("#abv") as HTMLInputElement).value).toBe("25");
      expect(container.textContent).toMatch(/at most 20/);
    });
  });

  describe("input: code", () => {
    it("flags a bad UPC inline", () => {
      renderEditor({
        id: "upc", label: "UPC", lines: [line("123")], multiline: false,
        input: "code", symbology: "upc-a",
      });
      const box = container.querySelector("#upc") as HTMLInputElement;
      expect(box.type).toBe("text");
      // Pinned to validateUpc's real message (src/upc.ts): `"…" is not a
      // valid UPC-A code (12 digits).`
      expect(container.textContent).toMatch(/12 digits/);
    });

    it("accepts a real UPC and writes it as one plain line", () => {
      const { onChange } = renderEditor({
        id: "upc", lines: [line("")], multiline: false, input: "code", symbology: "upc-a",
      });
      expect(container.textContent).not.toMatch(/digits/);
      change(container.querySelector("#upc")!, "850051366224");
      expect(onChange).toHaveBeenCalledWith([line("850051366224")]);
    });

    it("does not judge an empty code", () => {
      renderEditor({ id: "upc", lines: [line("")], multiline: false, input: "code" });
      expect(container.textContent).not.toMatch(/digits/);
    });
  });
});

// docs/plans/choice-input.md, Task 5. `choices` is not an input mode: it rides
// alongside whatever `input` says, so the same picker serves a style (no
// input, rich text underneath) and a barcode tier (input "code", still
// validated). It always takes typing — the list suggests, it never constrains.
describe("TextEditor with a vocabulary", () => {
  const STYLES = [
    { value: "Ultra Hopped Ale" },
    { title: "Hazy IPA", value: "Hazy India Pale Ale" },
  ];
  const TIERS = [
    { title: "Tier 1", value: "850051366040" },
    { title: "Tier 2", value: "860009737631" },
  ];
  /** The vocabulary's own rows; the "Use …" row is `[data-novel]`. */
  const options = () =>
    Array.from(document.querySelectorAll("[data-choice]")) as HTMLElement[];
  const novel = () => document.querySelector("[data-novel]") as HTMLElement | null;
  /** A real click sends mousedown first, which is what the list listens for —
   *  it has to beat the input's blur, or the list is gone before the pick. */
  const pick = (el: HTMLElement) =>
    act(() => { el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  const openList = (id = "layer") => {
    const box = container.querySelector(`#${id}`) as HTMLInputElement;
    act(() => { box.focus(); });
    return box;
  };
  const key = (el: Element, k: string) =>
    act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });

  it("offers the list, showing each choice's title and drawing its value", () => {
    const { onChange } = renderEditor({ lines: [], choices: STYLES });
    openList();
    expect(options().map((o) => o.textContent?.trim()))
      .toEqual(["Ultra Hopped Ale", "Hazy IPA"]);
    pick(options()[1]);
    expect(onChange).toHaveBeenCalledWith([{ ...base, text: "Hazy India Pale Ale" }]);
  });

  it("filters as you type, matching title or value", () => {
    renderEditor({ lines: [], choices: STYLES });
    const box = openList();
    change(box, "hazy");
    expect(options().map((o) => o.textContent?.trim())).toEqual(["Hazy IPA"]);
    change(box, "Ultra");
    expect(options().map((o) => o.textContent?.trim())).toEqual(["Ultra Hopped Ale"]);
  });

  it("takes anything typed, and says so when it matches nothing", () => {
    const { onChange } = renderEditor({ lines: [], choices: STYLES });
    const box = openList();
    change(box, "Saison");
    expect(novel()?.textContent).toContain("Saison");
    key(box, "Enter");
    expect(onChange).toHaveBeenLastCalledWith([{ ...base, text: "Saison" }]);
  });

  it("moves through the list with the arrow keys and commits on Enter", () => {
    const { onChange } = renderEditor({ lines: [], choices: STYLES });
    const box = openList();
    key(box, "ArrowDown");
    key(box, "ArrowDown");
    key(box, "Enter");
    expect(onChange).toHaveBeenLastCalledWith([{ ...base, text: "Hazy India Pale Ale" }]);
  });

  it("closes on Escape without committing", () => {
    const { onChange } = renderEditor({ lines: [], choices: STYLES });
    const box = openList();
    change(box, "Sais");
    onChange.mockClear();
    key(box, "Escape");
    expect(options()).toHaveLength(0);
    expect(novel()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  // The bug this covers: blur reverted to the prop value, so typing a tier
  // code and clicking the canvas threw the edit away — while the plain box
  // beside it commits on every keystroke.
  it("commits what was typed when the field loses focus", () => {
    const { onChange } = renderEditor({ lines: [], choices: STYLES });
    const box = openList();
    change(box, "Saison");
    act(() => { box.blur(); });
    expect(onChange).toHaveBeenLastCalledWith([{ ...base, text: "Saison" }]);
  });

  it("still cancels on Escape, even though blur commits", () => {
    const { onChange } = renderEditor({ lines: [line("Hazy India Pale Ale")], choices: STYLES });
    const box = openList();
    change(box, "Sais");
    onChange.mockClear();
    key(box, "Escape");
    act(() => { box.blur(); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("captions the field with the layer's title when it has one", () => {
    renderEditor({ lines: [], choices: STYLES, label: "Style line", title: "Style" });
    expect(container.textContent).toContain("Style");
    expect(container.textContent).not.toContain("Style line");
  });

  // Task 8's acceptance: a barcode tier picker is the same widget, and the
  // code validation it already had still runs. No barcode branch anywhere.
  it("keeps code validation while offering tiers", () => {
    const { onChange } = renderEditor({
      lines: [], choices: TIERS, input: "code", symbology: "upc-a",
    });
    const box = openList();
    pick(options()[0]);
    expect(onChange).toHaveBeenCalledWith([{ ...base, text: "850051366040" }]);

    renderEditor({ lines: [line("12345")], choices: TIERS, input: "code", symbology: "upc-a" });
    expect(container.textContent).toMatch(/12 digits|invalid|check/i);
  });
});

// `title` is offered on every text layer by the fill contract, so every
// widget has to honour it — the picker was the only one that did.
describe("the layer's title captions every widget", () => {
  it("captions a number box", () => {
    renderEditor({ lines: [], label: "ABV line", title: "ABV", input: "number" });
    expect(container.textContent).toContain("ABV");
    expect(container.textContent).not.toContain("ABV line");
  });

  it("captions the rich field", () => {
    renderEditor({ lines: [], label: "Description layer", title: "Tasting notes" });
    expect(container.textContent).toContain("Tasting notes");
    expect(container.textContent).not.toContain("Description layer");
  });
});

// The flaw the App-level wiring found: a picker opened on a filled field
// filtered itself down to the value already in the box, so a barcode showing
// Tier 6 offered only Tier 6.
it("shows the whole list when a filled field is opened", () => {
  const CHOICES = [{ title: "Tier 1", value: "8500" }, { title: "Tier 6", value: "8600" }];
  renderEditor({ lines: [line("8600")], choices: CHOICES });
  const box = container.querySelector("#layer") as HTMLInputElement;
  act(() => { box.focus(); });
  expect(document.querySelectorAll("[data-choice]")).toHaveLength(2);
});


it("toggles uppercase display from the WYSIWYG toolbar without rewriting text", () => {
  const lines = [line("Mixed case")];
  const onChange = vi.fn();
  function Harness() {
    const [uppercase, setUppercase] = useState(false);
    const field = useTextField({ lines, base, multiline: true, uppercase, onChange });
    return createElement(TooltipProvider, null,
      createElement("div", field.fieldProps),
      createElement(TextToolbarButtons, {
        caret: field.caret, toggle: field.toggle, toggleHeader: field.toggleHeader,
        uppercase, onUppercase: setUppercase,
      }));
  }
  act(() => { root.render(createElement(Harness)); });
  const button = container.querySelector('[aria-label="Toggle uppercase"]') as HTMLElement;
  const field = container.querySelector('[contenteditable="true"]') as HTMLElement;
  expect(button.getAttribute("aria-pressed")).toBe("false");
  act(() => { button.click(); });
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(field.style.textTransform).toBe("uppercase");
  expect(field.textContent).toBe("Mixed case");
  act(() => { button.click(); });
  expect(button.getAttribute("aria-pressed")).toBe("false");
  expect(field.style.textTransform).toBe("");
  expect(field.textContent).toBe("Mixed case");
  expect(onChange).not.toHaveBeenCalled();
});


it("shows uppercase in the sidebar warning field before focus and emits a style toggle", () => {
  const onUppercase = vi.fn(), onChange = vi.fn();
  act(() => { root.render(createElement(TooltipProvider, null,
    createElement(TextEditor, {
      id: "warning", label: "Text", lines: [line("Government warning")], base,
      multiline: true, uppercase: false, onUppercase, onChange,
    }))); });
  const button = container.querySelector('[aria-label="Toggle uppercase"]') as HTMLElement;
  expect(button).not.toBeNull();
  act(() => { button.click(); });
  expect(onUppercase).toHaveBeenCalledWith(true);
  expect(onChange).not.toHaveBeenCalled();
});

it("keeps the run toggles hidden when Tab lands on Uppercase from outside the field", () => {
  act(() => { root.render(createElement(TooltipProvider, null,
    createElement(TextEditor, {
      id: "warning", label: "Text", lines: [line("x")], base,
      multiline: true, uppercase: false, onUppercase: vi.fn(), onChange: vi.fn(),
    }))); });
  const button = container.querySelector('[aria-label="Toggle uppercase"]') as HTMLElement;
  act(() => { button.focus(); });
  expect(container.querySelector('[aria-label="Toggle bold"]')).toBeNull();
});
