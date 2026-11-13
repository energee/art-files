// preview-touch-dom.test.tsx — PreviewCompare's handle for the pane's finger
// gestures (src/useZoomPan.ts): whether a press on a layer or tick is down,
// and cancelling it exactly as Escape does, so a second finger can turn a
// layer drag into a pinch without leaving an undo step. Mounted like
// tests/inplace-editor-dom.test.tsx.
// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import { PreviewCompare, type PreviewCompareHandle } from "../src/components/PreviewCompare";
import type { CanvasRenderSource } from "../src/canvas/draw";
import { PAGE } from "../src/layout";
import type { Layer } from "../src/model/layers";
import { boxOfLayer, lolevLayers, measure, planAssets } from "./fixtures";

const W = 800;
const H = (W * PAGE.h) / PAGE.w;
const rect = { x: 0, y: 0, left: 0, top: 0, right: W, bottom: H, width: W, height: H, toJSON: () => ({}) } as DOMRect;
const ALL = lolevLayers();

let container: HTMLDivElement;
let root: Root;
let sheet: HTMLDivElement;
let handle: { current: PreviewCompareHandle | null };
let onDrag: Mock;
let onDragCancel: Mock;

function mount({ layers = ALL, selected = [] }: { layers?: Layer[]; selected?: string[] } = {}) {
  const source: CanvasRenderSource = {
    m: measure, planAssets, drawAssets: {} as CanvasRenderSource["drawAssets"], skip: new Set<string>(), fontCss: "Test",
  };
  const noop = () => {};
  act(() => {
    root.render(createElement(PreviewCompare, {
      canvasRender: source, layers, editLayerOf: (l: Layer) => l, selected, onPick: noop,
      onEditText: noop, onEditUppercase: noop, onEditCommit: noop,
      onDrag, onDragCancel, onResize: vi.fn(() => ({ x: null, y: null, dx: 0, dy: 0 })), onEditSession: noop,
      cornerRadiusPct: 0, zoom: 1, bleedIn: 0, unit: "in", ref: handle,
    } as Parameters<typeof PreviewCompare>[0]));
  });
  sheet = container.querySelector<HTMLDivElement>('[data-slot="label-sheet"]')!;
  sheet.getBoundingClientRect = () => rect;
  sheet.setPointerCapture = () => {};
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  handle = createRef<PreviewCompareHandle>();
  onDrag = vi.fn(() => ({ x: null, y: null, dx: 0, dy: 0 }));
  onDragCancel = vi.fn();
  mount();
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

const centre = (id: string) => {
  const b = boxOfLayer(id, ALL, measure, planAssets)!;
  return { x: ((b.x + b.w / 2) / PAGE.w) * W, y: ((b.y + b.h / 2) / PAGE.h) * H };
};
const fire = (el: Element, type: string, x: number, y: number, pointerType = "touch") => act(() => {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, pointerType, clientX: x, clientY: y }));
});

it("arms on a finger on an unlocked layer, not on bare stock, and disarms on lift", () => {
  const { x, y } = centre("name");
  fire(sheet, "pointerdown", x, y);
  expect(handle.current!.layerGestureArmed()).toBe(true);
  fire(sheet, "pointerup", x, y);
  expect(handle.current!.layerGestureArmed()).toBe(false);
  fire(sheet, "pointerdown", 1, 1);
  expect(handle.current!.layerGestureArmed()).toBe(false);
});

it("cancelLayerGesture undoes a drag that moved, once, and stops it", () => {
  const { x, y } = centre("name");
  fire(sheet, "pointerdown", x, y);
  fire(sheet, "pointermove", x + 20, y);
  expect(onDrag).toHaveBeenCalledTimes(1);
  act(() => handle.current!.cancelLayerGesture());
  expect(onDragCancel).toHaveBeenCalledTimes(1);
  fire(sheet, "pointermove", x + 40, y);
  expect(onDrag).toHaveBeenCalledTimes(1);
  expect(handle.current!.layerGestureArmed()).toBe(false);
});

it("cancelling a press that never moved undoes nothing", () => {
  const { x, y } = centre("name");
  fire(sheet, "pointerdown", x, y);
  act(() => handle.current!.cancelLayerGesture());
  expect(onDragCancel).not.toHaveBeenCalled();
  expect(handle.current!.layerGestureArmed()).toBe(false);
});

it("Escape mid-drag still undoes it (the shared path)", () => {
  const { x, y } = centre("name");
  fire(sheet, "pointerdown", x, y, "mouse");
  fire(sheet, "pointermove", x + 20, y, "mouse");
  act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  expect(onDragCancel).toHaveBeenCalledTimes(1);
});
