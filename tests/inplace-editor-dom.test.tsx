// inplace-editor-dom.test.tsx — the on-canvas text editor
// (src/components/PreviewCompare.tsx) sets its type the way the preview
// under it paints: unkerned, like drawPlate and the PDF (#86, #144). Mounted
// through react-dom/client + act, matching tests/rulers-dom.test.tsx.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewCompare } from "../src/components/PreviewCompare";
import type { CanvasRenderSource } from "../src/canvas/draw";
import { PAGE } from "../src/layout";
import type { Layer, TextLine } from "../src/model/layers";
import { boxOfLayer, lolevLayers, logoSvg, measure } from "./fixtures";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

const W = 800;
const H = (W * PAGE.h) / PAGE.w;
const rect = { x: 0, y: 0, left: 0, top: 0, right: W, bottom: H, width: W, height: H, toJSON: () => ({}) } as DOMRect;

/** Mount the preview and double-click the centre of one text layer's box.
 *  `editLayerOf` stands in for App's shownLayer (what the label holds). */
function openEditor(id: string, opts: {
  layers?: Layer[]; editLayerOf?: (l: Layer) => Layer;
  onEditText?: (id: string, lines: TextLine[], first: boolean) => void;
  onEditCommit?: (id: string) => void;
} = {}) {
  const layers = opts.layers ?? lolevLayers();
  const planAssets = { logoSvg };
  const source: CanvasRenderSource = {
    m: measure, planAssets, drawAssets: {} as CanvasRenderSource["drawAssets"], skip: new Set<string>(), fontCss: "Test",
  };
  const noop = () => {};
  const snap = () => ({ x: null, y: null, dx: 0, dy: 0 });
  act(() => {
    root.render(createElement(PreviewCompare, {
      canvasRender: source, layers, editLayerOf: opts.editLayerOf ?? ((l) => l), selected: [], onPick: noop,
      onEditText: opts.onEditText ?? noop, onEditUppercase: noop,
      onEditCommit: opts.onEditCommit ?? noop,
      onDrag: snap, onDragCancel: noop, onResize: snap, onEditSession: noop,
      cornerRadiusPct: 0, zoom: 1, bleedIn: 0, unit: "in",
    } as Parameters<typeof PreviewCompare>[0]));
  });
  const sheet = container.querySelector<HTMLDivElement>('[data-slot="label-sheet"]')!;
  sheet.getBoundingClientRect = () => rect;
  const b = boxOfLayer(id, layers, measure, planAssets)!;
  act(() => {
    sheet.dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true,
      clientX: ((b.x + b.w / 2) / PAGE.w) * W,
      clientY: ((b.y + b.h / 2) / PAGE.h) * H,
    }));
  });
}

describe("in-place text editor kerning (#144)", () => {
  it("the rich-text field sets its type unkerned", () => {
    openEditor("name");
    const field = document.querySelector<HTMLElement>('[aria-label="Edit name text"]');
    expect(field).not.toBeNull();
    expect(field!.parentElement!.getAttribute("style")).toContain("font-kerning: none");
  });

  it("the single-line input field sets its type unkerned", () => {
    openEditor("abv");
    const input = container.querySelector<HTMLInputElement>("input");
    expect(input).not.toBeNull();
    expect(input!.closest<HTMLElement>("[style*='font-family']")!.getAttribute("style")).toContain("font-kerning: none");
  });
});

// UX audit #17 — the canvas box stripped anything but digits and "." and never
// showed the error the sidebar does, so 150% ABV looked accepted.
describe("in-place number/code field validation", () => {
  /** The ABV layer as the label holds it: `text`, optionally re-typed. */
  const holding = (text: string, extra: Partial<Layer> = {}) => (l: Layer): Layer =>
    l.id === "abv" && l.kind === "text"
      ? { ...l, ...extra, lines: [{ ...l.lines[0], text }] } as Layer : l;

  it("flags an out-of-range number under the box, like the sidebar", () => {
    openEditor("abv", { editLayerOf: holding("150") });
    const input = container.querySelector<HTMLInputElement>('[aria-label="Edit abv text"]')!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const error = document.getElementById(input.getAttribute("aria-describedby")!);
    expect(error?.textContent).toBe("Must be at most 20.");
    // Outside the rotated row, so it reads level whatever the layer's turn.
    expect(input.parentElement!.contains(error)).toBe(false);
    // Room below a box near the top-left: the chip hangs under it.
    expect(error!.className).toMatch(/\btop-full\b.*\bleft-0\b/);
  });

  it("keeps a rotated layer's error level, outside the turned row", () => {
    // Turned, the ABV column runs down over the description: stack it on top
    // so the double-click lands on it.
    const layers = lolevLayers();
    const abv = { ...layers.find((l) => l.id === "abv")!, rotation: 90 } as Layer;
    openEditor("abv", {
      layers: [...layers.filter((l) => l.id !== "abv"), abv], editLayerOf: holding("150", { rotation: 90 }),
    });
    const input = container.querySelector<HTMLInputElement>('[aria-label="Edit abv text"]')!;
    const row = input.parentElement!;
    expect(row.getAttribute("style")).toContain("rotate(-90deg)");
    const error = document.getElementById(input.getAttribute("aria-describedby")!)!;
    expect(error.textContent).toBe("Must be at most 20.");
    expect(row.contains(error)).toBe(false);
    expect(error.closest("[style*='rotate']")).toBeNull();
  });

  it("flips the error above the box at the sheet's bottom-right, where below would clip", () => {
    const moved = (l: Layer): Layer =>
      (l.id === "abv" ? { ...l, x: PAGE.w * 0.75, y: PAGE.h - 12 } as Layer : l);
    openEditor("abv", { layers: lolevLayers().map(moved), editLayerOf: (l) => holding("150")(moved(l)) });
    const input = container.querySelector<HTMLInputElement>('[aria-label="Edit abv text"]')!;
    const error = document.getElementById(input.getAttribute("aria-describedby")!)!;
    expect(error.className).toMatch(/\bbottom-full\b.*\bright-0\b/);
    expect(error.className).not.toMatch(/\btop-full\b|\bleft-0\b/);
  });

  it("keeps what was typed instead of stripping it", () => {
    const onEditText = vi.fn();
    openEditor("abv", { onEditText });
    const input = container.querySelector<HTMLInputElement>('[aria-label="Edit abv text"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "5,8");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onEditText.mock.lastCall?.[1][0].text).toBe("5,8");
  });

  it("flags a bad code and says nothing while the box is empty", () => {
    openEditor("abv", { editLayerOf: holding("123", { input: "code", symbology: "upc-a" }) });
    const input = container.querySelector<HTMLInputElement>('[aria-label="Edit abv text"]')!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).toMatch(/12 digits/);
    act(() => { root.unmount(); });
    root = createRoot(container);
    openEditor("abv", { editLayerOf: holding("") });
    const empty = container.querySelector<HTMLInputElement>('[aria-label="Edit abv text"]')!;
    expect(empty.getAttribute("aria-invalid")).toBeNull();
    expect(empty.getAttribute("aria-describedby")).toBeNull();
  });
});

// UX audit (2026-10) #2 — Style (a layer with choices) opened the rich lines
// field on the canvas, which applies every keystroke, and every apply learned
// a choice. The canvas now opens the plain box the sidebar's picker field is,
// and reports the session's COMMIT once, when it ends, so App learns only the
// final value.
describe("in-place session on a choice field (Style)", () => {
  const type = (input: HTMLInputElement, text: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  it("opens the plain box, as the sidebar does, not the rich lines field", () => {
    openEditor("styleLine");
    expect(container.querySelector('[aria-label="Edit style text"]')?.tagName).toBe("INPUT");
    expect(container.querySelector("[contenteditable]")).toBeNull();
  });

  it("commits once when the session ends, however many keystrokes it took", () => {
    const onEditText = vi.fn();
    const onEditCommit = vi.fn();
    openEditor("styleLine", { onEditText, onEditCommit });
    const input = container.querySelector<HTMLInputElement>('[aria-label="Edit style text"]')!;
    for (const t of ["L", "La", "Lag", "Lage", "Lager"]) type(input, t);
    expect(onEditText).toHaveBeenCalledTimes(5);
    expect(onEditCommit).not.toHaveBeenCalled();
    act(() => { document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    expect(onEditCommit.mock.calls).toEqual([["styleLine"]]);
  });

});

// UX decision (2026-10): Escape in a canvas text editor used to cancel the
// session and throw the typing away. Like Figma and Illustrator it now KEEPS
// the text and leaves the editor — the same end as Enter or a click away, so
// the session commits once and stays one undo step (App's side of that is in
// tests/app-v3-dom.test.tsx).
describe("Escape ends an in-place session keeping the text", () => {
  const escape = (el: Element) => act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  it("in the plain box: the typing stays and the session commits once", () => {
    const onEditText = vi.fn();
    const onEditCommit = vi.fn();
    openEditor("styleLine", { onEditText, onEditCommit });
    const input = container.querySelector<HTMLInputElement>('[aria-label="Edit style text"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Lager");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    escape(input);
    expect(container.querySelector('[aria-label="Edit style text"]')).toBeNull();
    expect(onEditText.mock.lastCall?.[1][0].text).toBe("Lager");
    expect(onEditCommit.mock.calls).toEqual([["styleLine"]]);
  });

  it("in the rich field: the typing stays and the session commits once", () => {
    const onEditText = vi.fn();
    const onEditCommit = vi.fn();
    openEditor("name", { onEditText, onEditCommit });
    const field = container.querySelector<HTMLElement>('[aria-label="Edit name text"]')!;
    act(() => {
      field.innerHTML = "<div>Peregrine</div>";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    escape(field);
    expect(container.querySelector('[aria-label="Edit name text"]')).toBeNull();
    expect(onEditText.mock.lastCall?.[1][0].text).toBe("Peregrine");
    expect(onEditCommit.mock.calls).toEqual([["name"]]);
  });

  it("with nothing typed: the editor closes and commits nothing", () => {
    const onEditCommit = vi.fn();
    openEditor("styleLine", { onEditCommit });
    escape(container.querySelector('[aria-label="Edit style text"]')!);
    expect(container.querySelector('[aria-label="Edit style text"]')).toBeNull();
    expect(onEditCommit).not.toHaveBeenCalled();
  });
});
