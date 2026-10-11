// canview-lazy-fail-dom.test.tsx — the 3D view loads on first use, so its
// chunk can fail to load (a stale dev chunk, a broken install). That must
// surface as the header's render error with the editor still standing, not
// unmount the whole app. The happy path is canview-lazy-dom.test.tsx.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";

vi.mock("../src/components/PreviewCompare", () => ({ SNAP_PT: 6, PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => { throw new Error("chunk load failed"); });
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
import { DocumentEditor } from "../src/App";

it("a 3D view that fails to load reports an error and keeps the editor", async () => {
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
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "3", bubbles: true }));
    });
    await vi.waitFor(() => expect(container.textContent).toContain("3D view failed to load"));
    expect(container.querySelector("#master-picker")).not.toBeNull();
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});
