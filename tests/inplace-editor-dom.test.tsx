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
  editLayerOf?: (l: Layer) => Layer; onEditText?: (id: string, lines: TextLine[], first: boolean) => void;
} = {}) {
  const layers = lolevLayers();
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
      onEditCancel: noop, onDrag: snap, onDragCancel: noop, onResize: snap, onEditSession: noop,
      cornerRadiusPct: 0, zoom: 1, bleedIn: 0,
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
