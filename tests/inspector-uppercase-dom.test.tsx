// inspector-uppercase-dom.test.tsx — the inspector has one Uppercase control
// (UX audit 9). The Typography switch, which carries the override badge, is
// it; the sidebar text field's toolbar no longer repeats it as an "AB"
// toggle. The in-place canvas pill keeps its own (InPlaceRichField).
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";

vi.mock("../src/components/PreviewCompare", () => ({ PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
import { DocumentEditor } from "../src/App";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(DocumentEditor, {
      active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
      saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
      onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
      onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
    }));
  });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

it("offers Uppercase once in the inspector: the Typography switch, not a toolbar toggle", async () => {
  const row = container.querySelector(
    '[data-layer-id="name"] [data-slot="sidebar-menu-button"]') as HTMLButtonElement;
  await act(async () => { row.click(); });
  // The inspector is a Sheet portalled to document.body.
  expect(document.querySelector("#name-content")).not.toBeNull();
  expect(document.querySelector('[aria-label="Toggle uppercase"]')).toBeNull();
  const toggle = document.querySelector('[role="switch"][aria-label="Uppercase"]');
  expect(toggle).not.toBeNull();
});
