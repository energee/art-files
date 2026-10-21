// preview-pointercancel-dom.test.tsx — a drag the OS cancels (pointercancel:
// a palm-rejected touch, a system gesture) fires no click, so it must not arm
// the swallow a finished drag's click needs — else the next tap is eaten.
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

it("a cancelled drag leaves the next tap to select", () => {
  const onPick = vi.fn();
  act(() => {
    root.render(createElement(PreviewCompare, {
      canvasRender: source, layers: [layer], editLayerOf: (l) => l, selected: [],
      onPick, onEditText: vi.fn(), onEditUppercase: vi.fn(), onEditCancel: vi.fn(),
      onDrag: () => ({ x: null, y: null, dx: 0, dy: 0 }), onDragCancel: vi.fn(), onResize: vi.fn(),
      onEditSession: vi.fn(), cornerRadiusPct: 0, zoom: 1, bleedIn: L.SHIPPED_BLEED_IN,
    }));
  });
  const sheet = container.querySelector('[data-slot="label-sheet"]') as HTMLDivElement;
  sheet.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, width: L.PAGE.w, height: L.PAGE.h,
    right: L.PAGE.w, bottom: L.PAGE.h, toJSON: () => ({}),
  }) as DOMRect;
  sheet.setPointerCapture = () => {};
  const at = { clientX: 100 + L.BLEED_SHIFT + 2, clientY: 50 + L.BLEED_SHIFT + 5 };
  const fire = (type: string, dx = 0) => act(() => {
    sheet.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, ...at, clientX: at.clientX + dx }));
  });
  fire("pointerdown");
  fire("pointermove", 20);
  fire("pointercancel", 20);
  act(() => { sheet.dispatchEvent(new MouseEvent("click", { bubbles: true, ...at })); });
  expect(onPick).toHaveBeenCalledWith("t", expect.anything());
});

// The divider's grip is inset by its own width at each end, so the sheet's
// overflow clip never cuts it in half at 0% or 100% (UX audit item 3).
it("keeps the divider grip inside the sheet at both ends", () => {
  const props = {
    canvasRender: source, layers: [layer], editLayerOf: (l: TextLayer) => l, selected: [],
    onPick: vi.fn(), onEditText: vi.fn(), onEditUppercase: vi.fn(), onEditCancel: vi.fn(),
    onDrag: () => ({ x: null, y: null, dx: 0, dy: 0 }), onDragCancel: vi.fn(), onResize: vi.fn(),
    onEditSession: vi.fn(), cornerRadiusPct: 0, zoom: 1, bleedIn: L.SHIPPED_BLEED_IN,
  };
  const handle = { current: null as null | { showMask: () => void } };
  act(() => { root.render(createElement(PreviewCompare, { ...props, ref: handle } as never)); });
  const grip = () => container.querySelector("[data-divider-grip]") as HTMLElement;
  expect(grip().style.transform).toBe("translate(-0%, -50%)");
  act(() => { handle.current!.showMask(); });
  expect(grip().style.transform).toBe("translate(-100%, -50%)");
});
