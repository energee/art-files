// canview-lazy-dom.test.tsx — the 3D can view (and three.js with it) loads on
// first use, not with the editor: the CanView module is not imported while
// the editor sits in 2D, and switching to the Can view still mounts it.
// canview-lazy-fail-dom.test.tsx covers a failed load.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";

const probe = vi.hoisted(() => ({ loads: 0 }));
vi.mock("../src/components/PreviewCompare", () => ({ SNAP_PT: 6, PreviewCompare: () => null }));
// The factory runs when the module is first imported, so `loads` counts
// imports of CanView.
vi.mock("../src/components/CanView", () => {
  probe.loads++;
  return { CanView: () => createElement("div", { "data-testid": "can-view" }) };
});
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
import { DocumentEditor } from "../src/App";

it("imports the 3D view only when the Can view opens, then mounts it", async () => {
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
  try {
    expect(probe.loads).toBe(0);
    expect(container.querySelector('[data-testid="can-view"]')).toBeNull();
    // Bare "3" is the Preview: Can shortcut.
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "4", bubbles: true }));
    });
    await vi.waitFor(() => expect(container.querySelector('[data-testid="can-view"]')).not.toBeNull());
    expect(probe.loads).toBe(1);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});
