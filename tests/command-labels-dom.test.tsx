// command-labels-dom.test.tsx — App's command table is rebuilt on every render
// for its closures, but its labels only change with the language (#725): a
// keystroke must not walk i18next for them, and a language change must still
// reach every one.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import type { Command } from "../src/components/CommandMenu";

const palette = vi.hoisted(() => ({ actions: [] as Command[] }));
vi.mock("../src/components/CommandMenu", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/components/CommandMenu")>(),
  CommandMenu: (p: { actions: Command[] }) => { palette.actions = p.actions; return null; },
}));
vi.mock("../src/components/PreviewCompare", () => ({ SNAP_PT: 6, PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
  FONT_URLS: { poppins: {}, "barlow-condensed": {} },
}));
import { DocumentEditor } from "../src/App";
import i18n, { setLanguage, t } from "../src/i18n";

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
  await act(async () => {
    (container.querySelector('[data-layer-id="name"] [data-slot="sidebar-menu-button"]') as HTMLButtonElement).click();
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => { await setLanguage("en"); });
  await act(async () => { root.unmount(); });
  container.remove();
});

const typeText = (text: string) => act(async () => {
  const editor = document.querySelector('[contenteditable="true"]') as HTMLElement;
  editor.innerHTML = `<div>${text}</div>`;
  editor.dispatchEvent(new Event("input", { bubbles: true }));
});

it("a keystroke looks up no command label", async () => {
  await typeText("P");
  const lookup = vi.spyOn(i18n, "t");
  await typeText("Pe");
  expect(palette.actions.find((c) => c.id === "tab-new")?.label).toBe("New Tab");
  const keys = lookup.mock.calls.map(([key]) => key);
  expect(keys).not.toContain("New Tab");
  expect(keys).not.toContain("Zoom to Fit");
});

it("a language change relabels every command, and changing back restores them", async () => {
  const english = palette.actions.map((c) => [c.id, c.label]);
  await act(async () => { await setLanguage("es"); });
  expect(palette.actions.map((c) => [c.id, c.label])).toEqual(english.map(([id, label]) => [id, t(label)]));
  expect(palette.actions.find((c) => c.id === "tab-new")?.label).not.toBe("New Tab");
  await act(async () => { await setLanguage("en"); });
  expect(palette.actions.map((c) => [c.id, c.label])).toEqual(english);
});
