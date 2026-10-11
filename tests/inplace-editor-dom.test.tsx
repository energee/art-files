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

/** Mount the preview and double-click the centre of one text layer's box. */
function openEditor(id: string) {
  const layers = lolevLayers();
  const planAssets = { logoSvg };
  const source: CanvasRenderSource = {
    m: measure, planAssets, drawAssets: {} as CanvasRenderSource["drawAssets"], skip: new Set<string>(), fontCss: "Test",
  };
  const noop = () => {};
  const snap = () => ({ x: null, y: null, dx: 0, dy: 0 });
  act(() => {
    root.render(createElement(PreviewCompare, {
      canvasRender: source, layers, editLayerOf: (l) => l, selected: [], onPick: noop, onEditText: noop, onEditUppercase: noop,
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
