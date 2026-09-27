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
vi.mock("../src/fonts", () => ({ loadLabelFaces: async () => (t: string, s: number) => t.length * s * 0.55, labelFontCss: () => "sans-serif", FONT_URLS: { poppins: {} } }));
vi.mock("../src/pdf/fonts", async () => {
  const { assets } = await import("./fixtures");
  return { loadFonts: async () => assets.fonts };
});
vi.mock("../src/psd/build", () => ({
  psdImages: async () => ({}), buildPsd: async () => new Uint8Array([3]),
}));
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
  const b = document.querySelector(`[data-layer-id="${id}"] button[aria-label$=": enabled"]`) as HTMLButtonElement;
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
  expect(document.querySelector('[data-layer-id="warning"] button[aria-label$=": enabled"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(onMeta.mock.lastCall?.[0]).toMatchObject({ dirty: true, edited: true });
});

/** Opens the Save Master review, ticks the warning-enabled promotion, and
 *  starts the save; returns the review's warning rows afterwards. */
async function promoteWarning() {
  await act(async () => menu.actions.find((c) => c.id === "master-save")!.run());
  const row = document.querySelector('[data-row="promote-warning-enabled"]')!;
  await act(async () => (row.closest("label")!.querySelector("input") as HTMLInputElement).click());
  const save = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save Master")!;
  await act(async () => save.click());
}
const warningPressed = () =>
  document.querySelector('[data-layer-id="warning"] button[aria-label$=": enabled"]')?.getAttribute("aria-pressed");
async function reorderName() {
  const button = document.querySelector('[data-layer-id="name"] [data-slot="sidebar-menu-button"]') as HTMLElement;
  await act(async () => button.click());
  await act(async () => {
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
  });
}

it("Save Master keeps a promotion when the master is edited during the write", async () => {
  let finish!: () => void;
  picker(() => new Promise<void>((resolve) => { finish = resolve; }));
  await mount();
  await toggle("warning");
  await promoteWarning();
  const order = () => [...document.querySelectorAll("[data-layer-id]")].map((e) => e.getAttribute("data-layer-id")).join();
  const before = order();
  await reorderName();
  expect(order()).not.toBe(before); // the master edit landed during the write
  await act(async () => { finish(); await new Promise((r) => setTimeout(r, 10)); });
  // The promoted "off" is still what the document draws…
  expect(warningPressed()).toBe("false");
  // …and the next review has no warning row to revert it with.
  await act(async () => menu.actions.find((c) => c.id === "master-save")!.run());
  expect(document.querySelector('[data-row*="warning"]')).toBeNull();
});

it("reports a failed texture decode without an unhandled rejection (#266)", async () => {
  vi.stubGlobal("createImageBitmap", async () => { throw new Error("Invalid image"); });
  await mount();
  await act(async () => { fileDrag("drop", new File(["bad"], "broken.png", { type: "image/png" })); });
  expect(document.body.textContent).toContain('Could not load texture "broken.png": Invalid image');
});

it("a texture that loads keeps another slot's error on screen", async () => {
  // Decodes succeed except the mask's; canvas is stubbed for the preview pass.
  class FakeBitmap { width = 10; height = 10; close() {} }
  vi.stubGlobal("ImageBitmap", FakeBitmap);
  vi.stubGlobal("createImageBitmap", async (f: Blob) => {
    if ((f as File).name === "broken-mask.png") throw new Error("Invalid image");
    return new FakeBitmap();
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() {} } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(new Blob(["png"])));
  await mount();
  const drop = async (file: File, clientX: number) => {
    const e = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "dataTransfer", { value: { types: ["Files"], items: [{ kind: "file", type: file.type }], files: [file] } });
    Object.defineProperty(e, "clientX", { value: clientX });
    await act(async () => { document.body.dispatchEvent(e); await new Promise((r) => setTimeout(r, 10)); });
  };
  await drop(new File(["bad"], "broken-mask.png", { type: "image/png" }), window.innerWidth - 10);
  expect(document.body.textContent).toContain('Could not load mask "broken-mask.png"');
  await drop(new File(["ok"], "art.png", { type: "image/png" }), 10);
  expect(document.body.textContent).toContain('Could not load mask "broken-mask.png"');
});

for (const [command, extension] of [["export-both", "pdf"], ["export-psd", "psd"]]) {
  it(`${extension}: cancelling artwork stops the pair (#254)`, async () => {
    const { pick } = picker();
    pick.mockRejectedValueOnce(new DOMException("Cancelled", "AbortError"));
    await mount();
    // The PDF command is enabled only after the debounced preview setup.
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
      expect(menu.actions.find((c) => c.id === "export-both")!.disabled).toBe(false);
    });
    await act(async () => {
      menu.actions.find((c) => c.id === command)!.run();
      await vi.waitFor(() => expect(pick).toHaveBeenCalled(), { timeout: 4000 });
    });
    expect(pick, document.body.textContent ?? "").toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("Export cancelled before saving");
  });
  it(`${extension}: a refused mask write reports the saved artwork (#254)`, async () => {
    let writes = 0;
    const { pick, handle } = picker(async () => { if (++writes === 2) throw new Error("Disk full"); });
    handle.name = `renamed-art.${extension}`;
    await mount();
    // The PDF command is enabled only after the debounced preview setup.
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
      expect(menu.actions.find((c) => c.id === "export-both")!.disabled).toBe(false);
    });
    await act(async () => {
      menu.actions.find((c) => c.id === command)!.run();
      await vi.waitFor(() => expect(pick).toHaveBeenCalledTimes(2), { timeout: 4000 });
    });
    expect(document.body.textContent).toMatch(new RegExp(`Saved renamed-art\\.${extension}\\. Could not save .+-mask\\.${extension}: Disk full`));
  });
}
