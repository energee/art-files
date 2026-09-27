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

const listeners: EventListener[] = [];

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  for (const seen of listeners.splice(0)) document.body.removeEventListener("click", seen);
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
      '[aria-label^="Vertical manual guide;"]')!;
    act(() => {
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    });
    expect(props.onRemoveManual).toHaveBeenCalledWith(7);
  });

  it("hides every manual guide, handle and × when Guides is off", () => {
    renderRulers({ showGuides: false });
    expect(container.querySelector('[aria-label*="manual guide;"]')).toBeNull();
    expect(removeButton("vertical")).toBeNull();
    expect(removeButton("horizontal")).toBeNull();
  });
});

it("arrows move the focused guide and do not reach layer shortcuts (#301)", () => {
  const props = renderRulers();
  const guide = container.querySelector<HTMLElement>('[aria-label^="Vertical manual guide"]')!;
  const event = new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true, cancelable: true });
  act(() => guide.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(props.onMoveManual).toHaveBeenCalledWith(7, 110);
});

// Rulers does not deselect itself: a click on ruler chrome is meant to reach
// the pane, whose pasteboard handler treats it as a miss (App.tsx's
// missedEverything). So these assert on what ESCAPES the overlay — `escaped`
// counts clicks arriving at the container, standing in for that handler.
describe("Rulers background click — what reaches the pasteboard", () => {
  /** The strip that drags out a horizontal guide, with pointer capture
   *  stubbed (happy-dom has none) and its own click counter attached. */
  function strip() {
    const el = container.querySelector<HTMLDivElement>(
      '[title="Drag down to create a horizontal guide"]')!;
    el.setPointerCapture = vi.fn();
    return el;
  }
  const cornerButton = () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Ruler settings, current unit in"]')!;
  /** Clicks that bubble out of the overlay — what the pane would deselect on.
   *  Watched from ABOVE the React root: React's own listener sits on the root
   *  container, and stopPropagation there still lets sibling listeners on that
   *  same element run, so a counter attached to it would never see a swallow. */
  function escapes() {
    const seen = vi.fn();
    document.body.addEventListener("click", seen);
    listeners.push(seen);
    return seen;
  }
  const click = (el: Element) =>
    act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

  it("lets a plain click on the corner through", () => {
    renderRulers();
    const escaped = escapes();
    click(cornerButton());
    expect(escaped).toHaveBeenCalledTimes(1);
  });

  it("lets a plain click on a guide strip (no drag) through", () => {
    const props = renderRulers();
    const escaped = escapes();
    const el = strip();
    act(() => {
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientY: 5 }));
      el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1, clientY: 5 }));
    });
    click(el);
    expect(props.onAddManual).not.toHaveBeenCalled();
    expect(escaped).toHaveBeenCalledTimes(1);
  });

  it("swallows the click that tails a guide drag, and only that one", () => {
    const props = renderRulers();
    const escaped = escapes();
    const el = strip();
    // Each pointer event needs its own act(): endDrag reads `drag` from the
    // last committed render, so without a flush between them it still sees
    // null and never places the guide.
    // clientX must clear RULER_SIZE too — overRuler treats EITHER axis being
    // inside the ruler thickness as "still over the ruler", and the default
    // clientX of 0 would otherwise read as the vertical ruler.
    act(() => {
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 50, clientY: 5 }));
    });
    act(() => {
      el.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 50, clientY: 200 }));
    });
    act(() => {
      el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1, clientX: 50, clientY: 200 }));
    });
    expect(props.onAddManual).toHaveBeenCalledTimes(1);
    // setPointerCapture re-targets the browser's own click back to the strip
    // that started the drag — simulated here the same way.
    click(el);
    expect(escaped).not.toHaveBeenCalled();
    // and placing that guide didn't leave the strip stuck swallowing clicks.
    click(el);
    expect(escaped).toHaveBeenCalledTimes(1);
  });
});

// Guides off hides every guide, so a guide added then would be invisible yet
// still snap layers: the settings' Add buttons follow the same switch.
it("disables Add guide while Guides is off", async () => {
  renderRulers({ showGuides: false });
  const corner = container.querySelector<HTMLButtonElement>('[aria-label="Ruler settings, current unit in"]')!;
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
      corner.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    corner.click();
  });
  const add = Array.from(document.querySelectorAll("button"))
    .find((b) => b.textContent === "Add vertical guide") as HTMLButtonElement;
  expect(add).toBeDefined();
  expect(add.disabled).toBe(true);
});

// A new guide pulled onto the page and dropped back into the ruler is a
// cancelled drag, not a click on the ruler: it must not reach the pasteboard.
it("swallows the click after a new guide is dragged back into the ruler", () => {
  renderRulers();
  const seen = vi.fn();
  document.body.addEventListener("click", seen);
  listeners.push(seen);
  const el = container.querySelector<HTMLDivElement>('[title="Drag down to create a horizontal guide"]')!;
  el.setPointerCapture = vi.fn();
  const fire = (type: string, clientY: number) => act(() => {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: 50, clientY }));
  });
  fire("pointerdown", 5);
  fire("pointermove", 200);
  fire("pointermove", 5);
  fire("pointerup", 5);
  act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(seen).not.toHaveBeenCalled();
});
