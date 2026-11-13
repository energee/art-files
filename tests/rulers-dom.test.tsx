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
import { PAGE } from "../src/layout";
import { DEFAULT_MARGIN_PT, pointToScreen, type ManualGuide } from "../src/rulers";
import { DEFAULT_RENDER } from "../src/settings";

// A spy on what every render of Rulers calls per guide, so a test can count
// those renders; the behaviour is the real one.
vi.mock("../src/rulers", async (original) => {
  const actual = await original<typeof import("../src/rulers")>();
  return { ...actual, pointToScreen: vi.fn(actual.pointToScreen) };
});

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

const FITTED = { z: 1, x: 0, y: 0 };

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
    current: {
      showArt() {}, showMask() {}, getPageElement: () => page,
      layerGestureArmed: () => false, cancelLayerGesture() {},
    },
  };
  const props: Parameters<typeof Rulers>[0] = {
    paneRef: { current: pane }, previewRef, view: { get: () => FITTED, subscribe: () => () => {} },
    showRulers: true, unit: "in", onUnitChange: vi.fn(),
    showGuides: true, marginPt: DEFAULT_MARGIN_PT, onMarginChange: vi.fn(),
    manual: MANUAL, onAddManual: vi.fn(), onMoveManual: vi.fn(), onRemoveManual: vi.fn(),
    bleedIn: DEFAULT_RENDER.bleedIn, dpi: DEFAULT_RENDER.dpi,
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

// #424: the guide × is revealed by focus-within as well as hover, so a tap
// that selects a guide (touch has no hover) has to leave its handle focused.
it("focuses a guide's handle when it is pressed, revealing its ×", () => {
  renderRulers();
  const handle = container.querySelector<HTMLDivElement>('[aria-label^="Vertical manual guide;"]')!;
  handle.setPointerCapture = vi.fn();
  const fire = (type: string) => act(() => {
    handle.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: 100, clientY: 200 }));
  });
  fire("pointerdown");
  fire("pointerup");
  expect(document.activeElement).toBe(handle);
  const remove = removeButton("vertical")!;
  expect(remove.parentElement!.contains(handle)).toBe(true);
  expect(remove.className).toContain("group-focus-within:opacity-100");
  expect(remove.className).toContain("group-focus-within:pointer-events-auto");
});

// The master margin inset stays locked until explicitly unlocked.
it("locks the master margin inset until it is unlocked", async () => {
  const props = renderRulers();
  const corner = container.querySelector<HTMLButtonElement>('[aria-label="Ruler settings, current unit in"]')!;
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
      corner.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    corner.click();
  });
  const margin = document.querySelector<HTMLInputElement>("#guide-margin")!;
  expect(margin.disabled).toBe(true);

  await act(async () => {
    margin.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  });
  expect(props.onMarginChange).not.toHaveBeenCalled();
  const lock = document.querySelector<HTMLButtonElement>('button[aria-label="Margin inset: locked"]')!;
  expect(lock.getAttribute("aria-pressed")).toBe("true");
  await act(async () => { lock.click(); });
  expect(lock.getAttribute("aria-pressed")).toBe("false");
  const unlocked = document.querySelector<HTMLInputElement>("#guide-margin")!;
  expect(unlocked.disabled).toBe(false);
  await act(async () => {
    unlocked.focus();
    unlocked.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  });
  expect(props.onMarginChange).toHaveBeenCalled();
});

it("relocks the margin inset each time the settings reopen", async () => {
  renderRulers();
  const corner = container.querySelector<HTMLButtonElement>('[aria-label="Ruler settings, current unit in"]')!;
  const toggle = () => act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
      corner.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    corner.click();
  });
  await toggle();
  await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="Margin inset: locked"]')!.click(); });
  expect(document.querySelector<HTMLInputElement>("#guide-margin")!.disabled).toBe(false);
  await toggle(); // close
  await vi.waitFor(() => expect(document.querySelector("#guide-margin")).toBeNull());
  await toggle(); // reopen
  expect(document.querySelector<HTMLInputElement>("#guide-margin")!.disabled).toBe(true);
});

// The corner's picker is the app's one unit choice: four units, Millimetres
// among them, and the margin inset reads in whichever is chosen.
it("offers inches, millimetres, points and pixels, and reads the margin in the chosen unit", async () => {
  const props = renderRulers({ unit: "mm" });
  const corner = container.querySelector<HTMLButtonElement>('[aria-label="Ruler settings, current unit mm"]')!;
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
      corner.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    corner.click();
  });
  const units = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Units"] button')];
  expect(units.map((b) => b.textContent)).toEqual(["Inches", "Millimetres", "Points", "Pixels"]);
  expect(units[1].getAttribute("aria-pressed")).toBe("true");
  // 24.12pt is 8.509mm.
  expect(document.querySelector<HTMLInputElement>("#guide-margin")!.value).toBe("8.5");
  await act(async () => { units[3].click(); });
  expect(props.onUnitChange).toHaveBeenLastCalledWith("px");
});

/** The view transform on a bordered pane: the page's rect follows the live
 *  view like the browser's, and every rect read and listener add is counted.
 *  `base` is the page's box in the transform's own space. */
function transformedPane() {
  let current = FITTED;
  const listeners = new Set<() => void>();
  const view = {
    get: () => current,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next: typeof FITTED) { current = next; for (const l of listeners) l(); },
  };
  const BORDER = 1, PANE_LEFT = 200, PANE_TOP = 40;
  const base = { left: 30, top: 20, width: 600, height: 400 };
  const counts = { rects: 0, adds: 0 };
  const pane = document.createElement("div");
  Object.defineProperty(pane, "clientLeft", { value: BORDER });
  pane.getBoundingClientRect = () => {
    counts.rects++;
    return { ...rect(800, 500), left: PANE_LEFT, top: PANE_TOP };
  };
  const add = pane.addEventListener.bind(pane);
  pane.addEventListener = ((...args: Parameters<typeof add>) => { counts.adds++; add(...args); }) as typeof add;
  const page = document.createElement("div");
  page.getBoundingClientRect = () => {
    counts.rects++;
    const { z, x, y } = current;
    return {
      ...rect(base.width * z, base.height * z),
      left: PANE_LEFT + BORDER + x + z * base.left, top: PANE_TOP + y + z * base.top,
    };
  };
  container.appendChild(pane);
  const previewRef = { current: {
    showArt() {}, showMask() {}, getPageElement: () => page,
    layerGestureArmed: () => false, cancelLayerGesture() {},
  } };
  /** Where a guide must sit for the view, straight from the browser's rect. */
  const expectedLeft = (point: number) => {
    const p = page.getBoundingClientRect();
    return pointToScreen(point, p.left - PANE_LEFT, p.width, PAGE.w);
  };
  return { view, base, counts, previewRef, paneRef: { current: pane }, expectedLeft };
}

const guideLeft = () =>
  parseFloat(container.querySelector<HTMLElement>('.group[style*="left"]')!.style.left);

describe("Rulers follow the live view", () => {
  it("reads no rects and adds no listeners per zoom or pan (#727)", () => {
    const { view, counts, paneRef, previewRef } = transformedPane();
    renderRulers({ view, paneRef, previewRef });
    counts.rects = 0;
    counts.adds = 0;
    for (let i = 1; i <= 5; i++) act(() => { view.set({ z: 1 + i / 10, x: -i, y: -i }); });
    expect(counts).toEqual({ rects: 0, adds: 0 });
  });

  it("places a guide where the browser puts the page, border included", () => {
    const { view, paneRef, previewRef, expectedLeft } = transformedPane();
    renderRulers({ view, paneRef, previewRef });
    act(() => { view.set({ z: 2.3, x: -417, y: -96 }); });
    expect(guideLeft()).toBeCloseTo(expectedLeft(100), 4);
  });

  it("takes the view back out of a measure made while zoomed", () => {
    const observed: ResizeObserverCallback[] = [];
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { observed.push(callback); }
      observe() {} disconnect() {}
    });
    const { view, base, paneRef, previewRef, expectedLeft } = transformedPane();
    renderRulers({ view, paneRef, previewRef });
    act(() => { view.set({ z: 2, x: -300, y: -100 }); });
    base.width = 500;
    base.left = 80;
    act(() => { observed[0]([], {} as ResizeObserver); });
    expect(guideLeft()).toBeCloseTo(expectedLeft(100), 4);
    act(() => { view.set({ z: 1.5, x: -60, y: -20 }); });
    expect(guideLeft()).toBeCloseTo(expectedLeft(100), 4);
  });

  it("re-measures when the rulers toggle, which shifts a page at its size cap", () => {
    const { view, base, paneRef, previewRef, expectedLeft } = transformedPane();
    const props = renderRulers({ view, paneRef, previewRef });
    base.left = 42;
    act(() => { root.render(createElement(Rulers, { ...props, showRulers: false })); });
    expect(guideLeft()).toBeCloseTo(expectedLeft(100), 4);
  });
});

describe("Rulers cursor markers", () => {
  const markers = () => [...container.querySelectorAll("path.fill-primary")].map((m) => m.getAttribute("d"));
  const move = (pane: HTMLElement, clientX: number, clientY: number) => act(() => {
    pane.dispatchEvent(new PointerEvent("pointermove", { clientX, clientY }));
  });

  it("follow the pointer without rendering the rulers (#728)", () => {
    const pane = renderRulers().paneRef.current!;
    vi.mocked(pointToScreen).mockClear();
    for (let i = 1; i <= 5; i++) move(pane, 100 + i, 200 + i);
    expect(pointToScreen).not.toHaveBeenCalled();
    expect(markers()).toEqual(["M 102 0 h 6 l -3 5 z", "M 0 202 v 6 l 5 -3 z"]);
  });

  it("hide over the rulers and when the pointer leaves the pane", () => {
    const pane = renderRulers().paneRef.current!;
    move(pane, 100, 200);
    expect(markers()).toHaveLength(2);
    move(pane, 5, 200);
    expect(markers()).toHaveLength(0);
    move(pane, 100, 200);
    act(() => { pane.dispatchEvent(new PointerEvent("pointerleave")); });
    expect(markers()).toHaveLength(0);
  });
});
