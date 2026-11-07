// qr-settle-dom.test.tsx — typing into a field that feeds a QR must not
// re-encode the QR per keystroke (#722): the preview and the die check plan
// from useSettledQr's layers, which hold the last QR until the typing pauses.
// The encode counter wraps the real qrcode-generator; PreviewCompare is a stub
// that plans its `layers` prop the way the real one does.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import type { Layer, QrLayer } from "../src/model/layers";

const seen = vi.hoisted(() => ({ encodes: 0, layers: [] as Layer[], typing: null as null | string }));
vi.mock("qrcode-generator", async (orig) => {
  const real = (await orig<{ default: (...a: unknown[]) => unknown }>()).default;
  return { default: (...a: unknown[]) => { seen.encodes++; return real(...a); } };
});
vi.mock("../src/model/starterLayers", async () => ({ starterMaster: (await import("./fixtures/lolevMaster")).lolevMaster }));
vi.mock("../src/components/PreviewCompare", async () => {
  const { planLayerScene } = await import("../src/planLayers");
  return {
    SNAP_PT: 6,
    PreviewCompare: (p: { layers: Layer[]; canvasRender: import("../src/canvas/draw").CanvasRenderSource | null }) => {
      seen.layers = p.layers;
      if (p.canvasRender) planLayerScene(p.layers, p.canvasRender.m, p.canvasRender.planAssets);
      return null;
    },
  };
});
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
  FONT_URLS: { poppins: {}, "barlow-condensed": {} },
}));
import { DocumentEditor } from "../src/App";

const qrValue = () => (seen.layers.find((l) => l.kind === "qr") as QrLayer).value;
const pause = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

it("re-encodes the QR once per typing pause, not per keystroke", async () => {
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
  await pause(400); // the render source's debounce, then the first plan
  await act(async () => {
    (container.querySelector('[data-layer-id="name"] [data-slot="sidebar-menu-button"]') as HTMLButtonElement).click();
  });
  const editor = document.querySelector('[contenteditable="true"]') as HTMLElement;
  const before = qrValue();
  seen.encodes = 0;
  for (const name of ["P", "Pe", "Per", "Pere", "Pereg"]) {
    await act(async () => {
      editor.innerHTML = `<div>${name}</div>`;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  expect(seen.encodes).toBe(0);
  expect(qrValue()).toBe(before);
  await pause(400);
  expect(qrValue()).toContain("pereg");
  expect(seen.encodes).toBe(1);
  await act(async () => { root.unmount(); });
  container.remove();
});
