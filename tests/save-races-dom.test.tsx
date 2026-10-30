// save-races-dom.test.tsx — App-level Save / Save Master write paths: pending
// writes, cancelled browser save targets, and what a Save Master bundles; and
// Open Master over hidden values. Export, save and open results are toasts, so
// the real <Toaster /> is mounted beside the editor (mount) and read from the
// document.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { fileDrag } from "./dom-drag";
import { mountToaster, settle, shown, toastTitles, unmountToaster } from "./real-timer-toaster";
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
  psdImages: async () => ({}), buildPsd: vi.fn(async () => new Uint8Array([3])),
}));
// The PSD plates flatten through drawPlate; here they only need a canvas.
vi.mock("../src/canvas/draw", () => ({ drawPlate: () => undefined }));
// A desktop save names the file by the path the dialog returned; browsers return a
// bare name. With `path` set, saveThrough answers as the desktop does.
const desktopSave = vi.hoisted(() => ({ path: null as string | null }));
vi.mock("../src/files", async (importOriginal) => {
  const files = await importOriginal<typeof import("../src/files")>();
  return {
    ...files,
    saveThrough: async (...args: Parameters<typeof files.saveThrough>) => {
      if (!desktopSave.path) return files.saveThrough(...args);
      const [content] = args;
      const bytes = typeof content === "function" ? content(desktopSave.path) : content;
      return { name: desktopSave.path, bytes, target: { path: desktopSave.path } };
    },
  };
});
import { DocumentEditor, type FileToOpen } from "../src/App";
import { buildPsd } from "../src/psd/build";
import { lolevMaster } from "../src/model/lolevLayers";
import { lolevMaster as lolevV1 } from "./fixtures/lolevV1";
import { packLabel, packMaster, unpackMaster } from "../src/model/files";
import type { Master } from "../src/model/layers";

let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  await unmountToaster();
  container?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  desktopSave.path = null;
});
async function mount(fileToOpen: FileToOpen | null = null, twoFilePdfExport = false) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await mountToaster();
  const saveSlot: { current: (() => Promise<boolean>) | null } = { current: null };
  const onMeta = vi.fn();
  const props = {
    active: true, fileToOpen, onOpenSettled: vi.fn(), onMeta, saveSlot,
    render: { ...DEFAULT_RENDER, twoFilePdfExport }, onRenderChange: vi.fn(), onOpenProject: vi.fn(),
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
function picker(write: (bytes: Uint8Array) => Promise<void> = async () => {}, name = "Beer.label") {
  const handle = { name, createWritable: vi.fn(async () => ({ write, close: async () => {} })) };
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
  await shown("Could not save label: Permission refused");
  expect(document.querySelector("[data-sonner-toast]")!.getAttribute("data-type")).toBe("error");
  expect(download).not.toHaveBeenCalled();
});
// A repeat of the same kind of failure replaces its toast instead of stacking another.
it("the same save failure twice shows one toast with the latest text", async () => {
  let attempts = 0;
  picker(async () => { throw new Error(attempts++ ? "Disk full" : "Permission refused"); });
  const { saveSlot } = await mount();
  await act(async () => { expect(await saveSlot.current!()).toBe(false); });
  await shown("Could not save label: Permission refused");
  await act(async () => { expect(await saveSlot.current!()).toBe(false); });
  await shown("Could not save label: Disk full");
  await settle();
  expect(toastTitles()).toEqual(["Could not save label: Disk full"]);
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

/** Opens the Save Master review, ticks the `ids` promotion rows, and saves. */
async function saveMasterPromoting(...ids: string[]) {
  await act(async () => menu.actions.find((c) => c.id === "master-save")!.run());
  for (const id of ids) {
    const row = await reviewRow(id);
    await act(async () => (row.closest("label")!.querySelector("input") as HTMLInputElement).click());
  }
  const save = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save Master")!;
  await act(async () => save.click());
}

// Real timers: the success toast fades after its own 4 s (src/notify.ts).
it("Save Master toasts Saved Lolev.master · 3 changes and it fades", async () => {
  picker(async () => {}, "Lolev.master");
  await mount();
  await toggle("warning");
  await toggle("storeCold");
  await reorderName();
  await saveMasterPromoting("promote-warning-enabled", "promote-storeCold-enabled");
  await shown("Saved Lolev.master");
  const saved = document.querySelector("[data-sonner-toast]")!;
  expect(saved.getAttribute("data-type")).toBe("success");
  expect(saved.querySelector("[data-title]")!.textContent).toBe("Saved Lolev.master");
  expect(saved.querySelector("[data-description]")!.textContent).toBe("3 changes");
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(toastTitles()).toEqual([]);
  }, { timeout: 15000 });
}, 30_000); // the fade alone takes 4 s of real time; vitest's default is 5 s

it("Save Master with no changes toasts Saved with no count", async () => {
  picker(async () => {}, "Lolev.master");
  await mount();
  await act(async () => { await menu.actions.find((c) => c.id === "master-save-as")!.run(); await new Promise((r) => setTimeout(r, 10)); });
  await shown("Saved Lolev.master");
  expect(toastTitles()).toEqual(["Saved Lolev.master"]);
  expect(document.querySelector("[data-sonner-toast] [data-description]")).toBeNull();
});

it("Save Master names the file by its base name when the desktop returns a path", async () => {
  desktopSave.path = "/Users/ted/masters/Lolev.master";
  await mount();
  await act(async () => { await menu.actions.find((c) => c.id === "master-save-as")!.run(); await new Promise((r) => setTimeout(r, 10)); });
  await shown("Saved Lolev.master");
  expect(toastTitles()).toEqual(["Saved Lolev.master"]);
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

// Opening a label swaps the texture and mask out with the old label, so a load
// error for the one it replaced must not stay over the new label.
it("a texture load error does not outlive opening another label", async () => {
  vi.stubGlobal("createImageBitmap", async () => { throw new Error("Invalid image"); });
  const { props } = await mount();
  await act(async () => { fileDrag("drop", new File(["bad"], "broken.png", { type: "image/png" })); });
  expect(document.body.textContent).toContain('Could not load texture "broken.png": Invalid image');
  const label = packLabel({ formatVersion: 3, masterId: "lolev", enabledVariants: [], values: {} }, {});
  await act(async () => root.render(createElement(DocumentEditor, {
    ...props, fileToOpen: { seq: 1, file: new File([label as unknown as BlobPart], "beer.label") },
  })));
  await vi.waitFor(() => expect(props.onOpenSettled).toHaveBeenCalledWith(1, false), { timeout: 15000 });
  await act(async () => {});
  expect(document.body.textContent).not.toContain("Could not load texture");
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

// Export PSD saves one file (White Ink is a spot channel inside it), so it
// opens a single dialog and confirms that one file.
/** A 2D context just able to flatten a plate: getImageData hands back a
 *  plate of the size asked for, red channel `red`. */
function flatCanvas(red: number) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    resetTransform() {}, clearRect() {},
    getImageData: (_x: number, _y: number, width: number, height: number) =>
      ({ data: new Uint8ClampedArray([red, 0, 0, 255]), width, height }),
  } as never);
}

it("psd: Export PSD saves one PSD with the mask plate as White Ink, and names it", async () => {
  const pick = vi.fn(async ({ suggestedName }: { suggestedName: string }) => (
    { name: suggestedName, createWritable: async () => ({ write: async () => {}, close: async () => {} }) }));
  vi.stubGlobal("showSaveFilePicker", pick);
  flatCanvas(0);
  vi.mocked(buildPsd).mockClear();
  await mount();
  await act(async () => {
    menu.actions.find((c) => c.id === "export-psd")!.run();
    await vi.waitFor(() => expect(pick).toHaveBeenCalledOnce(), { timeout: 15000 });
  });
  const [name] = pick.mock.calls[0].map((options) => options.suggestedName);
  expect(name).toMatch(/\.psd$/);
  expect(name).not.toMatch(/-mask\.psd$/);
  await shown(`Saved ${name}`);
  expect(pick).toHaveBeenCalledOnce();
  // One build, the art plate, carrying both flattened plates.
  expect(vi.mocked(buildPsd).mock.calls.map(([, , mode, opts]) => [mode, !!opts?.composite, opts?.whiteInk?.data[0]]))
    .toEqual([["art", true, 0]]);
});

// No canvas means no White Ink plate: the print PSD fails instead of saving
// a print file without it.
it("psd: Export PSD without a canvas reports it and saves nothing", async () => {
  const pick = vi.fn();
  vi.stubGlobal("showSaveFilePicker", pick);
  await mount();
  await act(async () => { menu.actions.find((c) => c.id === "export-psd")!.run(); });
  // DOM updates land when an act() settles, so each poll flushes one.
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.body.textContent).toContain("No canvas to draw the White Ink plate.");
  }, { timeout: 15000 });
  expect(toastTitles()).toEqual([expect.stringMatching(/^Couldn't save .+\.psd$/)]);
  expect(pick).not.toHaveBeenCalled();
});

for (const [command, extension] of [["export-both", "pdf"], ["export-psds", "psd"]]) {
  it(`${extension}: cancelling artwork stops the pair (#254)`, async () => {
    const { pick } = picker();
    pick.mockRejectedValueOnce(new DOMException("Cancelled", "AbortError"));
    await mount(null, true);
    await act(async () => {
      menu.actions.find((c) => c.id === command)!.run();
      await vi.waitFor(() => expect(pick).toHaveBeenCalled(), { timeout: 4000 });
    });
    expect(pick, document.body.textContent ?? "").toHaveBeenCalledOnce();
    // A cancel is the user's own choice: nothing was saved, so nothing is said.
    await settle();
    expect(toastTitles()).toEqual([]);
  });
  it(`${extension}: Export again after a pair cancelled at the mask re-runs the ${extension} pair, asking`, async () => {
    const pick = vi.fn(async ({ suggestedName }: { suggestedName: string }) => {
      if (pick.mock.calls.length === 2) throw new DOMException("Cancelled", "AbortError");
      return { name: suggestedName, createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
    });
    vi.stubGlobal("showSaveFilePicker", pick);
    await mount(null, true);
    await act(async () => {
      menu.actions.find((c) => c.id === command)!.run();
      await vi.waitFor(() => expect(pick).toHaveBeenCalledTimes(2), { timeout: 4000 });
    });
    await shown("wasn't saved");
    expect(toastTitles()).toEqual([expect.stringMatching(new RegExp(`-mask\\.${extension} wasn't saved$`))]);

    const again = [...document.querySelectorAll("button")].find((b) => b.textContent === "Export again")!;
    await act(async () => {
      again.click();
      await vi.waitFor(() => expect(pick).toHaveBeenCalledTimes(4), { timeout: 4000 });
    });
    // The same pair again: the art file's dialog first, then the mask's.
    const [art, mask, artAgain, maskAgain] = pick.mock.calls.map(([options]) => options.suggestedName);
    expect([artAgain, maskAgain]).toEqual([art, mask]);
    await shown(`Saved ${art}, ${mask}`);
  });
  // Export again runs the menu's own export command, so it obeys the same gate:
  // a label made invalid since the warning exports nothing.
  it(`${extension}: Export again does nothing once the label is blocked`, async () => {
    const pick = vi.fn(async ({ suggestedName }: { suggestedName: string }) => {
      if (pick.mock.calls.length === 2) throw new DOMException("Cancelled", "AbortError");
      return { name: suggestedName, createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
    });
    vi.stubGlobal("showSaveFilePicker", pick);
    const { props } = await mount(null, true);
    await act(async () => {
      menu.actions.find((c) => c.id === command)!.run();
      await vi.waitFor(() => expect(pick).toHaveBeenCalledTimes(2), { timeout: 4000 });
    });
    await shown("wasn't saved");

    // The label is replaced by one with an invalid barcode, which blocks export.
    const invalid = packLabel({ formatVersion: 3, masterId: "lolev", enabledVariants: [], values: { barcode: "123" } }, {});
    await act(async () => root.render(createElement(DocumentEditor, {
      ...props, fileToOpen: { seq: 1, file: new File([invalid as unknown as BlobPart], "bad.label") },
    })));
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(menu.actions.find((c) => c.id === command)!.disabled).toBe(true);
    }, { timeout: 15000 });

    const again = [...document.querySelectorAll("button")].find((b) => b.textContent === "Export again")!;
    await act(async () => { again.click(); });
    await settle();
    expect(pick).toHaveBeenCalledTimes(2);
  });
  it(`${extension}: a refused mask write reports the saved artwork (#254)`, async () => {
    let writes = 0;
    const { pick, handle } = picker(async () => { if (++writes === 2) throw new Error("Disk full"); });
    handle.name = `renamed-art.${extension}`;
    await mount(null, true);
    await act(async () => {
      menu.actions.find((c) => c.id === command)!.run();
      await vi.waitFor(() => expect(pick).toHaveBeenCalledTimes(2), { timeout: 4000 });
    });
    await shown("Disk full");
    expect(toastTitles()).toEqual([expect.stringMatching(new RegExp(`^Couldn't save .+-mask\\.${extension}$`))]);
    expect(document.body.textContent).toContain(`Saved renamed-art.${extension}. Disk full`);
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
    await mount(null, true);
    await act(async () => {
      menu.actions.find((c) => c.id === command)!.run();
      await vi.waitFor(() => expect(pick).toHaveBeenCalledTimes(2), { timeout: 4000 });
    });
    const [art, mask] = pick.mock.calls.map(([options]) => options.suggestedName);
    await shown(`Saved ${art}, ${mask}`);
    expect(toastTitles()).toEqual([`Saved ${art}, ${mask}`]);
    expect(document.querySelector("[data-sonner-toast]")!.getAttribute("data-type")).toBe("success");
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
    await mount(null, true);
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
    await vi.waitFor(() => expect(menu.actions.find((c) => c.id === command)!.disabled).toBe(false));
    await settle();
    expect(toastTitles()).toEqual([]);
  });
  it(`${extension}: the result toasts even when the tab went to the background`, async () => {
    // The dialog stays open while the user switches to another tab.
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const pick = vi.fn(async ({ suggestedName }: { suggestedName: string }) => {
      if (pick.mock.calls.length === 1) await held;
      return { name: suggestedName, createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
    });
    vi.stubGlobal("showSaveFilePicker", pick);
    const { props } = await mount(null, true);
    await act(async () => {
      menu.actions.find((c) => c.id === command)!.run();
      await vi.waitFor(() => expect(pick).toHaveBeenCalledTimes(1), { timeout: 4000 });
    });
    await act(async () => root.render(createElement(DocumentEditor, { ...props, active: false })));
    await act(async () => {
      release();
      await vi.waitFor(() => expect(pick).toHaveBeenCalledTimes(2), { timeout: 4000 });
    });
    const [art, mask] = pick.mock.calls.map(([options]) => options.suggestedName);
    await shown(`Saved ${art}, ${mask}`);
  });
}

// Export again goes through the live command table, so an edit made since the
// cancelled export is what the re-run builds.
it("psd: Export again after an edit builds the edited label", async () => {
  const pick = vi.fn(async ({ suggestedName }: { suggestedName: string }) => {
    if (pick.mock.calls.length === 2) throw new DOMException("Cancelled", "AbortError");
    return { name: suggestedName, createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
  });
  vi.stubGlobal("showSaveFilePicker", pick);
  flatCanvas(0);
  vi.mocked(buildPsd).mockClear();
  await mount(null, true);
  await act(async () => {
    menu.actions.find((c) => c.id === "export-psds")!.run();
    await vi.waitFor(() => expect(pick).toHaveBeenCalledTimes(2), { timeout: 15000 });
  });
  await shown("wasn't saved");
  const layerIds = () => vi.mocked(buildPsd).mock.calls.at(-1)![3]!.layers!.map((layer) => layer.id);
  expect(layerIds()).toContain("warning");

  await toggle("warning"); // the edit
  const again = [...document.querySelectorAll("button")].find((b) => b.textContent === "Export again")!;
  await act(async () => {
    again.click();
    await vi.waitFor(() => expect(pick).toHaveBeenCalledTimes(4), { timeout: 15000 });
  });
  expect(layerIds()).not.toContain("warning");
  await shown("Saved "); // the re-run finished
});

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
  // …nor announce a save of the master the document left.
  await settle();
  expect(toastTitles()).toEqual([]);
  // …nor move Other's baseline: its review lists only this label's override.
  await run("master-save");
  expect(reviewRows()).toBe(1);
  // …nor steal Other's save target: saving it writes to the file it came from.
  const save = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save Master")!;
  await act(async () => { save.click(); await new Promise((r) => setTimeout(r, 10)); });
  expect(pick).toHaveBeenCalledOnce();
  expect(other.createWritable).toHaveBeenCalledOnce();
});

it("the benched-values toast survives the master's texture loading (#11)", async () => {
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
  await shown("volume");
  // Its texture then loads; the toast is not the texture's to clear.
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(toastTitles()).toEqual(["Switched to “Other”"]);
  expect(document.querySelector("[data-sonner-toast] [data-description]")!.textContent).toContain("volume");
});

/** A label filling `volume`, and a master without that layer to open over it. */
async function openHidingMaster() {
  const label = packLabel({ formatVersion: 3, masterId: "lolev", enabledVariants: [], values: { volume: "16 FL OZ" } }, {});
  const { onMeta } = await mount({ seq: 1, file: new File([label as unknown as BlobPart], "beer.label") });
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  const base = lolevMaster();
  const handle = openMasterFile({ ...base, id: "master-other", name: "Other", layers: base.layers.filter((l) => l.id !== "volume") });
  await run("master-open");
  return { ...handle, onMeta };
}

// No confirm card: the switch is one undoable step, and the toast offers the undo.
it("Open Master over hidden values offers Undo, which restores them", async () => {
  const { onMeta } = await openHidingMaster();
  expect(document.querySelector("#master-picker-preview")).toBeNull();
  expect(document.querySelector("#master-picker")?.textContent).toContain("Other");
  expect(localStorage.getItem("labellab.lastMaster")).toBe("master-other");
  expect(document.querySelector('[data-layer-id="volume"]')).toBeNull();
  // The toast names the master, what was set aside, and carries the Undo.
  await shown("Switched to “Other”");
  const toast = document.querySelector("[data-sonner-toast]")!;
  expect(toast.getAttribute("data-type")).toBe("info");
  expect(toast.querySelector("[data-description]")!.textContent).toContain("volume");
  expect(toast.textContent).not.toContain("Note:");
  const undo = [...toast.querySelectorAll("button")].find((b) => b.textContent === "Undo")!;
  onMeta.mockClear();
  await act(async () => undo.click());
  expect(document.querySelector("#master-picker")?.textContent).toContain("Lolev");
  expect(document.querySelector('[data-layer-id="volume"]')).not.toBeNull();
  // Like ⌘Z, the undo is an edit: the tab reads as changed.
  expect(onMeta.mock.lastCall?.[0]).toMatchObject({ dirty: true });
});

// The undo is the switch's own: once the label has moved on, the offer no
// longer reaches past the user's later edit to undo the switch.
it("the Undo offer does nothing once the label was edited", async () => {
  await openHidingMaster();
  await shown("Switched to “Other”");
  await toggle("warning");
  const undo = [...document.querySelectorAll<HTMLButtonElement>("[data-sonner-toast] button")].find((b) => b.textContent === "Undo")!;
  await act(async () => undo.click());
  expect(document.querySelector("#master-picker")?.textContent).toContain("Other");
  expect(warningPressed()).toBe("false");
});

it("⌘Z restores the master the toast's Undo would", async () => {
  await openHidingMaster();
  await run("undo");
  expect(document.querySelector("#master-picker")?.textContent).toContain("Lolev");
  expect(document.querySelector('[data-layer-id="volume"]')).not.toBeNull();
});

/** Stubs the browser open picker to hand back `bytes` as other.master. */
function stubMasterBytes(bytes: Uint8Array) {
  vi.stubGlobal("showOpenFilePicker", async () => [
    { name: "other.master", getFile: async () => new File([bytes as unknown as BlobPart], "other.master") }]);
}

// A v1 master converts on the way in, with the converter's warnings: one toast
// for the open, the warnings joined, with no "Note:" lead-in.
it("Open Master shows a converted master's warnings in one toast, without Note:", async () => {
  const old = lolevV1();
  old.layers = [...old.layers, { id: "mystery", name: "?", enabled: true }];
  old.defaults = { mystery: 1 } as never;
  stubMasterBytes(new TextEncoder().encode(JSON.stringify(old)));
  await mount();
  await run("master-open");
  await shown("mystery");
  await settle();
  expect(toastTitles()).toHaveLength(1);
  expect(toastTitles()[0]).not.toContain("Note:");
  expect(document.querySelector("[data-sonner-toast]")!.getAttribute("data-type")).toBe("warning");
});

it("opening a converted master twice shows its warnings once", async () => {
  const old = lolevV1();
  old.layers = [...old.layers, { id: "mystery", name: "?", enabled: true }];
  old.defaults = { mystery: 1 } as never;
  stubMasterBytes(new TextEncoder().encode(JSON.stringify(old)));
  await mount();
  await run("master-open");
  await shown("mystery");
  await run("master-open");
  await settle();
  expect(toastTitles()).toHaveLength(1);
});

it("opening a second label with benched values replaces the first one's warning", async () => {
  const benched = (layer: string) => new File([packLabel(
    { formatVersion: 3, masterId: "lolev", enabledVariants: [], values: { [layer]: "stale" } }, {}) as unknown as BlobPart], `${layer}.label`);
  const { props } = await mount({ seq: 1, file: benched("gone-one") });
  await shown("gone-one");
  await act(async () => root.render(createElement(DocumentEditor, { ...props, fileToOpen: { seq: 2, file: benched("gone-two") } })));
  await shown("gone-two");
  await settle();
  expect(toastTitles()).toHaveLength(1);
  expect(toastTitles()[0]).toContain("gone-two");
});

it("Open Master reports a file that is not a master as an error toast", async () => {
  stubMasterBytes(new TextEncoder().encode("not a master"));
  await mount();
  await run("master-open");
  await shown("Could not open master: ");
  expect(document.querySelector("[data-sonner-toast]")!.getAttribute("data-type")).toBe("error");
  expect(document.querySelector("#master-picker")?.textContent).toContain("Lolev");
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
// writes the id, but no save can carry bytes that don't exist — say so, in a
// toast of its own that stays until closed.
it("an image with no file to save warns in its own toast", async () => {
  let written: Uint8Array | undefined;
  picker(async (b) => { written = b; }, "Lolev.master");
  await mount(logoLabel("ghost"));
  await promoteLogo("master-save", () => written);
  const sentence = "1 image has no file to save. It will be blank when you reopen this master.";
  await shown(sentence);
  const toasts = [...document.querySelectorAll("[data-sonner-toast]")];
  const warning = toasts.find((li) => li.getAttribute("data-type") === "warning")!;
  expect(warning.querySelector("[data-title]")!.textContent).toBe(sentence);
  expect(warning.querySelector("[data-description]")).toBeNull();
  const saved = toasts.find((li) => li.getAttribute("data-type") === "success")!;
  expect(saved.querySelector("[data-title]")!.textContent).toBe("Saved Lolev.master");
  expect(saved.textContent).not.toContain("no file");
  expect(toasts).toHaveLength(2);
});
