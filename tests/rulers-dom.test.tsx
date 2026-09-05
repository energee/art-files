// rulers-dom.test.tsx — DOM behavior of Rulers (src/components/Rulers.tsx):
// a manual guide's × in the ruler removes that guide, and the one Guides
// switch hides every manual guide (handle and × alike) at once. No
// @testing-library/react in this repo — mounted through react-dom/client +
// act, matching tests/layerspanel-dom.test.tsx's convention (see its header).
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Rulers } from "../src/components/Rulers";
import type { PreviewCompareHandle } from "../src/components/PreviewCompare";
import { DEFAULT_MARGIN_PT, type ManualGuide } from "../src/rulers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // Rulers re-measures through a ResizeObserver happy-dom does not provide.
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

/** happy-dom lays nothing out, so the pane and page rects are stubbed —
 *  the overlay only needs them non-zero to place itself. */
const rect = (width: number, height: number): DOMRect => ({
  x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height,
  toJSON: () => ({}),
}) as DOMRect;

const MANUAL: ManualGuide[] = [
  { id: 7, axis: "x", point: 100 },
  { id: 8, axis: "y", point: 60 },
];

function renderRulers(over: Partial<Parameters<typeof Rulers>[0]> = {}) {
  const pane = document.createElement("div");
  pane.getBoundingClientRect = () => rect(800, 500);
  const page = document.createElement("div");
  page.getBoundingClientRect = () => rect(800, 500);
  container.appendChild(pane);
  const previewRef: { current: PreviewCompareHandle } = {
    current: { showArt() {}, showMask() {}, getPageElement: () => page },
  };
  const props: Parameters<typeof Rulers>[0] = {
    paneRef: { current: pane }, previewRef, transform: { z: 1, x: 0, y: 0 },
    showRulers: true, unit: "in", onUnitChange: vi.fn(),
    showGuides: true, marginPt: DEFAULT_MARGIN_PT, onMarginChange: vi.fn(),
    manual: MANUAL, onAddManual: vi.fn(), onMoveManual: vi.fn(), onRemoveManual: vi.fn(),
    ...over,
  };
  act(() => { root.render(createElement(Rulers, props)); });
  return props;
}

const removeButton = (kind: "vertical" | "horizontal") =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="Remove ${kind} manual guide"]`);

describe("Rulers manual-guide removal", () => {
  it("offers an × per manual guide that removes exactly that guide", () => {
    const props = renderRulers();
    const vertical = removeButton("vertical");
    const horizontal = removeButton("horizontal");
    expect(vertical).not.toBeNull();
    expect(horizontal).not.toBeNull();
    act(() => { vertical!.click(); });
    expect(props.onRemoveManual).toHaveBeenCalledWith(7);
    act(() => { horizontal!.click(); });
    expect(props.onRemoveManual).toHaveBeenLastCalledWith(8);
    expect(props.onRemoveManual).toHaveBeenCalledTimes(2);
  });

  it("keeps the handle's Delete key as a second way to remove", () => {
    const props = renderRulers();
    const handle = container.querySelector<HTMLDivElement>(
      '[aria-label="Vertical manual guide; press Delete to remove"]')!;
    act(() => {
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    });
    expect(props.onRemoveManual).toHaveBeenCalledWith(7);
  });

  it("hides every manual guide, handle and × when Guides is off", () => {
    renderRulers({ showGuides: false });
    expect(container.querySelector('[aria-label$="manual guide; press Delete to remove"]')).toBeNull();
    expect(removeButton("vertical")).toBeNull();
    expect(removeButton("horizontal")).toBeNull();
  });
});
