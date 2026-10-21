// close-save-master-dom.test.tsx — closing a tab with unsaved master edits
// (issue #159): the close prompt's Save (the editor's saveSlot, which
// TabsShell's saveAndClose awaits) saves the .label and closes, never
// opening the Save Master review; the prompt itself carries one extra line
// warning that the master changes will be discarded, driven by the tab's
// masterUnsaved meta, and a Review Master… button that opens the review in
// place of the prompt (never both at once): a saved review brings the prompt
// back for the .label (or closes the tab, leaving no dialog mounted, when the
// .label was already saved), a cancelled one cancels the close, and an editor
// that unmounts mid-review resolves it as not saved.
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
  const masterSaveSlot: { current: (() => Promise<boolean>) | null } = { current: null };
  const onMeta = vi.fn();
  await render(createElement(DocumentEditor, {
    active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta,
    saveSlot, masterSaveSlot, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
    onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
    onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
  }));
  return { saveSlot, masterSaveSlot, onMeta };
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
  expect(prompt!.textContent).toContain("Review Master…");
  // The three choices plus the review, which only a master edit offers.
  expect(Array.from(prompt!.querySelectorAll("button")).map((b) => b.textContent))
    .toEqual(["Cancel", "Discard", "Review Master…", "Save"]);
  // No second dialog (the Save Master review) alongside the prompt. Counted
  // by dialog-content: the narrow happy-dom viewport also mounts the
  // sidebar as a role="dialog" sheet.
  expect(document.querySelectorAll('[data-slot="dialog-content"]')).toHaveLength(1);
});

const tabCount = () => document.querySelectorAll('[role="tab"]').length;
// Open dialogs only: base-ui keeps a closing one mounted, data-closed, until
// an exit animation happy-dom never finishes.
const dialogCount = () => document.querySelectorAll('[data-slot="dialog-content"]:not([data-closed])').length;
const button = (scope: ParentNode, text: string) =>
  Array.from(scope.querySelectorAll("button")).find((b) => b.textContent === text) as HTMLButtonElement;

async function openReviewFromPrompt() {
  await render(createElement(TabsShell));
  await addTextLayer();
  const close = document.querySelector('[aria-label^="Close "]') as HTMLElement;
  await act(async () => { close.click(); });
  await act(async () => { button(closePrompt()!, "Review Master…").click(); });
  // The review loads on first open (#410).
  await vi.waitFor(() => expect(reviewOpen()).toBe(true), { timeout: 5000 });
}

const review = () =>
  Array.from(document.querySelectorAll('[data-slot="dialog-content"]'))
    .find((d) => d.textContent?.includes("Save Master"))!;

it("Review Master… swaps the close prompt for the review; cancelling it cancels the close", async () => {
  await openReviewFromPrompt();
  expect(closePrompt()).toBeNull();
  expect(dialogCount()).toBe(1);
  await act(async () => { button(review(), "Cancel").click(); });
  await vi.waitFor(() => expect(dialogCount()).toBe(0));
  expect(tabCount()).toBe(1);
  expect(savedNames).toHaveLength(0);
});

it("a saved review brings the close prompt back for the .label, without the master line", async () => {
  await openReviewFromPrompt();
  await act(async () => { button(review(), "Save Master").click(); });
  await vi.waitFor(() => expect(closePrompt()).not.toBeNull());
  expect(savedNames).toEqual([expect.stringMatching(/\.master$/)]);
  expect(reviewOpen()).toBe(false);
  expect(closePrompt()!.textContent).not.toContain("master changes");
  expect(tabCount()).toBe(1);
  await act(async () => { button(closePrompt()!, "Discard").click(); });
  await vi.waitFor(() => expect(closePrompt()).toBeNull());
});

it("a saved review closes the tab outright when the .label was already saved", async () => {
  await render(createElement(TabsShell));
  await addTextLayer();
  // ⌘S writes the .label; only the master edit is left unsaved.
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "s", metaKey: true }));
  });
  await vi.waitFor(() => expect(savedNames).toHaveLength(1));
  const close = document.querySelector('[aria-label^="Close "]') as HTMLElement;
  await act(async () => { close.click(); });
  await act(async () => { button(closePrompt()!, "Review Master…").click(); });
  await vi.waitFor(() => expect(reviewOpen()).toBe(true), { timeout: 5000 });
  const layersBefore = document.querySelectorAll('[data-layer-id]').length;
  await act(async () => { button(review(), "Save Master").click(); });
  // Nothing left to decide: the tab closes with no prompt, and a fresh
  // Untitled with no layers replaces the last one.
  await vi.waitFor(() => expect(dialogCount()).toBe(0));
  // Nothing left mounted either: a closed-but-mounted prompt keeps its
  // blurred backdrop over the window and swallows every click.
  await vi.waitFor(() => expect(document.querySelectorAll(
    '[data-slot="dialog-overlay"], [data-slot="dialog-content"]')).toHaveLength(0));
  expect(document.querySelectorAll('[data-layer-id]').length).toBeLessThan(layersBefore);
  expect(savedNames[1]).toMatch(/\.master$/);
}, 15000);

it("an editor that unmounts mid-review resolves the close prompt's review as not saved", async () => {
  const { masterSaveSlot } = await mountEditor();
  await addTextLayer();
  let result: boolean | undefined;
  await act(async () => { void masterSaveSlot.current!().then((saved) => { result = saved; }); });
  await vi.waitFor(() => expect(reviewOpen()).toBe(true), { timeout: 5000 });
  // A shell still awaiting it would leave `reviewing` set and stall a quit sweep.
  await act(async () => { root!.unmount(); });
  root = null;
  expect(result).toBe(false);
});
