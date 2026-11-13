// settings-page-dom.test.tsx — Settings is a page, not a dialog: the sidebar
// lists the settings groups in place of the Layers list, the main area shows
// the fields, and Back or Escape returns to the label.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER, SETTINGS_GROUPS } from "../src/settings";
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

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let tabStrip: HTMLDivElement;
const nav = () => container.querySelector("[data-settings-nav]");
const page = () => container.querySelector("[data-settings-page]");
const openSettings = async () => {
  await act(async () => { menu.actions.find((c) => c.id === "settings")!.run(); });
  await vi.waitFor(() => expect(page()?.querySelector("#settings-output")).not.toBeNull(), { timeout: 5000 });
};

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(DocumentEditor, {
      active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
      saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
      onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
      onCheckForUpdates: vi.fn(), tabStripHost: (el: HTMLDivElement | null) => { if (el) tabStrip = el; },
    }));
  });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

it("shows the groups in the sidebar and the fields in the main area, with no dialog", async () => {
  expect(nav()).toBeNull();
  await openSettings();
  expect([...nav()!.querySelectorAll("button[data-group]")].map((b) => b.textContent))
    .toEqual(SETTINGS_GROUPS.map((g) => g.title));
  expect(container.querySelector("#master-picker")).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  // The workspace tab strip's slot is hidden with the label.
  expect(tabStrip.className).toBe("hidden");
  for (const g of SETTINGS_GROUPS) expect(page()!.querySelector(`#settings-${g.id}`)).not.toBeNull();
});

it("a group in the sidebar scrolls to its fields", async () => {
  await openSettings();
  const scrolled: string[] = [];
  const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) { scrolled.push(this.id); });
  await act(async () => (nav()!.querySelector('button[data-group="output"]') as HTMLButtonElement).click());
  spy.mockRestore();
  expect(scrolled).toEqual(["settings-output"]);
});

it("Back returns to the label", async () => {
  await openSettings();
  await act(async () => (nav()!.querySelector("button[data-settings-back]") as HTMLButtonElement).click());
  expect(nav()).toBeNull();
  expect(page()).toBeNull();
  expect(container.querySelector("#master-picker")).not.toBeNull();
});

it("Escape and ⌘, again both close the page, wherever focus is", async () => {
  await openSettings();
  await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(page()).toBeNull();
  await openSettings();
  await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: ",", metaKey: true, bubbles: true })); });
  expect(page()).toBeNull();
});
