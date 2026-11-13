// touch-gestures-dom.test.tsx — fingers on the REAL PreviewCompare inside the
// real editor pane (src/useZoomPan.ts with src/components/PreviewCompare.tsx):
// the layer drag and the resize take only the first finger of a touch, a
// second finger turns a drag into a pinch and puts the layer back, a cancelled
// touch reverts like Escape, no click-swallow outlives the next press, and a
// finger on a tick moves the layer from inside its box and resizes it from
// outside (a mouse always resizes), and two taps on a text layer within
// 300ms edit it in place (src/components/touchPress.ts).
// Layer geometry and Undo are read off the real document and history.
// happy-dom has no pointer capture, so each finger's later events are sent to
// the element it landed on, as capture would.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { PAGE } from "../src/layout";
import type { Command } from "../src/components/CommandMenu";
import type { Layer } from "../src/model/layers";
import { boxOfLayer } from "./fixtures";

type PreviewProps = import("react").ComponentProps<typeof import("../src/components/PreviewCompare").PreviewCompare>;
const probe = vi.hoisted(() => ({ preview: null as PreviewProps | null, actions: [] as Command[] }));
// The real PreviewCompare, wrapped only to read the props App hands it.
vi.mock("../src/components/PreviewCompare", async (original) => {
  const real = await original<typeof import("../src/components/PreviewCompare")>();
  const { createElement: h } = await import("react");
  return { ...real, PreviewCompare: (props: PreviewProps) => { probe.preview = props; return h(real.PreviewCompare, props); } };
});
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/components/AppMenu", () => ({
  AppMenu: (props: { actions: Command[] }) => { probe.actions = props.actions; return null; },
}));
vi.mock("../src/fonts", async (original) => ({
  ...await original<typeof import("../src/fonts")>(),
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
import { DocumentEditor } from "../src/App";

const PANE = { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 } as DOMRect;
const W = 800;
const H = (W * PAGE.h) / PAGE.w;
const SHEET = { x: 0, y: 0, left: 0, top: 0, right: W, bottom: H, width: W, height: H, toJSON: () => ({}) } as DOMRect;
/** A pane point below the sheet: bare pasteboard. */
const BOARD_Y = (H + 600) / 2;

let unmount = async () => {};
let pane: HTMLElement;
let sheet: HTMLElement;
let zoomLayer: HTMLElement;
const capture = Element.prototype.setPointerCapture;
beforeEach(async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.setPointerCapture = () => {};
  down.clear(); primary = null;
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(DocumentEditor, {
      active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
      saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
      onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
      onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
    }));
  });
  unmount = async () => { await act(async () => { root.unmount(); }); container.remove(); };
  await vi.waitFor(() => expect(probe.preview?.canvasRender).toBeTruthy(), { timeout: 30_000 });
  pane = container.querySelector<HTMLElement>("[data-export-status]")!.parentElement!;
  pane.getBoundingClientRect = () => PANE;
  sheet = pane.querySelector<HTMLElement>('[data-slot="label-sheet"]')!;
  sheet.getBoundingClientRect = () => SHEET;
  zoomLayer = pane.querySelector<HTMLElement>('[style*="transform-origin"]')!;
}, 60_000);
afterEach(async () => {
  vi.restoreAllMocks();
  Element.prototype.setPointerCapture = capture;
  vi.unstubAllGlobals();
  await unmount();
});

// Fingers: the first one down in a touch set is the primary, as in a browser.
const down = new Set<number>();
let primary: number | null = null;
const finger = (el: Element, type: string, id: number, clientX: number, clientY: number) => act(() => {
  if (type === "pointerdown" && !down.size) primary = id;
  if (type === "pointerdown") down.add(id);
  el.dispatchEvent(new PointerEvent(type, {
    pointerType: "touch", pointerId: id, isPrimary: id === primary, button: 0, clientX, clientY, bubbles: true,
  }));
  if (type === "pointerup" || type === "pointercancel") down.delete(id);
});
const tap = (el: Element, id: number, x: number, y: number) => {
  finger(el, "pointerdown", id, x, y);
  finger(el, "pointerup", id, x, y);
  act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y })); });
};
const run = (id: string) => act(() => { probe.actions.find((c) => c.id === id)!.run(); });
const canUndo = () => !probe.actions.find((c) => c.id === "undo")!.disabled;
const layer = (id: string): Layer => probe.preview!.layers.find((l) => l.id === id)!;
const layers = () => probe.preview!.layers;
/** A layer's centre in client px on the stubbed sheet. */
const centre = (id: string) => {
  const { m, planAssets } = probe.preview!.canvasRender!;
  const b = boxOfLayer(id, layers(), m, planAssets)!;
  return { x: ((b.x + b.w / 2) / PAGE.w) * W, y: ((b.y + b.h / 2) / PAGE.h) * H };
};
const select = (id: string) => act(() => { probe.preview!.onPick(id, {}); });
const tick = (key: string) => pane.querySelector<HTMLElement>(`[data-resize-handle="${key}"]`)!;
const scale = () => Number(/scale\(([\d.]+)\)/.exec(zoomLayer.style.transform)![1]);

it("a second finger on another unlocked layer puts the first finger's drag back and pinches", async () => {
  const before = structuredClone(layers());
  const a = centre("name"), b = centre("description");
  finger(sheet, "pointerdown", 1, a.x, a.y);
  finger(sheet, "pointermove", 1, a.x + 30, a.y);
  expect(layer("name")).not.toEqual(before.find((l) => l.id === "name"));
  expect(canUndo()).toBe(true);
  finger(sheet, "pointerdown", 2, b.x, b.y);
  expect(layers()).toEqual(before);
  expect(canUndo()).toBe(false);
  // Spread them apart along the line between them: twice the distance.
  const b1 = { x: b.x + (b.x - a.x) / 2, y: b.y + (b.y - a.y) / 2 };
  const a1 = { x: a.x - (b.x - a.x) / 2, y: a.y - (b.y - a.y) / 2 };
  finger(sheet, "pointermove", 2, b1.x, b1.y);
  finger(sheet, "pointermove", 1, a1.x, a1.y);
  expect(scale()).toBeGreaterThan(1);
  finger(sheet, "pointerup", 2, b1.x, b1.y);
  finger(sheet, "pointerup", 1, a1.x, a1.y);
  expect(layers()).toEqual(before);
  expect(canUndo()).toBe(false);
}, 60_000);

it("the cancel leaves Undo as it was before the drag", async () => {
  const d = centre("description");
  finger(sheet, "pointerdown", 1, d.x, d.y);
  finger(sheet, "pointermove", 1, d.x + 20, d.y);
  finger(sheet, "pointerup", 1, d.x + 20, d.y);
  const moved = structuredClone(layers());
  const a = centre("name");
  finger(sheet, "pointerdown", 1, a.x, a.y);
  finger(sheet, "pointermove", 1, a.x + 30, a.y);
  finger(pane, "pointerdown", 2, 600, BOARD_Y);
  expect(layers()).toEqual(moved);
  finger(pane, "pointerup", 2, 600, BOARD_Y);
  finger(sheet, "pointerup", 1, a.x + 30, a.y);
  run("undo");
  expect(canUndo()).toBe(false);
}, 60_000);

it("a finger resizing from a tick ignores fingers on a layer and on another tick", async () => {
  select("description");
  const start = structuredClone(layer("description"));
  const others = structuredClone(layers().filter((l) => l.id !== "description"));
  const t = tick("1,1"), other = tick("-1,-1"), n = centre("name");
  finger(t, "pointerdown", 1, 100, 100);
  finger(t, "pointermove", 1, 120, 110);
  const resized = structuredClone(layer("description"));
  expect(resized).not.toEqual(start);
  finger(sheet, "pointerdown", 2, n.x, n.y);
  finger(other, "pointerdown", 3, 50, 50);
  finger(sheet, "pointermove", 2, n.x + 40, n.y);
  finger(other, "pointermove", 3, 10, 10);
  finger(sheet, "pointerup", 2, n.x + 40, n.y);
  finger(other, "pointerup", 3, 10, 10);
  expect(scale()).toBe(1);
  finger(t, "pointermove", 1, 120, 110);
  finger(t, "pointerup", 1, 120, 110);
  expect(layer("description")).toEqual(resized);
  expect(layers().filter((l) => l.id !== "description")).toEqual(others);
  run("undo");
  expect(layer("description")).toEqual(start);
  expect(canUndo()).toBe(false);
}, 60_000);

it("two fingers on the pasteboard leave a resize alone", async () => {
  select("description");
  const t = tick("1,1");
  finger(t, "pointerdown", 1, 100, 100);
  finger(t, "pointermove", 1, 120, 110);
  const resized = structuredClone(layer("description"));
  finger(pane, "pointerdown", 2, 300, BOARD_Y);
  finger(pane, "pointerdown", 3, 500, BOARD_Y);
  finger(pane, "pointermove", 2, 200, BOARD_Y);
  finger(pane, "pointermove", 3, 600, BOARD_Y);
  expect(scale()).toBe(1);
  expect(layer("description")).toEqual(resized);
  finger(pane, "pointerup", 2, 200, BOARD_Y);
  finger(pane, "pointerup", 3, 600, BOARD_Y);
  finger(t, "pointerup", 1, 120, 110);
  expect(layer("description")).toEqual(resized);
}, 60_000);

it("a third finger on a layer during a pinch moves no layer", async () => {
  const before = structuredClone(layers());
  finger(pane, "pointerdown", 1, 300, BOARD_Y);
  finger(pane, "pointerdown", 2, 500, BOARD_Y);
  finger(pane, "pointermove", 1, 200, BOARD_Y);
  const n = centre("name");
  finger(sheet, "pointerdown", 3, n.x, n.y);
  finger(sheet, "pointermove", 3, n.x + 40, n.y + 10);
  finger(sheet, "pointerup", 3, n.x + 40, n.y + 10);
  expect(layers()).toEqual(before);
  expect(canUndo()).toBe(false);
}, 60_000);

it("a tick pressed during in-place editing leaves no finger behind: one finger still pans", async () => {
  select("description");
  const d = centre("description");
  act(() => { sheet.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: d.x, clientY: d.y })); });
  expect(pane.querySelector('[contenteditable="true"]')).not.toBeNull();
  const t = tick("1,1");
  finger(t, "pointerdown", 1, 100, 100);
  finger(t, "pointerup", 1, 100, 100);
  run("zoom-in"); run("zoom-in");
  finger(pane, "pointerdown", 2, 400, BOARD_Y);
  finger(pane, "pointermove", 2, 380, BOARD_Y - 10);
  expect(zoomLayer.style.transform).toBe("translate(-245px, -178.75px) scale(1.5625)");
}, 60_000);

it("after a finger pan, a tap on a tick is not swallowed", async () => {
  select("description");
  run("zoom-in"); run("zoom-in");
  finger(pane, "pointerdown", 1, 400, BOARD_Y);
  finger(pane, "pointermove", 1, 380, BOARD_Y);
  finger(pane, "pointerup", 1, 380, BOARD_Y); // Chrome sends no click after a moved touch
  const t = tick("1,1");
  const reached = vi.fn();
  t.addEventListener("click", reached);
  tap(t, 2, 100, 100);
  expect(reached).toHaveBeenCalledTimes(1);
}, 60_000);

it("after a finger drag of a layer, a tap on another layer picks it", async () => {
  const a = centre("name");
  finger(sheet, "pointerdown", 1, a.x, a.y);
  finger(sheet, "pointermove", 1, a.x + 30, a.y);
  finger(sheet, "pointerup", 1, a.x + 30, a.y); // no click follows a moved touch
  const d = centre("description");
  tap(sheet, 2, d.x, d.y);
  expect(probe.preview!.selected).toEqual(["description"]);
}, 60_000);

it("a tap on a layer after a pan picks it", async () => {
  run("zoom-in"); run("zoom-in");
  finger(pane, "pointerdown", 1, 400, BOARD_Y);
  finger(pane, "pointermove", 1, 380, BOARD_Y);
  finger(pane, "pointerup", 1, 380, BOARD_Y);
  const n = centre("name");
  tap(sheet, 2, n.x, n.y);
  expect(probe.preview!.selected).toEqual(["name"]);
}, 60_000);

it("one finger on a locked layer pans", async () => {
  run("zoom-in"); run("zoom-in");
  expect(layer("warning").locked).toBe(true);
  const w = centre("warning");
  const before = structuredClone(layers());
  finger(sheet, "pointerdown", 1, w.x, w.y);
  finger(sheet, "pointermove", 1, w.x - 20, w.y - 10);
  expect(zoomLayer.style.transform).toBe("translate(-245px, -178.75px) scale(1.5625)");
  expect(layers()).toEqual(before);
}, 60_000);

it.each(["touch", "mouse"])("a cancelled %s drag puts the layer back and leaves no undo step", async (pointerType) => {
  const before = structuredClone(layers());
  const a = centre("name");
  const fire = (type: string, x: number) => act(() => {
    sheet.dispatchEvent(new PointerEvent(type, { pointerType, pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: a.y, bubbles: true }));
  });
  fire("pointerdown", a.x);
  fire("pointermove", a.x + 30);
  expect(canUndo()).toBe(true);
  fire("pointercancel", a.x + 30);
  expect(layers()).toEqual(before);
  expect(canUndo()).toBe(false);
}, 60_000);

it("a cancelled resize puts the layer back and leaves no undo step", async () => {
  select("description");
  const start = structuredClone(layer("description"));
  const t = tick("1,1");
  finger(t, "pointerdown", 1, 100, 100);
  finger(t, "pointermove", 1, 120, 110);
  expect(layer("description")).not.toEqual(start);
  finger(t, "pointercancel", 1, 120, 110);
  expect(layer("description")).toEqual(start);
  expect(canUndo()).toBe(false);
}, 60_000);

/** A layer's box in label points, off the live document. */
const box = (id: string) => {
  const { m, planAssets } = probe.preview!.canvasRender!;
  return boxOfLayer(id, layers(), m, planAssets)!;
};

it("a finger the browser aims at a tick but that lands inside the layer moves it", async () => {
  select("name");
  const start = box("name"), { x, y } = centre("name");
  const t = tick("1,0");
  finger(t, "pointerdown", 1, x, y);
  finger(t, "pointermove", 1, x + 20, y);
  finger(t, "pointerup", 1, x + 20, y);
  const moved = box("name");
  expect(moved.x).toBeGreaterThan(start.x);
  expect(moved.w).toBeCloseTo(start.w);
  expect(moved.h).toBeCloseTo(start.h);
  // The lift ended the move: a stray later move goes nowhere.
  finger(sheet, "pointermove", 1, x + 60, y);
  expect(box("name")).toEqual(moved);
}, 60_000);

it("a finger on a tick outside every layer resizes it", async () => {
  select("name");
  const start = box("name"), { x, y } = pastNameCorner();
  const t = tick("1,1");
  finger(t, "pointerdown", 1, x, y);
  finger(t, "pointermove", 1, x + 20, y + 10);
  finger(t, "pointerup", 1, x + 20, y + 10);
  expect(box("name").w).toBeGreaterThan(start.w);
}, 60_000);

it("a mouse on a tick resizes as before, wherever on the tick it lands", async () => {
  select("name");
  const start = box("name"), { x, y } = centre("name");
  const t = tick("1,0");
  const mouse = (type: string, cx: number) => act(() => {
    t.dispatchEvent(new PointerEvent(type, { pointerType: "mouse", pointerId: 1, isPrimary: true, button: 0, clientX: cx, clientY: y, bubbles: true }));
  });
  mouse("pointerdown", x);
  mouse("pointermove", x + 20);
  mouse("pointerup", x + 20);
  expect(box("name").w).toBeGreaterThan(start.w);
  expect(box("name").x).toBeCloseTo(start.x);
}, 60_000);

// The browser aims a finger near the selection at its tick, but the finger is
// on another layer: that layer is what it moves and picks. With capture on
// the sheet the moves and lift arrive there; Chrome still sends the tap's
// click to the tick (measured), as a touch PointerEvent.
const touchClick = (el: Element, x: number, y: number) => act(() => {
  el.dispatchEvent(new PointerEvent("click", { pointerType: "touch", bubbles: true, clientX: x, clientY: y }));
});
it("a finger aimed at the selection's tick but on another layer moves that layer", async () => {
  select("name");
  const name = box("name"), start = box("description"), d = centre("description");
  finger(tick("1,1"), "pointerdown", 1, d.x, d.y);
  finger(sheet, "pointermove", 1, d.x + 20, d.y);
  finger(sheet, "pointerup", 1, d.x + 20, d.y);
  expect(box("description").x).toBeGreaterThan(start.x);
  expect(box("description").w).toBeCloseTo(start.w);
  expect(box("name")).toEqual(name);
}, 60_000);

it("a tap aimed at the selection's tick but on another layer picks that layer", async () => {
  select("name");
  const d = centre("description");
  finger(tick("1,1"), "pointerdown", 1, d.x, d.y);
  finger(sheet, "pointerup", 1, d.x, d.y);
  touchClick(tick("1,1"), d.x, d.y);
  expect(probe.preview!.selected).toEqual(["description"]);
}, 60_000);

it("a tap aimed at a tick but inside its own layer keeps that layer picked", async () => {
  select("name");
  act(() => { probe.preview!.onPick("description", { shift: true, toggle: false }); });
  const n = centre("name");
  finger(tick("1,1"), "pointerdown", 1, n.x, n.y);
  finger(sheet, "pointerup", 1, n.x, n.y);
  touchClick(tick("1,1"), n.x, n.y);
  expect(probe.preview!.selected).toEqual(["name"]);
}, 60_000);

it("in a multi-selection, a finger on one selected layer in another's tick reach moves the group", async () => {
  select("name");
  act(() => { probe.preview!.onPick("description", { shift: true, toggle: false }); });
  const name = box("name"), desc = box("description"), d = centre("description");
  const nameTick = pane.querySelectorAll('[data-resize-handle="1,1"]')[0];
  finger(nameTick, "pointerdown", 1, d.x, d.y);
  finger(sheet, "pointermove", 1, d.x + 20, d.y);
  finger(sheet, "pointerup", 1, d.x + 20, d.y);
  expect(box("name").x).toBeGreaterThan(name.x);
  expect(box("description").x).toBeGreaterThan(desc.x);
  expect(box("name").w).toBeCloseTo(name.w);
}, 60_000);

/** A point just outside `name`'s bottom-right corner, on bare stock. */
const pastNameCorner = () => {
  const b = box("name");
  const p = { x: ((b.x + b.w) / PAGE.w) * W + 6, y: ((b.y + b.h) / PAGE.h) * H + 6 };
  const { m, planAssets } = probe.preview!.canvasRender!;
  const covered = layers().some((l) => {
    const o = boxOfLayer(l.id, layers(), m, planAssets);
    return o && p.x >= (o.x / PAGE.w) * W && p.x <= ((o.x + o.w) / PAGE.w) * W && p.y >= (o.y / PAGE.h) * H && p.y <= ((o.y + o.h) / PAGE.h) * H;
  });
  expect(covered).toBe(false);
  return p;
};

it("an extra finger resting on the label and cancelled by the OS leaves a resize alone", async () => {
  select("name");
  const start = box("name"), { x, y } = pastNameCorner(), n = centre("description");
  finger(tick("1,1"), "pointerdown", 1, x, y);
  finger(tick("1,1"), "pointermove", 1, x + 20, y + 10);
  const resized = box("name");
  expect(resized.w).toBeGreaterThan(start.w);
  finger(sheet, "pointerdown", 2, n.x, n.y);
  finger(sheet, "pointercancel", 2, n.x, n.y);
  expect(box("name")).toEqual(resized);
  expect(canUndo()).toBe(true);
}, 60_000);

it("an extra finger lifting mid-resize keeps the size readout up", async () => {
  select("name");
  const { x, y } = pastNameCorner(), n = centre("description");
  finger(tick("1,1"), "pointerdown", 1, x, y);
  finger(tick("1,1"), "pointermove", 1, x + 20, y + 10);
  expect(sheet.textContent).toMatch(/W .*H /);
  finger(sheet, "pointerdown", 2, n.x, n.y);
  finger(sheet, "pointerup", 2, n.x, n.y);
  expect(sheet.textContent).toMatch(/W .*H /);
}, 60_000);

it("a pen on the pasteboard behaves as the mouse does", async () => {
  run("zoom-in"); run("zoom-in");
  const pen = (type: string, button: number, x: number, y: number) => act(() => {
    pane.dispatchEvent(new PointerEvent(type, { pointerType: "pen", pointerId: 5, isPrimary: true, button, clientX: x, clientY: y, bubbles: true }));
  });
  pen("pointerdown", 0, 400, BOARD_Y);
  pen("pointermove", 0, 350, BOARD_Y - 50);
  pen("pointerup", 0, 350, BOARD_Y - 50);
  expect(zoomLayer.style.transform).toBe("translate(-225px, -168.75px) scale(1.5625)");
  pen("pointerdown", 2, 400, BOARD_Y);
  pen("pointermove", 2, 350, BOARD_Y - 50);
  pen("pointerup", 2, 350, BOARD_Y - 50);
  expect(zoomLayer.style.transform).toBe("translate(-275px, -218.75px) scale(1.5625)");
}, 60_000);

// Double-tap to edit in place: the detector reads each finger's lift and its
// event timeStamp (stamped `at` by the test), not the browser's click/dblclick.
// A `drift` moves the finger that far before it lifts.
const tapAt = (id: string, at: number, on: Element = sheet, pointerType = "touch", drift = 0) => {
  const { x, y } = centre(id);
  const fire = (type: string, dx = 0) => act(() => {
    const e = new PointerEvent(type, { pointerType, pointerId: 1, isPrimary: true, button: 0, clientX: x + dx, clientY: y, bubbles: true });
    Object.defineProperty(e, "timeStamp", { value: at });
    on.dispatchEvent(e);
  });
  fire("pointerdown");
  if (drift) fire("pointermove", drift);
  fire("pointerup", drift);
  act(() => { on.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y })); });
};
const editorOf = (name: string) => pane.querySelector(`[aria-label="Edit ${name} text"]`);
const dblclickAt = (id: string) => {
  const { x, y } = centre(id);
  act(() => { sheet.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: x, clientY: y })); });
};
const anyEditor = () => pane.querySelector('[aria-label^="Edit "][aria-label$=" text"]');

it("two taps on a text layer within 300ms edit it in place, and the first tap selects", async () => {
  tapAt("name", 1000);
  expect(probe.preview!.selected).toEqual(["name"]);
  expect(anyEditor()).toBeNull();
  tapAt("name", 1300);
  expect(editorOf(layer("name").name.toLowerCase())).not.toBeNull();
}, 60_000);

it("a finger lifting up to 10px from where it landed still taps", async () => {
  tapAt("name", 1000, sheet, "touch", 10); tapAt("name", 1300, sheet, "touch", 10);
  expect(editorOf(layer("name").name.toLowerCase())).not.toBeNull();
}, 60_000);

it("a finger lifting 11px from where it landed is no tap", async () => {
  tapAt("name", 1000, sheet, "touch", 11); tapAt("name", 1300, sheet, "touch", 11);
  expect(anyEditor()).toBeNull();
}, 60_000);

it("taps 301ms apart, or on two layers, do not", async () => {
  tapAt("name", 1000); tapAt("name", 1301);
  expect(anyEditor()).toBeNull();
  tapAt("description", 2000); tapAt("name", 2100);
  expect(anyEditor()).toBeNull();
}, 60_000);

it("two mouse clicks do not; a double-click still does", async () => {
  tapAt("name", 1000, sheet, "mouse"); tapAt("name", 1100, sheet, "mouse");
  expect(anyEditor()).toBeNull();
  dblclickAt("name");
  expect(editorOf(layer("name").name.toLowerCase())).not.toBeNull();
}, 60_000);

it("a double-tap the browser aims at a tick of the selected layer still opens it", async () => {
  select("name");
  tapAt("name", 1000, tick("1,0")); tapAt("name", 1200, tick("1,0"));
  expect(editorOf(layer("name").name.toLowerCase())).not.toBeNull();
}, 60_000);

it("a locked text layer opens as its double-click does", async () => {
  expect(layer("warning").locked).toBe(true);
  tapAt("warning", 1000); tapAt("warning", 1200);
  expect(editorOf(layer("warning").name.toLowerCase())).not.toBeNull();
}, 60_000);

// A non-text or hidden layer: tests/preview-touch-dom.test.tsx, where the
// fixture's image and QR layers draw a box.
it("a double-tap on the pasteboard opens nothing", async () => {
  const board = () => { finger(pane, "pointerdown", 1, 400, BOARD_Y); finger(pane, "pointerup", 1, 400, BOARD_Y); };
  board(); board();
  expect(anyEditor()).toBeNull();
}, 60_000);

it("a tap then a drag on the same layer opens nothing", async () => {
  tapAt("name", 1000);
  const { x, y } = centre("name");
  finger(sheet, "pointerdown", 1, x, y);
  finger(sheet, "pointermove", 1, x + 20, y);
  finger(sheet, "pointermove", 1, x, y);
  finger(sheet, "pointerup", 1, x, y);
  expect(anyEditor()).toBeNull();
}, 60_000);

it("a tap joined by a second finger is no tap", async () => {
  tapAt("warning", 1000);
  const { x, y } = centre("warning");
  finger(sheet, "pointerdown", 1, x, y);
  finger(pane, "pointerdown", 2, 400, BOARD_Y);
  finger(sheet, "pointerdown", 3, x, y);
  finger(pane, "pointerup", 2, 400, BOARD_Y);
  finger(sheet, "pointerup", 3, x, y);
  finger(sheet, "pointerup", 1, x, y);
  expect(anyEditor()).toBeNull();
}, 60_000);

it("a dblclick after a double-tap opened a session leaves it where it is", async () => {
  tapAt("name", 1000); tapAt("name", 1200);
  dblclickAt("description");
  expect(editorOf(layer("name").name.toLowerCase())).not.toBeNull();
  expect(editorOf(layer("description").name.toLowerCase())).toBeNull();
}, 60_000);

it("taps inside an open session never reopen it", async () => {
  tapAt("name", 1000); tapAt("name", 1200);
  const field = editorOf(layer("name").name.toLowerCase())!;
  tapAt("name", 1300, field); tapAt("name", 1400, field);
  expect(editorOf(layer("name").name.toLowerCase())).toBe(field);
}, 60_000);

it("the mousedowns Chrome sends after the opening tap are default-prevented, in the field too: focus stays, no word gets selected", async () => {
  tapAt("warning", 1000); tapAt("warning", 1200);
  const field = editorOf(layer("warning").name.toLowerCase())!;
  expect(document.activeElement).toBe(field);
  const mousedown = (el: Element) => {
    const e = new MouseEvent("mousedown", { bubbles: true, cancelable: true, detail: 2 });
    act(() => { el.dispatchEvent(e); });
    return e.defaultPrevented;
  };
  expect(mousedown(sheet.querySelector("canvas")!)).toBe(true);
  expect(document.activeElement).toBe(field);
  // The double-tap's own second mousedown lands in the field: a native
  // double-click there would select the word under it.
  expect(mousedown(field)).toBe(true);
  // A later, deliberate press in the field selects as the platform does.
  const { x, y } = centre("warning");
  finger(field, "pointerdown", 1, x, y);
  expect(mousedown(field)).toBe(false);
  finger(field, "pointerup", 1, x, y);
}, 60_000);

it("a mouse press on another layer during a double-click session closes it, selects that layer, and keeps its mousedown", async () => {
  dblclickAt("name");
  expect(editorOf(layer("name").name.toLowerCase())).not.toBeNull();
  const { x, y } = centre("description");
  const mouse = (type: string) => act(() => {
    sheet.dispatchEvent(new PointerEvent(type, { pointerType: "mouse", pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, bubbles: true }));
  });
  mouse("pointerdown");
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: x, clientY: y });
  act(() => { sheet.querySelector("canvas")!.dispatchEvent(down); });
  expect(down.defaultPrevented).toBe(false);
  mouse("pointerup");
  act(() => { sheet.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y })); });
  expect(anyEditor()).toBeNull();
  expect(probe.preview!.selected).toEqual(["description"]);
}, 60_000);

it("a pinch with a thumb on a layer and a finger on the pasteboard is no tap", async () => {
  const { x, y } = centre("warning");
  finger(sheet, "pointerdown", 1, x, y);
  finger(pane, "pointerdown", 2, 400, BOARD_Y);
  finger(pane, "pointerup", 2, 400, BOARD_Y);
  finger(sheet, "pointerup", 1, x, y);
  tapAt("warning", performance.now() + 100);
  expect(anyEditor()).toBeNull();
}, 60_000);

it("a pan that wanders past the slop and comes back is no tap", async () => {
  run("zoom-in"); run("zoom-in");
  const { x, y } = centre("warning");
  finger(sheet, "pointerdown", 1, x, y);
  finger(sheet, "pointermove", 1, x + 30, y);
  finger(sheet, "pointermove", 1, x, y);
  finger(sheet, "pointerup", 1, x, y);
  tapAt("warning", performance.now() + 100);
  expect(anyEditor()).toBeNull();
}, 60_000);

it("a finger that moves 6px on an unlocked layer moves nothing and is a tap", async () => {
  const before = structuredClone(layers());
  tapAt("name", 1000, sheet, "touch", 6);
  expect(layers()).toEqual(before);
  expect(canUndo()).toBe(false);
  tapAt("name", 1200, sheet, "touch", 6);
  expect(editorOf(layer("name").name.toLowerCase())).not.toBeNull();
}, 60_000);

it("a finger that moves 14px drags the layer from where it pressed", async () => {
  const start = box("name"), { x, y } = centre("name");
  finger(sheet, "pointerdown", 1, x, y);
  finger(sheet, "pointermove", 1, x + 8, y);
  expect(box("name")).toEqual(start);
  finger(sheet, "pointermove", 1, x + 14, y);
  finger(sheet, "pointerup", 1, x + 14, y);
  // The whole 14px from the press point, in label points (no snap there).
  expect(box("name").x - start.x).toBeCloseTo((14 / W) * PAGE.w, 1);
  expect(canUndo()).toBe(true);
}, 60_000);

it("a mouse that moves 6px still drags, as before", async () => {
  const start = box("name"), { x, y } = centre("name");
  const mouse = (type: string, cx: number) => act(() => {
    sheet.dispatchEvent(new PointerEvent(type, { pointerType: "mouse", pointerId: 1, isPrimary: true, button: 0, clientX: cx, clientY: y, bubbles: true }));
  });
  mouse("pointerdown", x); mouse("pointermove", x + 6); mouse("pointerup", x + 6);
  expect(box("name").x).toBeGreaterThan(start.x);
  expect(canUndo()).toBe(true);
}, 60_000);

// A tap picks the layer under the finger's lift. Chrome aims the follow-up
// click at a nearby tick (here Name's bottom one), whose position can lie
// over another layer (here styleLine): that click must not pick again.
const touchClickAt = (el: Element, x: number, y: number) => act(() => {
  el.dispatchEvent(new PointerEvent("click", { pointerType: "touch", bubbles: true, clientX: x, clientY: y }));
});

it("a tap whose click Chrome aims at a tick over another layer selects the layer under the finger", async () => {
  select("name");
  const a = centre("name"), b = centre("styleLine");
  finger(sheet, "pointerdown", 1, a.x, a.y);
  finger(sheet, "pointerup", 1, a.x, a.y);
  touchClickAt(tick("0,1"), b.x, b.y);
  expect(probe.preview!.selected).toEqual(["name"]);
}, 60_000);

it("after such a double-tap the layer under the finger is both edited and selected", async () => {
  select("name");
  const a = centre("name"), b = centre("styleLine");
  for (const at of [1000, 1200]) {
    for (const type of ["pointerdown", "pointerup"]) act(() => {
      const e = new PointerEvent(type, { pointerType: "touch", pointerId: 1, isPrimary: true, button: 0, clientX: a.x, clientY: a.y, bubbles: true });
      Object.defineProperty(e, "timeStamp", { value: at });
      sheet.dispatchEvent(e);
    });
    const t = tick("0,1");
    if (t) touchClickAt(t, b.x, b.y);
  }
  expect(editorOf(layer("name").name.toLowerCase())).not.toBeNull();
  expect(probe.preview!.selected).toEqual(["name"]);
}, 60_000);

it("a tap on bare sheet deselects", async () => {
  select("name");
  finger(sheet, "pointerdown", 1, 1, 1);
  finger(sheet, "pointerup", 1, 1, 1);
  touchClickAt(sheet, 1, 1);
  expect(probe.preview!.selected).toEqual([]);
}, 60_000);

it("a mouse click still picks from the click's own position", async () => {
  const a = centre("name"), b = centre("description");
  const mouse = (type: string) => act(() => {
    sheet.dispatchEvent(new PointerEvent(type, { pointerType: "mouse", pointerId: 1, isPrimary: true, button: 0, clientX: a.x, clientY: a.y, bubbles: true }));
  });
  mouse("pointerdown"); mouse("pointerup");
  act(() => { sheet.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: b.x, clientY: b.y })); });
  expect(probe.preview!.selected).toEqual(["description"]);
}, 60_000);

// Two fingers on or around a small selected layer pinch; a resize owns its
// gesture only once it has travelled past the tap slop.
it("two fingers on a selected layer's side ticks, inside its box, pinch", async () => {
  select("description");
  const before = structuredClone(layers()), { x, y } = centre("description");
  finger(tick("-1,0"), "pointerdown", 1, x - 3, y);
  finger(tick("1,0"), "pointerdown", 2, x + 3, y);
  finger(tick("-1,0"), "pointermove", 1, x - 40, y);
  finger(tick("1,0"), "pointermove", 2, x + 40, y);
  expect(scale()).toBeGreaterThan(1);
  finger(tick("-1,0"), "pointerup", 1, x - 40, y);
  finger(tick("1,0"), "pointerup", 2, x + 40, y);
  expect(layers()).toEqual(before);
  expect(canUndo()).toBe(false);
}, 60_000);

it("a second finger before a tick resize passes the slop turns it into a pinch", async () => {
  select("description");
  const before = structuredClone(layers()), t = tick("1,1");
  finger(t, "pointerdown", 1, 100, 100);
  finger(t, "pointermove", 1, 106, 100);
  expect(layers()).toEqual(before); // a finger resizes nothing within the slop
  finger(pane, "pointerdown", 2, 400, BOARD_Y);
  finger(t, "pointermove", 1, 60, 100);
  finger(pane, "pointermove", 2, 500, BOARD_Y);
  expect(scale()).toBeGreaterThan(1);
  finger(pane, "pointerup", 2, 500, BOARD_Y);
  finger(t, "pointerup", 1, 60, 100);
  expect(layers()).toEqual(before);
  expect(canUndo()).toBe(false);
}, 60_000);

// The tap counter owns touch: Chrome's own dblclick, sent up to its own slop
// and double-click time, never opens the editor after a touch press.
it("a browser dblclick after taps the counter rejects opens nothing; a mouse dblclick still opens", async () => {
  tapAt("name", 1000, sheet, "touch", 11); tapAt("name", 1200, sheet, "touch", 11);
  dblclickAt("name");
  expect(anyEditor()).toBeNull();
  tapAt("description", 2000); tapAt("description", 2400);
  dblclickAt("description");
  expect(anyEditor()).toBeNull();
  tapAt("name", 3000, sheet, "mouse");
  dblclickAt("name");
  expect(editorOf(layer("name").name.toLowerCase())).not.toBeNull();
}, 60_000);

it("a group move handed from a tick's reach keeps the multi-selection when Chrome's click lands on the tick", async () => {
  select("name");
  act(() => { probe.preview!.onPick("styleLine", { shift: true }); });
  expect([...probe.preview!.selected].sort()).toEqual(["name", "styleLine"]);
  const { x, y } = centre("name"), t = tick("1,0");
  finger(t, "pointerdown", 1, x, y);
  finger(t, "pointermove", 1, x + 12, y);
  finger(t, "pointerup", 1, x + 12, y);
  touchClickAt(tick("1,0") ?? t, x + 12, y);
  expect([...probe.preview!.selected].sort()).toEqual(["name", "styleLine"]);
}, 60_000);

it("a second finger that taps beside a resting one moves no view, swallows nothing, and a tap after selects", async () => {
  const before = zoomLayer.style.transform;
  finger(pane, "pointerdown", 1, 400, BOARD_Y);
  finger(pane, "pointerdown", 2, 402, BOARD_Y);
  finger(pane, "pointermove", 2, 404, BOARD_Y);
  finger(pane, "pointerup", 2, 404, BOARD_Y);
  expect(zoomLayer.style.transform).toBe(before);
  finger(pane, "pointerup", 1, 400, BOARD_Y);
  const n = centre("name");
  tap(sheet, 3, n.x, n.y);
  expect(probe.preview!.selected).toEqual(["name"]);
}, 60_000);

it("a pinch starts once a finger passes the slop, from the fingers' positions then", async () => {
  finger(pane, "pointerdown", 1, 300, BOARD_Y);
  finger(pane, "pointerdown", 2, 400, BOARD_Y);
  finger(pane, "pointermove", 2, 405, BOARD_Y);
  expect(scale()).toBe(1);
  finger(pane, "pointermove", 2, 412, BOARD_Y); // past the slop: the pinch starts here
  expect(scale()).toBe(1);
  finger(pane, "pointermove", 2, 430, BOARD_Y);
  expect(scale()).toBeCloseTo(130 / 112, 6);
  finger(pane, "pointerup", 2, 430, BOARD_Y);
  finger(pane, "pointerup", 1, 300, BOARD_Y);
}, 60_000);

it("a finger resizes nothing until it has travelled past the 10px slop", async () => {
  select("description");
  const start = structuredClone(layer("description")), t = tick("1,1");
  finger(t, "pointerdown", 1, 100, 100);
  finger(t, "pointermove", 1, 106, 100);
  expect(layer("description")).toEqual(start);
  expect(canUndo()).toBe(false);
  finger(t, "pointermove", 1, 112, 100);
  expect(layer("description")).not.toEqual(start);
  finger(t, "pointerup", 1, 112, 100);
}, 60_000);

it("a tap on a handle between two taps on a layer breaks the double-tap", async () => {
  tapAt("name", 1000);
  const { x, y } = pastNameCorner();
  finger(tick("1,1"), "pointerdown", 1, x, y);
  finger(tick("1,1"), "pointerup", 1, x, y);
  tapAt("name", 1200);
  expect(anyEditor()).toBeNull();
}, 60_000);

// On touch only our own tap picks (at the lift): the click Chrome sends after
// a press the tap rules rejected selects nothing and deselects nothing.
it.each([["a locked layer", () => centre("warning")], ["bare sheet", () => ({ x: 1, y: 1 })]])(
  "a finger press on %s that drifts 12px then gets a click leaves the selection alone", async (_, at) => {
    select("name");
    const { x, y } = at();
    finger(sheet, "pointerdown", 1, x, y);
    finger(sheet, "pointermove", 1, x + 12, y);
    finger(sheet, "pointerup", 1, x + 12, y);
    act(() => { sheet.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x + 12, clientY: y })); });
    expect(probe.preview!.selected).toEqual(["name"]);
  }, 60_000);

it("a mouse click still picks a layer and still deselects on bare sheet", async () => {
  const mouseClick = (x: number, y: number) => act(() => {
    for (const type of ["pointerdown", "pointerup"]) {
      sheet.dispatchEvent(new PointerEvent(type, { pointerType: "mouse", pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, bubbles: true }));
    }
    sheet.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
  });
  const w = centre("warning");
  mouseClick(w.x, w.y);
  expect(probe.preview!.selected).toEqual(["warning"]);
  mouseClick(1, 1);
  expect(probe.preview!.selected).toEqual([]);
}, 60_000);
