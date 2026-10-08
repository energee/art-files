// dialogs-lazy-fail-dom.test.tsx — Settings, the Save Master review and the
// ⌘K palette load on first use (#410), so their chunks can fail to load (a
// stale dev chunk, a broken install). Each failure must say so where the
// surface would have opened and keep the editor standing, as the 3D view
// does (canview-lazy-fail-dom.test.tsx). The happy path is
// dialogs-lazy-dom.test.tsx.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import type { Command } from "../src/components/CommandMenu";
import { dialogOpen } from "../src/keys";

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
vi.mock("../src/components/RenderSettings", () => { throw new Error("chunk load failed"); });
vi.mock("../src/components/MasterSaveReview", () => { throw new Error("chunk load failed"); });
vi.mock("../src/components/CommandPalette", () => { throw new Error("chunk load failed"); });
import { DocumentEditor } from "../src/App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("a Settings, Save Master review or ⌘K palette that fails to load says so and keeps the editor", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const pressK = () => act(async () => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
  });
  await act(async () => {
    root.render(createElement(DocumentEditor, {
      active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
      saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
      onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
      onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
    }));
  });
  try {
    // ⌘K first: any other open dialog would (rightly) block it (#244).
    await pressK();
    await vi.waitFor(() => expect(document.body.textContent).toContain("command palette failed to load"), { timeout: 5000 });
    await pressK(); // ⌘K still closes it
    await vi.waitFor(() => expect(dialogOpen()).toBe(false), { timeout: 5000 });

    await act(async () => { menu.actions.find((c) => c.id === "settings")!.run(); });
    await vi.waitFor(() => expect(document.body.textContent).toContain("Settings failed to load"), { timeout: 5000 });

    await act(async () => { menu.actions.find((c) => c.id === "master-save-as")!.run(); });
    await vi.waitFor(() => expect(document.body.textContent).toContain("Save Master review failed to load"), { timeout: 5000 });

    expect(container.querySelector("#master-picker")).not.toBeNull();
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});
