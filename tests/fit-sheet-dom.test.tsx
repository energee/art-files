// tests/fit-sheet-dom.test.tsx — 100% shows the whole label: the 2D sheet fits
// the pane's width and height (phone layout, Phase 3), and the 3D framing
// reads the same rule.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PreviewCompare } from "../src/components/PreviewCompare";
import { fitSheetWidth, PAGE, PREVIEW_MAX_W } from "../src/layout";

it.each([
  [1003, 688, 900],  // desktop 1280x800, fresh: the 900px cap
  [703, 688, 703],   // desktop, layer selected: the width
  [390, 2000, 390],  // a tall pane: the width
])("a %ix%i pane fits a sheet %i wide", (w, h, expected) => {
  expect(fitSheetWidth(w, h)).toBe(expected);
});

it("a short pane fits the label's height", () => {
  expect(fitSheetWidth(299, 163)).toBe(163 * PAGE.w / PAGE.h);
  expect(fitSheetWidth(299, 163)).toBeCloseTo(258.38, 2);
});

it("the sheet states the same rule in CSS, against its container's height", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(createElement(PreviewCompare, {
      canvasRender: null, layers: [], editLayerOf: (l) => l, selected: [], onPick: vi.fn(),
      onEditText: vi.fn(), onEditUppercase: vi.fn(), onEditCommit: vi.fn(),
      onDrag: () => ({ x: null, y: null, dx: 0, dy: 0 }), onDragCancel: vi.fn(), onResize: vi.fn(),
      onEditSession: vi.fn(), cornerRadiusPct: 0, zoom: 1, bleedIn: 0, unit: "in",
    }));
  });
  const sheet = container.querySelector<HTMLElement>('[data-slot="label-sheet"]')!;
  expect(sheet.style.maxWidth).toBe(`min(${PREVIEW_MAX_W}px, ${(100 * PAGE.w) / PAGE.h}cqh)`);
  act(() => { root.unmount(); });
  vi.unstubAllGlobals();
});
