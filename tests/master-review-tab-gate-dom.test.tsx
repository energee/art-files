// master-review-tab-gate-dom.test.tsx — the Save Master review dialog belongs
// to its tab: switching tabs (active → false) must hide it, like Settings and
// the inspector Sheet, so a confirm can never write a background tab's master
// (issue #118). Graphics and menus are stubbed; DocumentEditor is real.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import type { Command } from "../src/components/CommandMenu";

const menu = vi.hoisted(() => ({ actions: [] as Command[] }));
vi.mock("../src/components/PreviewCompare", () => ({ PreviewCompare: () => null }));
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

it("hides the Save Master review when its tab goes inactive", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const props = (active: boolean) => ({
    active, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
    saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
    onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
    onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
  });
  const reviewOpen = () => [...document.querySelectorAll('[role="dialog"]')]
    .some((d) => d.textContent?.includes("Save Master"));
  try {
    await act(async () => { root.render(createElement(DocumentEditor, props(true))); });
    // An override to promote: with none, Save Master skips the review.
    await act(async () => (document.querySelector('[data-layer-id="warning"] button[aria-label$=": enabled"]') as HTMLButtonElement).click());
    await act(async () => { menu.actions.find((c) => c.id === "master-save-as")!.run(); });
    // The review loads on first open (#410).
    await vi.waitFor(() => expect(reviewOpen()).toBe(true), { timeout: 5000 });
    await act(async () => { root.render(createElement(DocumentEditor, props(false))); });
    expect(reviewOpen()).toBe(false);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});
