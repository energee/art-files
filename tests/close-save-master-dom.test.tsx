// close-save-master-dom.test.tsx — closing a tab with unsaved master edits
// (issue #159): the close prompt's Save (the editor's saveSlot, which
// TabsShell's saveAndClose awaits) saves the .label and closes, never
// opening the Save Master review; the prompt itself carries one extra line
// warning that the master changes will be discarded, driven by the tab's
// masterUnsaved meta.
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
import TabsShell from "../src/TabsShell";

// The browser download fallback (no FS-Access picker in happy-dom) ends in an
// <a download> click; record the file names instead of navigating.
let savedNames: string[] = [];
beforeEach(() => {
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    if (this.download) savedNames.push(this.download);
  });
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null; container = null;
  savedNames = [];
  vi.restoreAllMocks();
});

async function render(el: ReturnType<typeof createElement>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(el); });
}

async function mountEditor() {
  const saveSlot: { current: (() => Promise<boolean>) | null } = { current: null };
  const onMeta = vi.fn();
  await render(createElement(DocumentEditor, {
    active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta,
    saveSlot, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
    onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
    onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
  }));
  return { saveSlot, onMeta };
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

const closePrompt = () =>
  Array.from(document.querySelectorAll('[role="dialog"]'))
    .find((d) => d.textContent?.includes("unsaved changes")) ?? null;

it.each([true, false])(
  "close-prompt Save saves the label and lets the tab close (master edit: %s)",
  async (masterEdit) => {
    const { saveSlot, onMeta } = await mountEditor();
    if (masterEdit) await addTextLayer();
    expect(onMeta.mock.lastCall?.[0]).toMatchObject({ masterUnsaved: masterEdit });
    let result: boolean | undefined;
    await act(async () => { result = await saveSlot.current!(); });
    // true = TabsShell closes the tab, as before #159; no review detour.
    expect(result).toBe(true);
    expect(reviewOpen()).toBe(false);
    expect(savedNames).toHaveLength(1);
    expect(savedNames[0]).toMatch(/\.label$/);
  });

it("the close prompt warns that unsaved master changes will be discarded", async () => {
  await render(createElement(TabsShell));
  await addTextLayer();
  const close = document.querySelector('[aria-label^="Close "]') as HTMLElement;
  await act(async () => { close.click(); });
  const prompt = closePrompt();
  expect(prompt).not.toBeNull();
  expect(prompt!.textContent).toContain("This tab also has master changes");
  expect(prompt!.textContent).toContain("File → Save Master");
  // Still the same three choices — no extra button.
  expect(Array.from(prompt!.querySelectorAll("button")).map((b) => b.textContent))
    .toEqual(["Cancel", "Discard", "Save"]);
  // No second dialog (the Save Master review) alongside the prompt. Counted
  // by dialog-content: the narrow happy-dom viewport also mounts the
  // sidebar as a role="dialog" sheet.
  expect(document.querySelectorAll('[data-slot="dialog-content"]')).toHaveLength(1);
});
