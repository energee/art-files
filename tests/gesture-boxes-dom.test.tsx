// gesture-boxes-dom.test.tsx — a pointer move in a resize or guide drag reuses
// the draw list's boxes instead of re-placing every layer (#732): the mounted
// DocumentEditor counts full place passes, which are what cost measureText.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { layerBoxes } from "../src/planLayers";
import { DEFAULT_RENDER } from "../src/settings";

type PreviewProps = import("react").ComponentProps<typeof import("../src/components/PreviewCompare").PreviewCompare>;
type RulersProps = import("react").ComponentProps<typeof import("../src/components/Rulers").Rulers>;
const probe = vi.hoisted(() => ({ preview: null as PreviewProps | null, rulers: null as RulersProps | null }));
vi.mock("../src/planLayers", async (original) => {
  const actual = await original<typeof import("../src/planLayers")>();
  return { ...actual, layerBoxes: vi.fn(actual.layerBoxes) };
});
vi.mock("../src/model/starterLayers", async () => ({ starterMaster: (await import("./fixtures/lolevMaster")).lolevMaster }));
vi.mock("../src/components/PreviewCompare", () => ({
  SNAP_PT: 6, PreviewCompare: (props: PreviewProps) => { probe.preview = props; return null; },
}));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({
  Rulers: (props: RulersProps) => { probe.rulers = props; return null; },
}));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
import { DocumentEditor } from "../src/App";

let unmount = async () => {};
afterEach(async () => { await unmount(); });

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
  await vi.waitFor(() => expect(probe.preview!.canvasRender).not.toBeNull());
}

it("a resize move pays one place pass, the render's own (#732)", async () => {
  await mountEditor();
  const handle = { hx: 1, hy: 1 } as const;
  await act(async () => { probe.preview!.onResize("name", handle, 0, 0, false, true); });
  vi.mocked(layerBoxes).mockClear();
  for (let i = 1; i <= 5; i++) {
    await act(async () => { probe.preview!.onResize("name", handle, i * 7, i * 3, false, false); });
  }
  expect(layerBoxes).toHaveBeenCalledTimes(5);
});

it("a guide drag move pays no place pass", async () => {
  await mountEditor();
  vi.mocked(layerBoxes).mockClear();
  for (let i = 1; i <= 5; i++) probe.rulers!.onSnapGuide!("x", 100 + i, undefined);
  expect(layerBoxes).not.toHaveBeenCalled();
});
