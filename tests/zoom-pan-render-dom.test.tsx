// zoom-pan-render-dom.test.tsx — a zoom or pan gesture moves the preview
// without re-rendering the editor (#714): the mounted DocumentEditor counts
// its renders through a PreviewCompare stand-in while the gesture writes the
// transform and the zoom readout straight to the DOM, then publishes the zoom
// to React once it settles. Counts, never timings.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PREVIEW_OVERSAMPLE } from "../src/layout";
import { DEFAULT_RENDER } from "../src/settings";
import type { Command } from "../src/components/CommandMenu";
import type { LiveView } from "../src/useZoomPan";

type PreviewProps = import("react").ComponentProps<typeof import("../src/components/PreviewCompare").PreviewCompare>;
const probe = vi.hoisted(() => ({
  renders: 0, preview: null as PreviewProps | null, actions: [] as Command[],
  view: null as LiveView | null,
}));
vi.mock("../src/components/PreviewCompare", () => ({
  SNAP_PT: 6,
  PreviewCompare: (props: PreviewProps) => { probe.renders++; probe.preview = props; return null; },
}));
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
  const pane = container.querySelector("[data-export-status]")!.parentElement!;
  pane.getBoundingClientRect = () => PANE;
  pane.setPointerCapture = () => {};
  const layer = pane.querySelector<HTMLElement>('[style*="transform-origin"]')!;
  const field = container.querySelector<HTMLInputElement>('input[aria-label="Zoom percentage"]')!;
  vi.useFakeTimers();
  return { pane, layer, field };
}

/** happy-dom's WheelEvent has no pointer position, so it is set by hand. */
const wheel = (pane: HTMLElement, deltaY = -30) => act(() => {
  const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
  Object.defineProperties(event, { clientX: { value: 400 }, clientY: { value: 300 } });
  pane.dispatchEvent(event);
});
const pointer = (pane: HTMLElement, type: string, clientX: number, clientY: number) => act(() => {
  pane.dispatchEvent(new PointerEvent(type, { button: 2, pointerId: 1, clientX, clientY, bubbles: true }));
});
const settle = () => act(() => { vi.advanceTimersByTime(1000); });
const run = (id: string) => act(() => { probe.actions.find((c) => c.id === id)!.run(); });
const scaleOf = (layer: HTMLElement) => Number(/scale\(([\d.]+)\)/.exec(layer.style.transform)?.[1]);

it("wheel ticks write the transform and readout without rendering, then publish once", async () => {
  const { pane, layer, field } = await mountEditor();
  const before = probe.renders;
  for (let i = 0; i < 5; i++) wheel(pane);
  expect(probe.renders - before).toBe(0);
  const z = scaleOf(layer);
  expect(z).toBeGreaterThan(1);
  expect(field.value).toBe(String(Math.round(z * 100)));
  settle();
  expect(probe.renders - before).toBe(1);
  expect(probe.preview!.zoom).toBe(z);
});

it("pan moves write the transform without rendering", async () => {
  const { pane, layer } = await mountEditor();
  wheel(pane, -50);
  settle();
  const at = layer.style.transform;
  pointer(pane, "pointerdown", 400, 300);
  const before = probe.renders;
  for (let i = 1; i <= 5; i++) pointer(pane, "pointermove", 400 - i, 300 - i);
  expect(probe.renders - before).toBe(0);
  expect(layer.style.transform).not.toBe(at);
  const panned = layer.style.transform;
  pointer(pane, "pointerup", 395, 295);
  expect(layer.style.transform).toBe(panned);
});

it("a Zoom In straight after a wheel tick steps from the live zoom", async () => {
  const { pane, layer } = await mountEditor();
  wheel(pane);
  const z = scaleOf(layer);
  run("zoom-in");
  expect(scaleOf(layer)).toBeCloseTo(z * 1.25, 10);
  expect(probe.preview!.zoom).toBeCloseTo(z * 1.25, 10);
});

it("a zoom not yet published survives a trip through the 3D views", async () => {
  const { pane, layer } = await mountEditor();
  wheel(pane);
  const z = scaleOf(layer);
  run("view-can");
  run("view-label");
  settle();
  expect(scaleOf(layer)).toBeCloseTo(z, 10);
  expect(probe.preview!.zoom).toBeCloseTo(z, 10);
});

it("a gesture that moves nothing reaches no listener (#726)", async () => {
  const { pane, layer } = await mountEditor();
  let notified = 0;
  const stop = probe.view!.subscribe(() => { notified++; });
  // Fitted: there is nowhere to pan, and nothing past the bottom of the range.
  pointer(pane, "pointerdown", 400, 300);
  for (let i = 1; i <= 3; i++) pointer(pane, "pointermove", 400 + i, 300 + i);
  pointer(pane, "pointerup", 403, 303);
  wheel(pane, 50);
  expect(notified).toBe(0);
  // At the top of the range a further tick cannot zoom, so it cannot move.
  for (let i = 0; i < 40; i++) wheel(pane, -50);
  expect(scaleOf(layer)).toBe(PREVIEW_OVERSAMPLE);
  notified = 0;
  wheel(pane, -50);
  stop();
  expect(notified).toBe(0);
});

it("the zoom layer is the sheet's size container, so cqh is the pane's height", async () => {
  const { layer } = await mountEditor();
  expect(layer.style.containerType).toBe("size");
});
