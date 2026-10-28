// dialogs-lazy-dom.test.tsx — the Settings fields, the Save Master review and
// the ⌘K palette body load on first use, not with the editor (#410): none of
// their modules is imported while the editor sits idle, and opening each one
// still mounts it. Same probe pattern as canview-lazy-dom.test.tsx.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import type { Command } from "../src/components/CommandMenu";

const probe = vi.hoisted(() => ({ settings: 0, review: 0, palette: 0, actions: [] as Command[] }));
vi.mock("../src/components/PreviewCompare", () => ({ SNAP_PT: 6, PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/components/AppMenu", () => ({
  AppMenu: (props: { actions: Command[] }) => { probe.actions = props.actions; return null; },
}));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
// Each factory runs when its module is first imported, so the counters count
// imports. The stand-ins render a marker so the test can see them mount.
vi.mock("../src/components/RenderSettings", async () => {
  const { createElement: h } = await import("react");
  probe.settings++;
  return { RenderSettings: () => h("div", { "data-testid": "render-settings" }) };
});
vi.mock("../src/components/MasterSaveReview", async () => {
  const { createElement: h } = await import("react");
  probe.review++;
  return { MasterSaveReview: (p: { open: boolean }) => p.open ? h("div", { "data-testid": "master-review" }) : null };
});
vi.mock("../src/components/CommandPalette", async () => {
  const { createElement: h } = await import("react");
  probe.palette++;
  return { CommandPalette: (p: { open: boolean }) => p.open ? h("div", { "data-testid": "palette" }) : null };
});
import { DocumentEditor } from "../src/App";

it("imports Settings, the Save Master review and the ⌘K palette only when each opens", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const shown = (id: string) => document.querySelector(`[data-testid="${id}"]`);
  await act(async () => {
    root.render(createElement(DocumentEditor, {
      active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
      saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
      onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
      onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
    }));
  });
  try {
    expect(probe).toMatchObject({ settings: 0, review: 0, palette: 0 });

    // ⌘K first: an open Settings dialog would (rightly) block it (#244).
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    });
    await vi.waitFor(() => expect(shown("palette")).not.toBeNull(), { timeout: 5000 });

    await act(async () => { probe.actions.find((c) => c.id === "settings")!.run(); });
    await vi.waitFor(() => expect(shown("render-settings")).not.toBeNull(), { timeout: 5000 });

    // An override to promote: with none, Save Master skips the review.
    await act(async () => (document.querySelector('[data-layer-id="warning"] button[aria-label$=": enabled"]') as HTMLButtonElement).click());
    await act(async () => { probe.actions.find((c) => c.id === "master-save-as")!.run(); });
    await vi.waitFor(() => expect(shown("master-review")).not.toBeNull(), { timeout: 5000 });

    expect(probe).toMatchObject({ settings: 1, review: 1, palette: 1 });
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});
