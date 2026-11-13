// touch-gestures-dom.test.tsx — fingers on the REAL PreviewCompare inside the
// real editor pane (src/useZoomPan.ts with src/components/PreviewCompare.tsx):
// the layer drag and the resize take only the first finger of a touch, a
// second finger turns a drag into a pinch and puts the layer back, a cancelled
// touch reverts like Escape, and no click-swallow outlives the next press.
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
