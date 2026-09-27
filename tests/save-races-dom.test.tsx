// save-races-dom.test.tsx — pending writes and cancelled browser save targets.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { fileDrag } from "./dom-drag";
import type { Command } from "../src/components/CommandMenu";

const menu = vi.hoisted(() => ({ actions: [] as Command[] }));
vi.mock("../src/components/PreviewCompare", () => ({ PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/components/AppMenu", () => ({ AppMenu: (p: { actions: Command[] }) => { menu.actions = p.actions; return null; } }));
vi.mock("../src/fonts", () => ({ loadLabelFaces: async () => (t: string, s: number) => t.length * s * 0.55, labelFontCss: () => "sans-serif" }));
import { DocumentEditor } from "../src/App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});
async function mount() {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const saveSlot: { current: (() => Promise<boolean>) | null } = { current: null };
  const onMeta = vi.fn();
  await act(async () => root.render(createElement(DocumentEditor, {
    active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta, saveSlot,
    render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(), onOpenProject: vi.fn(),
    onNewTab: vi.fn(), onCloseTab: vi.fn(), onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
  })));
  return { saveSlot, onMeta };
}
async function toggle(id: string) {
  const b = document.querySelector(`[data-layer-id="${id}"] button[aria-pressed]`) as HTMLButtonElement;
  expect(b).not.toBeNull();
  await act(async () => b.click());
}
function picker(write: () => Promise<void> = async () => {}) {
  const handle = { name: "Beer.label", createWritable: vi.fn(async () => ({ write, close: async () => {} })) };
  const pick = vi.fn(async () => handle);
  vi.stubGlobal("showSaveFilePicker", pick);
  return { handle, pick };
}
it("keeps edits made during a write dirty and refuses close-after-save (#263)", async () => {
  let finish!: () => void;
  picker(() => new Promise<void>((resolve) => { finish = resolve; }));
  const { saveSlot, onMeta } = await mount();
  let saving!: Promise<boolean>;
  await act(async () => { saving = saveSlot.current!(); });
  await toggle("warning");
  let saved: boolean | undefined;
  await act(async () => { finish(); saved = await saving; });
  expect(saved).toBe(false);
  expect(onMeta.mock.lastCall?.[0]).toMatchObject({ dirty: true, edited: true });
});
it("reports a refused write without downloading or clearing dirty (#265)", async () => {
  picker(async () => { throw new DOMException("Permission refused", "NotAllowedError"); });
  const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const { saveSlot, onMeta } = await mount();
  await toggle("warning");
  await act(async () => { expect(await saveSlot.current!()).toBe(false); });
  expect(onMeta.mock.lastCall?.[0]).toMatchObject({ dirty: true });
  expect(document.body.textContent).toContain("Could not save project: Permission refused");
  expect(download).not.toHaveBeenCalled();
});
it("a cancelled Save As preserves the original target (#265)", async () => {
  const { handle, pick } = picker();
  const { saveSlot } = await mount();
  await act(async () => { expect(await saveSlot.current!()).toBe(true); });
  pick.mockRejectedValueOnce(new DOMException("Cancelled", "AbortError"));
  await act(async () => menu.actions.find((c) => c.id === "project-save-as")!.run());
  await toggle("warning");
  await act(async () => { expect(await saveSlot.current!()).toBe(true); });
  expect(pick).toHaveBeenCalledTimes(2);
  expect(handle.createWritable).toHaveBeenCalledTimes(2);
});

it("Save Master preserves a newer edit to a promoted field (#263)", async () => {
  let finish!: () => void;
  picker(() => new Promise<void>((resolve) => { finish = resolve; }));
  const { onMeta } = await mount();
  await toggle("warning");
  await act(async () => menu.actions.find((c) => c.id === "master-save")!.run());
  const row = document.querySelector('[data-row="promote-warning-enabled"]')!;
  await act(async () => (row.closest("label")!.querySelector("input") as HTMLInputElement).click());
  const save = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save Master")!;
  await act(async () => save.click());
  await toggle("warning");
  await act(async () => { finish(); await new Promise((r) => setTimeout(r, 10)); });
  expect(document.querySelector('[data-layer-id="warning"] button[aria-pressed]')?.getAttribute("aria-pressed")).toBe("true");
  expect(onMeta.mock.lastCall?.[0]).toMatchObject({ dirty: true, edited: true });
});

it("reports a failed texture decode without an unhandled rejection (#266)", async () => {
  vi.stubGlobal("createImageBitmap", async () => { throw new Error("Invalid image"); });
  await mount();
  await act(async () => { fileDrag("drop", new File(["bad"], "broken.png", { type: "image/png" })); });
  expect(document.body.textContent).toContain('Could not load texture "broken.png": Invalid image');
});
