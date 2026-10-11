// settings-focus-dom.test.tsx — Settings loads its fields on first open
// (#410). The dialog must still open focused on its first field, as it did
// when the fields shipped with the editor, not on the Close button that is
// the only focusable thing while the fields are still loading.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import type { Command } from "../src/components/CommandMenu";

const menu = vi.hoisted(() => ({ actions: [] as Command[] }));
vi.mock("../src/components/PreviewCompare", () => ({ SNAP_PT: 6, PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/components/AppMenu", () => ({
  AppMenu: (props: { actions: Command[] }) => { menu.actions = props.actions; return null; },
}));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
import { DocumentEditor } from "../src/App";

it("Settings opens focused on its first field the first time", async () => {
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
    await act(async () => { menu.actions.find((c) => c.id === "settings")!.run(); });
    await vi.waitFor(() => expect(document.activeElement?.id).toBe("doc-corner-radius"), { timeout: 5000 });
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});
