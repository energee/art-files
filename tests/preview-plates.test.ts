// preview-plates.test.ts — the hidden mask plate is not repainted while the
// split divider fully clips it, and is painted once the divider reveals it
// (issue #395). The mounted case pins the paint effect's wiring, not just the
// platesToPaint helper.
// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PreviewCompare, platesToPaint, type PreviewCompareHandle } from "../src/components/PreviewCompare";
import { drawPlate, type CanvasRenderSource } from "../src/canvas/draw";
import type { TextLayer } from "../src/model/layers";
import * as L from "../src/layout";
import { measure } from "./fixtures";

vi.mock("../src/canvas/draw", async (orig) => ({
  ...(await orig<typeof import("../src/canvas/draw")>()),
  drawPlate: vi.fn(),
}));

it("skips the mask plate while hidden and paints it once revealed", () => {
  expect(platesToPaint(false)).toEqual(["art"]);
  expect(platesToPaint(true)).toEqual(["art", "mask"]);
});

const GOLD = { fill: "#F3CD80", layer: "metallic" } as const;
const layer: TextLayer = {
  kind: "text", id: "t", name: "Title", enabled: true, anchor: "left", align: "left",
  x: 100, y: 50, size: 10, style: GOLD, lines: [{ text: "AB", ...GOLD }],
};
const source: CanvasRenderSource = {
  m: measure, planAssets: { logoSvg: "" }, drawAssets: {}, skip: new Set(), fontCss: "sans-serif",
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

const frame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
const paintedModes = () => vi.mocked(drawPlate).mock.calls.map((c) => c[3]);

it("the mounted preview paints only the art plate until the divider reveals the mask", async () => {
  const ref = createRef<PreviewCompareHandle>();
  act(() => {
    root.render(createElement(PreviewCompare, {
      ref, canvasRender: source, layers: [layer], editLayerOf: (l) => l, selected: [],
      onPick: vi.fn(), onEditText: vi.fn(), onEditUppercase: vi.fn(), onEditCancel: vi.fn(),
      onDrag: () => ({ x: null, y: null, dx: 0, dy: 0 }), onDragCancel: vi.fn(), onResize: vi.fn(),
      onEditSession: vi.fn(), cornerRadiusPct: 0, zoom: 1, bleedIn: L.SHIPPED_BLEED_IN,
    }));
  });
  await frame();
  expect(paintedModes()).toEqual(["art"]);

  vi.mocked(drawPlate).mockClear();
  act(() => { ref.current!.showMask(); });
  await frame();
  expect(paintedModes()).toEqual(["art", "mask"]);
});
