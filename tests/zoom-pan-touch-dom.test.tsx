// zoom-pan-touch-dom.test.tsx — fingers on the preview pane (src/useZoomPan.ts):
// one pans, two pinch about their midpoint, a third is ignored, and a finger
// the layer drag took does not pan until a second one's pinch cancels the drag. The
// view changes outside React like the wheel's, publishes the zoom when a
// finger lifts, never adds an undo step, and a gesture that moved the view
// swallows its trailing click. Mounted like tests/zoom-pan-render-dom.test.tsx,
// with a PreviewCompare stand-in that exposes the handle the pane asks.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import type { Command } from "../src/components/CommandMenu";
import type { PreviewCompareHandle } from "../src/components/PreviewCompare";
import type { LiveView } from "../src/useZoomPan";

type PreviewProps = import("react").ComponentProps<typeof import("../src/components/PreviewCompare").PreviewCompare>;
const probe = vi.hoisted(() => ({
  renders: 0, preview: null as PreviewProps | null, actions: [] as Command[], view: null as LiveView | null,
  armed: false, cancel: null as null | (() => void),
}));
vi.mock("../src/components/PreviewCompare", async () => {
  const { useImperativeHandle } = await import("react");
  return {
    SNAP_PT: 6,
    PreviewCompare: (props: PreviewProps & { ref?: import("react").Ref<PreviewCompareHandle> }) => {
      useImperativeHandle(props.ref, () => ({
        showArt() {}, showMask() {}, getPageElement: () => null,
        layerGestureArmed: () => probe.armed, cancelLayerGesture: () => probe.cancel!(), endTap() {}, resizeFinger: () => null,
      }));
      probe.renders++; probe.preview = props; return null;
    },
  };
});
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({
  Rulers: (props: { view: LiveView }) => { probe.view = props.view; return null; },
}));
vi.mock("../src/components/AppMenu", () => ({
  AppMenu: (props: { actions: Command[] }) => { probe.actions = props.actions; return null; },
}));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
import { DocumentEditor } from "../src/App";

const PANE = { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 } as DOMRect;

let unmount = async () => {};
beforeEach(() => {
  down.clear(); primary = null;
  probe.armed = false;
  probe.cancel = vi.fn(() => { probe.armed = false; });
});
afterEach(async () => { vi.useRealTimers(); await unmount(); });

async function mountEditor() {
  const container = document.createElement("div");
  document.body.appendChild(container);
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
  const pane = container.querySelector<HTMLElement>("[data-export-status]")!.parentElement!;
  pane.getBoundingClientRect = () => PANE;
  pane.setPointerCapture = () => {};
  const layer = pane.querySelector<HTMLElement>('[style*="transform-origin"]')!;
  const field = container.querySelector<HTMLInputElement>('input[aria-label="Zoom percentage"]')!;
  vi.useFakeTimers();
  return { pane, layer, field };
}

const run = (id: string) => act(() => { probe.actions.find((c) => c.id === id)!.run(); });
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
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const viewOf = (layer: HTMLElement) => {
  const m = /translate\((\S+)px, (\S+)px\) scale\((\S+)\)/.exec(layer.style.transform)!;
  return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
};
const pick = (id: string) => act(() => { probe.preview!.onPick(id, {}); });
const undoDisabled = () => probe.actions.find((c) => c.id === "undo")!.disabled;
/** Fitted → 2x: fingers 11 and 12 spread from 200 to 400 apart about (400, 300).
 *  Finger 11 lands 11px off and its first move, out of the tap slop, starts
 *  the pinch without moving the view. */
function pinchTo2x(pane: HTMLElement) {
  finger(pane, "pointerdown", 11, 311, 300);
  finger(pane, "pointerdown", 12, 500, 300);
  finger(pane, "pointermove", 11, 300, 300);
  finger(pane, "pointermove", 11, 200, 300);
  finger(pane, "pointermove", 12, 600, 300);
}

it("asks the browser for no scrolling or zooming of its own", async () => {
  const { pane } = await mountEditor();
  expect(pane.className).toContain("touch-none");
});

it("one finger on the pasteboard pans, without rendering the editor", async () => {
  const { pane, layer } = await mountEditor();
  run("zoom-in"); run("zoom-in");
  const before = probe.renders;
  finger(pane, "pointerdown", 11, 400, 300);
  finger(pane, "pointermove", 11, 380, 290);
  finger(pane, "pointermove", 11, 370, 280);
  expect(probe.renders - before).toBe(0);
  finger(pane, "pointerup", 11, 370, 280);
  expect(viewOf(layer)).toEqual({ z: 1.5625, x: -255, y: -188.75 });
});

it("two fingers pinch about their midpoint and publish the zoom when one lifts", async () => {
  const { pane, layer, field } = await mountEditor();
  const before = probe.renders;
  pinchTo2x(pane);
  expect(probe.renders - before).toBe(0);
  const v = viewOf(layer);
  expect(v.z).toBeCloseTo(2, 10); expect(v.x).toBeCloseTo(-400, 10); expect(v.y).toBeCloseTo(-300, 10);
  expect(field.value).toBe("200");
  finger(pane, "pointerup", 12, 600, 300);
  expect(probe.preview!.zoom).toBeCloseTo(2, 10);
});

it("the finger left after a pinch pans", async () => {
  const { pane, layer } = await mountEditor();
  pinchTo2x(pane);
  finger(pane, "pointerup", 12, 600, 300);
  finger(pane, "pointermove", 11, 160, 300);
  const v = viewOf(layer);
  expect(v.z).toBeCloseTo(2, 10); expect(v.x).toBeCloseTo(-440, 10); expect(v.y).toBeCloseTo(-300, 10);
});

it("a lone finger the layer drag took does not pan; a second cancels the drag once the pinch starts", async () => {
  const { pane, layer } = await mountEditor();
  run("zoom-in"); run("zoom-in");
  probe.armed = true;
  finger(pane, "pointerdown", 11, 300, 300);
  finger(pane, "pointermove", 11, 320, 300);
  expect(viewOf(layer)).toEqual({ z: 1.5625, x: -225, y: -168.75 });
  finger(pane, "pointerdown", 12, 489, 300);
  expect(probe.cancel).not.toHaveBeenCalled();
  finger(pane, "pointermove", 12, 500, 300); // out of the tap slop: the pinch starts
  expect(probe.cancel).toHaveBeenCalledTimes(1);
  expect(viewOf(layer).z).toBe(1.5625);
  finger(pane, "pointermove", 12, 520, 300);
  expect(viewOf(layer).z).toBeCloseTo((1.5625 * 200) / 180, 10);
});

it("a third finger is ignored", async () => {
  const { pane, layer } = await mountEditor();
  pinchTo2x(pane);
  const at = layer.style.transform;
  finger(pane, "pointerdown", 13, 100, 100);
  finger(pane, "pointermove", 13, 50, 50);
  finger(pane, "pointerup", 13, 50, 50);
  expect(layer.style.transform).toBe(at);
});

it("a finger on a ruler or on the text being edited does not pan", async () => {
  const { pane, layer } = await mountEditor();
  run("zoom-in"); run("zoom-in");
  const rulers = Object.assign(document.createElement("div"), { innerHTML: "<div></div>" });
  rulers.dataset.slot = "rulers";
  const field = document.createElement("div");
  field.setAttribute("contenteditable", "true");
  pane.append(rulers, field);
  for (const el of [rulers.firstElementChild!, field]) {
    finger(el, "pointerdown", 11, 400, 300);
    finger(el, "pointermove", 11, 350, 250);
    finger(el, "pointerup", 11, 350, 250);
  }
  expect(viewOf(layer)).toEqual({ z: 1.5625, x: -225, y: -168.75 });
});

it("a pan's trailing click keeps the selection; a still tap's click deselects", async () => {
  const { pane } = await mountEditor();
  run("zoom-in"); run("zoom-in");
  pick("description");
  finger(pane, "pointerdown", 11, 400, 300);
  finger(pane, "pointermove", 11, 380, 300);
  finger(pane, "pointerup", 11, 380, 300);
  click(pane);
  expect(probe.preview!.selected).toEqual(["description"]);
  finger(pane, "pointerdown", 11, 400, 300);
  finger(pane, "pointerup", 11, 400, 300);
  click(pane);
  expect(probe.preview!.selected).toEqual([]);
});

// Review Focus 1
it("pinching and panning keep the selection and add no undo step", async () => {
  const { pane } = await mountEditor();
  pick("description");
  expect(undoDisabled()).toBe(true);
  pinchTo2x(pane);
  finger(pane, "pointerup", 12, 600, 300);
  finger(pane, "pointermove", 11, 150, 250);
  finger(pane, "pointerup", 11, 150, 250);
  expect(probe.preview!.selected).toEqual(["description"]);
  expect(undoDisabled()).toBe(true);
});

// Review Focus 2
it("a resting finger does not turn a tap into a gesture", async () => {
  const { pane, layer } = await mountEditor();
  pick("description");
  finger(pane, "pointerdown", 11, 100, 100);
  finger(pane, "pointerdown", 12, 500, 300);
  finger(pane, "pointerup", 12, 500, 300);
  click(pane);
  finger(pane, "pointerup", 11, 100, 100);
  expect(viewOf(layer)).toEqual({ z: 1, x: 0, y: 0 });
  expect(probe.preview!.selected).toEqual([]);
});

// Review Focus 3 (the pure limits are in tests/zoom-pan-pinch.test.ts)
it("a pinch below the bottom of the range reaches no listener", async () => {
  const { pane } = await mountEditor();
  let notified = 0;
  const stop = probe.view!.subscribe(() => { notified++; });
  finger(pane, "pointerdown", 11, 300, 300);
  finger(pane, "pointerdown", 12, 500, 300);
  finger(pane, "pointermove", 11, 350, 300); // leaves the slop: the pinch starts
  finger(pane, "pointermove", 11, 380, 300); // the pinch runs, below the range
  stop();
  expect(notified).toBe(0);
});

// Review Focus 5: rotating the phone cancels a finger and resizes the pane.
it("a cancelled finger mid-pinch leaves the other panning, inside the pane's new size", async () => {
  const { pane, layer } = await mountEditor();
  pinchTo2x(pane);
  pane.getBoundingClientRect = () => ({ ...PANE, right: 844, bottom: 241, width: 844, height: 241 }) as DOMRect;
  finger(pane, "pointercancel", 12, 600, 300);
  finger(pane, "pointermove", 11, -800, 300);
  const v = viewOf(layer);
  expect(v.z).toBeCloseTo(2, 10); expect(v.x).toBeCloseTo(-844, 10); expect(v.y).toBeCloseTo(-241, 10);
});

it("a mouse's left drag still does not pan, and fingers leave a 3D view's camera alone", async () => {
  const { pane, layer } = await mountEditor();
  run("zoom-in"); run("zoom-in");
  act(() => {
    pane.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse", pointerId: 1, button: 0, clientX: 400, clientY: 300, bubbles: true }));
    pane.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", pointerId: 1, button: 0, clientX: 350, clientY: 250, bubbles: true }));
    pane.dispatchEvent(new PointerEvent("pointerup", { pointerType: "mouse", pointerId: 1, button: 0, clientX: 350, clientY: 250, bubbles: true }));
  });
  expect(viewOf(layer)).toEqual({ z: 1.5625, x: -225, y: -168.75 });
  run("view-can");
  const at = probe.view!.get();
  finger(pane, "pointerdown", 11, 400, 300);
  finger(pane, "pointermove", 11, 300, 200);
  expect(probe.view!.get()).toBe(at);
});

it("a finger still down when the pane leaves 2D stops moving the view", async () => {
  const { pane } = await mountEditor();
  run("zoom-in"); run("zoom-in");
  finger(pane, "pointerdown", 11, 400, 300);
  run("view-can");
  const at = probe.view!.get();
  finger(pane, "pointermove", 11, 300, 200);
  expect(probe.view!.get()).toBe(at);
});
