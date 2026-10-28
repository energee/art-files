// preview-empty-text-dom.test.tsx — the in-place editor on the real
// PreviewCompare with empty text (#116). happy-dom has no 2D context; the
// paint effect's error path swallows that.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PreviewCompare } from "../src/components/PreviewCompare";
import type { CanvasRenderSource } from "../src/canvas/draw";
import type { TextLayer } from "../src/model/layers";
import * as L from "../src/layout";
import { measure } from "./fixtures";

const GOLD = { fill: "#F3CD80", layer: "metallic" } as const;
const layer = (text: string): TextLayer => ({
  kind: "text", id: "t", name: "Title", enabled: true, anchor: "left", align: "left",
  x: 100, y: 50, size: 10, style: GOLD, lines: [{ text, ...GOLD }],
});
const source: CanvasRenderSource = {
  m: measure,
  planAssets: { logoSvg: "" }, drawAssets: {}, skip: new Set(), fontCss: "sans-serif",
};

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

function render(text: string) {
  act(() => {
    root.render(createElement(PreviewCompare, {
      canvasRender: source, layers: [layer(text)], editLayerOf: (l) => l, selected: [],
      onPick: vi.fn(), onEditText: vi.fn(), onEditUppercase: vi.fn(), onEditCommit: vi.fn(),
      onDrag: vi.fn(), onDragCancel: vi.fn(), onResize: vi.fn(), onEditSession: vi.fn(),
      cornerRadiusPct: 0, zoom: 1, bleedIn: L.SHIPPED_BLEED_IN, unit: "in",
    }));
  });
}

/** Double-click just right of and below the layer's anchor point (x, y) —
 *  inside its text box when it has text, inside the minimum box when not.
 *  happy-dom lays nothing out, so the sheet's rect is stubbed at 1px/pt. */
function dblclickNearAnchor() {
  const sheet = container.querySelector('[data-slot="label-sheet"]') as HTMLDivElement;
  sheet.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, width: L.PAGE.w, height: L.PAGE.h,
    right: L.PAGE.w, bottom: L.PAGE.h, toJSON: () => ({}),
  }) as DOMRect;
  act(() => {
    sheet.dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true, clientX: 100 + L.BLEED_SHIFT + 2, clientY: 50 + L.BLEED_SHIFT + 5,
    }));
  });
}
const editor = () => document.querySelector('[aria-label="Edit title text"]');

it("keeps the in-place editor mounted when its text is deleted mid-session", () => {
  render("AB");
  dblclickNearAnchor();
  expect(editor()).not.toBeNull();
  render(""); // App's onEditText round-trip after ⌘A, Delete
  expect(editor()).not.toBeNull();
});

it("opens the in-place editor on a fresh, empty text layer", () => {
  render("");
  dblclickNearAnchor();
  expect(editor()).not.toBeNull();
});

it("moves the comparison divider with the keyboard and bounds it (#307)", () => {
  render("AB");
  const divider = container.querySelector('[role="separator"]')!;
  for (const [key, shiftKey, expected] of [["ArrowRight", false, "1"], ["ArrowRight", true, "11"], ["End", false, "100"], ["ArrowRight", false, "100"], ["Home", false, "0"]] as const) {
    const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
    act(() => divider.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(divider.getAttribute("aria-valuenow")).toBe(expected);
  }
});
