// save-races-dom.test.tsx — App-level Save / Save Master write paths: pending
// writes, cancelled browser save targets, and what a Save Master bundles.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { fileDrag } from "./dom-drag";
import type { Command } from "../src/components/CommandMenu";

const menu = vi.hoisted(() => ({ actions: [] as Command[], renderError: null as null | ((m: string) => void) }));
vi.mock("../src/components/PreviewCompare", () => ({
  PreviewCompare: (p: { onRenderError: (m: string) => void }) => { menu.renderError = p.onRenderError; return null; },
}));
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
import { DocumentEditor, type FileToOpen } from "../src/App";
import { lolevMaster } from "../src/model/lolevLayers";
import { packLabel, packMaster, unpackMaster } from "../src/model/files";
import type { Master } from "../src/model/layers";

let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});
async function mount(fileToOpen: FileToOpen | null = null) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const saveSlot: { current: (() => Promise<boolean>) | null } = { current: null };
  const onMeta = vi.fn();
  const props = {
    active: true, fileToOpen, onOpenSettled: vi.fn(), onMeta, saveSlot,
    render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(), onOpenProject: vi.fn(),
    onNewTab: vi.fn(), onCloseTab: vi.fn(), onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
  };
  await act(async () => root.render(createElement(DocumentEditor, props)));
  return { saveSlot, onMeta, props };
}
async function toggle(id: string) {
  const b = document.querySelector(`[data-layer-id="${id}"] button[aria-label$=": enabled"]`) as HTMLButtonElement;
  expect(b).not.toBeNull();
  await act(async () => b.click());
}
function picker(write: (bytes: Uint8Array) => Promise<void> = async () => {}) {
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
  expect(document.body.textContent).toContain("Could not save label: Permission refused");
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

/** The Save Master review loads on first open (#410): wait for its row. */
const reviewRow = (id: string) => vi.waitFor(() => {
  const row = document.querySelector(`[data-row="${id}"]`);
  if (!row) throw new Error(`no review row ${id}`);
  return row;
}, { timeout: 5000 });

it("Save Master preserves a newer edit to a promoted field (#263)", async () => {
  let finish!: () => void;
  picker(() => new Promise<void>((resolve) => { finish = resolve; }));
  const { onMeta } = await mount();
  await toggle("warning");
  await act(async () => menu.actions.find((c) => c.id === "master-save")!.run());
  const row = await reviewRow("promote-warning-enabled");
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
  const row = await reviewRow("promote-warning-enabled");
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

// With no override or value to promote the review has nothing to decide:
// Save Master writes the reordered layers without opening the review.
it("Save Master with nothing to promote writes the changed master at once", async () => {
  let written: Uint8Array | undefined;
  const { pick } = picker(async (bytes) => { written = bytes; });
  await mount();
  await reorderName();
  await act(async () => { await menu.actions.find((c) => c.id === "master-save")!.run(); await new Promise((r) => setTimeout(r, 10)); });
  expect(document.querySelectorAll("[data-row]")).toHaveLength(0);
  expect(pick).toHaveBeenCalledOnce();
  expect(written).toBeDefined();
  const { master } = unpackMaster(written!);
  expect(master.layers.filter((layer) => layer.id === "name" || layer.id === "logo").map((layer) => layer.id))
    .toEqual(["name", "logo"]);
});

it("Save Master As with nothing to promote goes straight to the save dialog", async () => {
  const { pick } = picker();
  await mount();
  await act(async () => { await menu.actions.find((c) => c.id === "master-save-as")!.run(); await new Promise((r) => setTimeout(r, 10)); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(pick).toHaveBeenCalledOnce();

});

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
    // The note is a warning, not an error: a later render failure must show.
    await act(async () => menu.renderError!("Preview failed: boom"));
    expect(document.body.textContent).toContain("Preview failed: boom");
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
    // Toggling a plate reruns asset assembly; its success must not wipe the
    // export's error, which it did not set (#511).
    await toggle("mask");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    expect(document.body.textContent).toContain("Disk full");
  });
  it(`${extension}: a finished export names both saved files (#400)`, async () => {
    // Each pick saves under the name the app suggested.
    const pick = vi.fn(async ({ suggestedName }: { suggestedName: string }) => (
      { name: suggestedName, createWritable: async () => ({ write: async () => {}, close: async () => {} }) }));
    vi.stubGlobal("showSaveFilePicker", pick);
    await mount();
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
      expect(menu.actions.find((c) => c.id === "export-both")!.disabled).toBe(false);
    });
    // A confirmation, not an error: announced politely, through a status
    // region that exists before the note lands (one mounted already holding
    // its text isn't announced).
    const region = document.querySelector("[data-export-saved]");
    expect(region?.getAttribute("role")).toBe("status");
    expect(region?.textContent).toBe("");
    await act(async () => {
      menu.actions.find((c) => c.id === command)!.run();
      await vi.waitFor(() => expect(pick).toHaveBeenCalledTimes(2), { timeout: 4000 });
    });
    const [art, mask] = pick.mock.calls.map(([options]) => options.suggestedName);
    await vi.waitFor(() => expect(document.body.textContent).toContain(`Saved ${art}, ${mask}.`));
    expect(document.querySelector("[data-export-saved]")).toBe(region);
    expect(region!.textContent).toBe(`Saved ${art}, ${mask}.`);
    // A render error coming and going hides and restores the visible note,
    // but the region's text never changes, so it isn't announced again.
    const visibleNote = () => document.querySelector('[data-slot="alert"][aria-hidden="true"]');
    await act(async () => menu.renderError!("Preview failed: boom"));
    expect(visibleNote()).toBeNull();
    expect(region!.textContent).toBe(`Saved ${art}, ${mask}.`);
    await act(async () => menu.renderError!(""));
    expect(visibleNote()?.textContent).toBe(`Saved ${art}, ${mask}.`);
    expect(region!.textContent).toBe(`Saved ${art}, ${mask}.`);
    // A later edit makes the confirmation stale, so it goes.
    await toggle("warning");
    expect(document.body.textContent).not.toContain(`Saved ${art}`);
  });
  it(`${extension}: an edit during the export withholds the confirmation (#400)`, async () => {
    // The first dialog waits until released, so an edit lands mid-export.
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const pick = vi.fn(async ({ suggestedName }: { suggestedName: string }) => {
      if (pick.mock.calls.length === 1) await held;
      return { name: suggestedName, createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
    });
    vi.stubGlobal("showSaveFilePicker", pick);
    await mount();
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
      expect(menu.actions.find((c) => c.id === "export-both")!.disabled).toBe(false);
    });
    await act(async () => {
      menu.actions.find((c) => c.id === command)!.run();
      await vi.waitFor(() => expect(pick).toHaveBeenCalledTimes(1), { timeout: 4000 });
    });
    await toggle("warning");
    await act(async () => {
      release();
      await vi.waitFor(() => expect(pick).toHaveBeenCalledTimes(2), { timeout: 4000 });
    });
    // Let the export finish, then check it confirmed nothing.
    await vi.waitFor(() => expect(menu.actions.find((c) => c.id === "export-both")!.disabled).toBe(false));
    expect(document.body.textContent).not.toContain("Saved ");
  });
}

/** Stubs the browser open picker to hand back `m` packed as a .master, with
 *  a handle whose writes succeed (so it can also be Save Master's target). */
function openMasterFile(m: Master, assets: Parameters<typeof packMaster>[1] = {}) {
  const bytes = packMaster(m, assets);
  const handle = {
    name: "other.master",
    getFile: async () => new File([bytes as unknown as BlobPart], "other.master"),
    createWritable: vi.fn(async () => ({ write: async () => {}, close: async () => {} })),
  };
  vi.stubGlobal("showOpenFilePicker", async () => [handle]);
  return handle;
}
const run = (id: string) => act(async () => { await menu.actions.find((c) => c.id === id)!.run(); await new Promise((r) => setTimeout(r, 10)); });
const reviewRows = () => document.querySelectorAll("[data-row]").length;

it("Open Master during a Save Master write keeps the opened master, its baseline and its save target", async () => {
  let finish!: () => void;
  const { pick } = picker(() => new Promise<void>((resolve) => { finish = resolve; }));
  await mount();
  await toggle("warning");
  await promoteWarning();
  const other = openMasterFile({ ...lolevMaster(), id: "master-other", name: "Other" });
  await run("master-open");
  await act(async () => { finish(); await new Promise((r) => setTimeout(r, 10)); });
  // The finished write must not pull the doc back to the saved master…
  expect(document.querySelector("#master-picker")?.textContent).toContain("Other");
  expect(document.body.textContent).not.toContain("Could not");
  // …nor move Other's baseline: its review lists only this label's override.
  await run("master-save");
  expect(reviewRows()).toBe(1);
  // …nor steal Other's save target: saving it writes to the file it came from.
  const save = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save Master")!;
  await act(async () => { save.click(); await new Promise((r) => setTimeout(r, 10)); });
  expect(pick).toHaveBeenCalledOnce();
  expect(other.createWritable).toHaveBeenCalledOnce();
});

it("Open Master's benched-values note survives the master's texture loading (#11)", async () => {
  class FakeBitmap { width = 10; height = 10; close() {} }
  vi.stubGlobal("ImageBitmap", FakeBitmap);
  vi.stubGlobal("createImageBitmap", async () => new FakeBitmap());
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() {} } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(new Blob(["png"])));
  const label = packLabel({ formatVersion: 3, masterId: "lolev", enabledVariants: [], values: { volume: "16 FL OZ" } }, {});
  await mount({ seq: 1, file: new File([label as unknown as BlobPart], "beer.label") });
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  const base = lolevMaster();
  openMasterFile({ ...base, id: "master-other", name: "Other", layers: base.layers.filter((l) => l.id !== "volume") },
    { texture: { name: "art.png", bytes: new Uint8Array([137, 80, 78, 71]) } });
  await run("master-open");
  // Opening a master that hides a filled value switches at once.
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(document.body.textContent).toContain("1 value(s) benched: volume");
});

/** A label filling `volume`, and a master without that layer to open over it. */
async function openHidingMaster() {
  const label = packLabel({ formatVersion: 3, masterId: "lolev", enabledVariants: [], values: { volume: "16 FL OZ" } }, {});
  await mount({ seq: 1, file: new File([label as unknown as BlobPart], "beer.label") });
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  const base = lolevMaster();
  const handle = openMasterFile({ ...base, id: "master-other", name: "Other", layers: base.layers.filter((l) => l.id !== "volume") });
  await run("master-open");
  return handle;
}

// No confirm card: the switch is one undoable step, and the note says so.
it("Open Master switches at once over hidden values, names them and ⌘Z, and undo restores them", async () => {
  await openHidingMaster();
  expect(document.querySelector("#master-picker-preview")).toBeNull();
  expect(document.querySelector("#master-picker")?.textContent).toContain("Other");
  expect(document.body.textContent).toMatch(/Switched to “Other” · 1 value\(s\) benched: volume · (⌘|Ctrl\+)Z to restore/);
  expect(localStorage.getItem("labellab.lastMaster")).toBe("master-other");
  expect(document.querySelector('[data-layer-id="volume"]')).toBeNull();
  await run("undo");
  expect(document.querySelector("#master-picker")?.textContent).toContain("Lolev");
  expect(document.querySelector('[data-layer-id="volume"]')).not.toBeNull();
});

it("Open Master leaves a collapsed sidebar collapsed", async () => {
  const label = packLabel({ formatVersion: 3, masterId: "lolev", enabledVariants: [], values: { volume: "16 FL OZ" } }, {});
  await mount({ seq: 1, file: new File([label as unknown as BlobPart], "beer.label") });
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  const sidebar = () => document.querySelector('[data-slot="sidebar"]')!.getAttribute("data-state");
  act(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true, cancelable: true })); });
  expect(sidebar()).toBe("collapsed");
  const base = lolevMaster();
  openMasterFile({ ...base, id: "master-other", name: "Other", layers: base.layers.filter((l) => l.id !== "volume") });
  await run("master-open");
  expect(sidebar()).toBe("collapsed");
});

it("Open Master over hidden values binds Save Master to the opened file", async () => {
  const other = await openHidingMaster();
  expect(document.querySelector("#master-picker")?.textContent).toContain("Other");
  await toggle("warning");
  await run("master-save");
  const save = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save Master")!;
  await act(async () => { save.click(); await new Promise((r) => setTimeout(r, 10)); });
  expect(other.createWritable).toHaveBeenCalledOnce();
});

// The master's art only fills slots the label left empty, so art the label
// already has wins over the opened master's texture.
it("Open Master keeps art the label already has", async () => {
  class FakeBitmap { width = 10; height = 10; close() {} }
  vi.stubGlobal("ImageBitmap", FakeBitmap);
  const decoded: string[] = [];
  vi.stubGlobal("createImageBitmap", async (f: Blob) => { decoded.push((f as File).name); return new FakeBitmap(); });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() {} } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(new Blob(["png"])));
  const label = packLabel({ formatVersion: 3, masterId: "lolev", enabledVariants: [], values: { volume: "16 FL OZ" } }, {});
  await mount({ seq: 1, file: new File([label as unknown as BlobPart], "beer.label") });
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  const art = new File(["ok"], "mine.png", { type: "image/png" });
  const e = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", { value: { types: ["Files"], items: [{ kind: "file", type: art.type }], files: [art] } });
  Object.defineProperty(e, "clientX", { value: 10 });
  await act(async () => { document.body.dispatchEvent(e); await new Promise((r) => setTimeout(r, 10)); });
  expect(decoded).toEqual(["mine.png"]);
  const base = lolevMaster();
  openMasterFile({ ...base, id: "master-other", name: "Other", layers: base.layers.filter((l) => l.id !== "volume") },
    { texture: { name: "master-art.png", bytes: new Uint8Array([137, 80, 78, 71]) } });
  await run("master-open");
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(document.querySelector("#master-picker")?.textContent).toContain("Other");
  expect(decoded).toEqual(["mine.png"]);
});

it("a promotion whose layer is deleted during the write doesn't cost the others", async () => {
  let finish!: () => void;
  picker(() => new Promise<void>((resolve) => { finish = resolve; }));
  await mount();
  await toggle("warning");
  await toggle("storeCold");
  await act(async () => menu.actions.find((c) => c.id === "master-save")!.run());
  for (const id of ["promote-warning-enabled", "promote-storeCold-enabled"]) {
    const row = document.querySelector(`[data-row="${id}"]`)!;
    await act(async () => (row.closest("label")!.querySelector("input") as HTMLInputElement).click());
  }
  const save = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save Master")!;
  await act(async () => save.click());
  const warning = document.querySelector('[data-layer-id="warning"] [data-slot="sidebar-menu-button"]') as HTMLElement;
  await act(async () => warning.click());
  await act(async () => { warning.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })); });
  expect(document.querySelector('[data-layer-id="warning"]')).toBeNull();
  await act(async () => { finish(); await new Promise((r) => setTimeout(r, 10)); });
  expect(document.body.textContent).not.toContain("Unknown layer");
  // Store cold's promotion still stands in the document, so the next review
  // can't offer to revert it — only the deletion the user really made.
  expect(document.querySelector('[data-layer-id="storeCold"] button[aria-label$=": enabled"]')?.getAttribute("aria-pressed")).toBe("false");
  await act(async () => menu.actions.find((c) => c.id === "master-save")!.run());
  expect(document.querySelector('[data-row*="storeCold"]')).toBeNull();
});

/** A .label handle whose `logo` value is `logo`, with `assets` embedded. */
function logoLabel(logo: string, assets: Parameters<typeof packLabel>[1] = {}, enabledVariants: string[] = []) {
  const bytes = packLabel({ formatVersion: 3, masterId: lolevMaster().id, enabledVariants, values: { logo } }, assets);
  return { seq: 1, handle: { name: "a.label", getFile: async () => new File([bytes as unknown as BlobPart], "a.label") } as unknown as FileSystemFileHandle };
}
/** Opens the review via `cmd`, ticks the logo image promotion, saves, and
 *  resolves with the bytes written. */
async function promoteLogo(cmd: string, written: () => Uint8Array | undefined) {
  await vi.waitFor(() => expect(document.querySelector('[data-layer-id="logo"]')).not.toBeNull());
  await run(cmd);
  const row = await vi.waitFor(() => {
    const r = document.querySelector('[data-row="promote-logo-asset-value"]');
    expect(r, [...document.querySelectorAll("[data-row]")].map((e) => e.getAttribute("data-row")).join()).not.toBeNull();
    return r!;
  });
  await act(async () => (row.closest("label")!.querySelector("input") as HTMLInputElement).click());
  const save = [...document.querySelectorAll("button")].find((b) => /^Save Master/.test(b.textContent?.trim() ?? "") && b.closest("[role=dialog]"))!;
  await act(async () => save.click());
  return vi.waitFor(() => { expect(written()).toBeDefined(); return written()!; });
}

// Save Master bundles a promoted image's bytes. A variant stores only the
// fields it changes, so a promotion into Collab writes `{ asset }` with no
// `kind` — the variant-target case is the one that used to ship without bytes.
it.each([
  { name: "base master", variants: [] as string[], cmd: "master-save", target: (m: Master) => m.layers.find((l) => l.id === "logo") },
  { name: "Collab variant", variants: ["collab"], cmd: "master-save", target: (m: Master) => m.variants.find((v) => v.id === "collab")!.layers.logo },
  { name: "Save Master As fork", variants: [] as string[], cmd: "master-save-as", target: (m: Master) => m.layers.find((l) => l.id === "logo") },
])("Save Master writes a promoted image value's bytes into the .master ($name)", async ({ variants, cmd, target }) => {
  vi.stubGlobal("createImageBitmap", async () => ({ width: 10, height: 5, close() {} }));
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"><rect width="10" height="5"/></svg>');
  let written: Uint8Array | undefined;
  picker(async (b) => { written = b; });
  await mount(logoLabel("img1", { customImages: { img1: { name: "script.svg", bytes: svg } } }, variants));
  const { master, assets } = unpackMaster(await promoteLogo(cmd, () => written));
  expect(target(master)).toMatchObject({ asset: "img1" });
  expect(assets.customImages?.img1?.name).toBe("script.svg");
  expect(assets.customImages?.img1?.bytes).toEqual(svg);
});

// A label whose value names an image its zip lacks: the promotion still
// writes the id, but no save can carry bytes that don't exist — say so.
it("Save Master notes a promoted image it has no file for", async () => {
  let written: Uint8Array | undefined;
  picker(async (b) => { written = b; });
  await mount(logoLabel("ghost"));
  await promoteLogo("master-save", () => written);
  await vi.waitFor(() => expect(document.body.textContent).toContain("1 image has no file to save"));
});
