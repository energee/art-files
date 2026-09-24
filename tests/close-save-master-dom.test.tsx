// close-save-master-dom.test.tsx — the close prompt's Save (the editor's
// saveSlot, which TabsShell's saveAndClose awaits) must not drop unsaved
// master edits: with the template moved, it opens the Save Master review and
// resolves false so the tab stays open (issue #159).
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";

vi.mock("../src/components/PreviewCompare", () => ({ PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
import { DocumentEditor } from "../src/App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The browser download fallback (no FS-Access picker in happy-dom) ends in an
// <a download> click; record the file names instead of navigating.
const saved = { names: [] as string[] };
HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
  if (this.download) saved.names.push(this.download);
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null; container = null;
  saved.names = [];
});

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const saveSlot: { current: (() => Promise<boolean>) | null } = { current: null };
  await act(async () => {
    root!.render(createElement(DocumentEditor, {
      active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
      saveSlot, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
      onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
      onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
    }));
  });
  return saveSlot;
}

/** base-ui's menu trigger opens on mousedown — send the whole press. */
async function addTextLayer() {
  const trigger = document.querySelector('[aria-label="Add layer"]')!;
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
      trigger.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    (trigger as HTMLElement).click();
    await Promise.resolve();
  });
  const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
    .find((el) => el.textContent?.trim() === "Text") as HTMLElement;
  await act(async () => { item.click(); await Promise.resolve(); });
}

const reviewOpen = () =>
  Array.from(document.querySelectorAll('[role="dialog"]'))
    .some((d) => d.textContent?.includes("Save Master"));

it("close-prompt Save with an unsaved master edit opens the master review and keeps the tab", async () => {
  const saveSlot = await mount();
  await addTextLayer();
  expect(reviewOpen()).toBe(false);
  let result: boolean | undefined;
  await act(async () => { result = await saveSlot.current!(); });
  // false = TabsShell cancels the close (and any window-close sweep).
  expect(result).toBe(false);
  expect(reviewOpen()).toBe(true);
  expect(saved.names).toEqual([]);
});

it("close-prompt Save with no master edit saves the label and lets the tab close", async () => {
  const saveSlot = await mount();
  let result: boolean | undefined;
  await act(async () => { result = await saveSlot.current!(); });
  expect(result).toBe(true);
  expect(reviewOpen()).toBe(false);
  expect(saved.names).toHaveLength(1);
  expect(saved.names[0]).toMatch(/\.label$/);
});
