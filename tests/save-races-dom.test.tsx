// save-races-dom.test.tsx — App-level Save / Save Master write paths: pending
// writes, cancelled browser save targets, and what a Save Master bundles; and
// Open Master over hidden values, and the Switched toast that follows it. Export,
// save and open results are toasts, so the real <Toaster /> is mounted beside
// the editor (mount) and read from the document. The native menu's errors are
// toasts too: AppMenu is mocked, and the test calls the callback App gives it.
// The last section covers which toasts go with the tab, which survive a Save or
// a master switch, and the error paths of opening and saving (a promotion and a
// boot restore that fail are simulated by mocks: no user action reaches them).
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { fileDrag } from "./dom-drag";
import { headerMessages, mountToaster, removedFlags, settle, shown, toastTitles, unmountToaster } from "./real-timer-toaster";
import type { Command } from "../src/components/CommandMenu";

const menu = vi.hoisted(() => ({
  actions: [] as Command[], renderError: null as null | ((m: string) => void),
  /** AppMenu's onNativeError: `source` is "quit" for a failed Quit. */
  nativeError: (_message: string, _source?: "quit") => {},
  /** When set, loading the label's font faces fails with this message. */
  fontError: "",
  /** When set, Save Master's promotion step (applyPromotions) throws this. */
  promoteError: "",
  /** When set, a new tab's boot restore (resolveDefaultMaster) fails with this. */
  restoreError: "",
}));
vi.mock("../src/components/PreviewCompare", () => ({
  PreviewCompare: (p: { onRenderError: (m: string) => void }) => { menu.renderError = p.onRenderError; return null; },
}));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/components/AppMenu", () => ({
  AppMenu: (p: { actions: Command[]; onNativeError: typeof menu.nativeError }) => {
    menu.actions = p.actions; menu.nativeError = p.onNativeError; return null;
  },
}));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => {
    if (menu.fontError) throw new Error(menu.fontError);
    return (t: string, s: number) => t.length * s * 0.55;
  },
  labelFontCss: () => "sans-serif", FONT_URLS: { poppins: {} },
}));
vi.mock("../src/pdf/fonts", async () => {
  const { assets } = await import("./fixtures");
  return { loadFonts: async () => assets.fonts };
});
// No promotion a user can tick fails parseMaster's validation, so the throw
// stands in for it (and for a boot restore that cannot read the library).
vi.mock("../src/model/editSave", async (importOriginal) => {
  const editSave = await importOriginal<typeof import("../src/model/editSave")>();
  return {
    ...editSave,
    applyPromotions: (...args: Parameters<typeof editSave.applyPromotions>) => {
      if (menu.promoteError) throw new Error(menu.promoteError);
      return editSave.applyPromotions(...args);
    },
  };
});
vi.mock("../src/masters", async (importOriginal) => {
  const masters = await importOriginal<typeof import("../src/masters")>();
  return {
    ...masters,
    resolveDefaultMaster: async () => {
      if (menu.restoreError) throw new Error(menu.restoreError);
      return masters.resolveDefaultMaster();
    },
  };
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
  menu.fontError = "";
  menu.promoteError = "";
  menu.restoreError = "";
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
  /** The last step of a write: once it has run, the save is about to report. */
  const close = vi.fn(async () => {});
  const handle = { name, createWritable: vi.fn(async () => ({ write, close })) };
  const pick = vi.fn(async () => handle);
  vi.stubGlobal("showSaveFilePicker", pick);
  return { handle, pick, close };
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
}, 30_000);
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
}, 30_000);
// A failed Save is a problem with that Save: the next one that works ends it.
it("a save failure's toast goes when the next save succeeds", async () => {
  let attempts = 0;
  picker(async () => { if (!attempts++) throw new Error("Disk full"); });
  const { saveSlot } = await mount();
  await act(async () => { expect(await saveSlot.current!()).toBe(false); });
  await shown("Could not save label: Disk full");
  await act(async () => { expect(await saveSlot.current!()).toBe(true); });
  await vi.waitFor(() => expect(toastTitles()).toEqual([]), { timeout: 3000 });
}, 30_000);
// Only a Save's own failure: an open failure is still true after a Save works.
it("a successful save leaves an open failure's toast up", async () => {
  picker();
  const { saveSlot } = await mount({ seq: 1, file: new File(["not a label"], "bad.label") });
  await shown("Could not open bad.label");
  const failure = toastTitles();
  expect(failure).toHaveLength(1);
  await act(async () => { expect(await saveSlot.current!()).toBe(true); });
  // Long enough for a dismissal to reach the toast: Sonner marks it removed
  // (data-removed) before its exit finishes.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
  expect(toastTitles()).toEqual(failure);
  expect(document.querySelector("[data-sonner-toast]")!.getAttribute("data-removed")).toBe("false");
}, 30_000);
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
}, 30_000);

it("Save Master names the file by its base name when the desktop returns a path", async () => {
  desktopSave.path = "/Users/ted/masters/Lolev.master";
  await mount();
  await act(async () => { await menu.actions.find((c) => c.id === "master-save-as")!.run(); await new Promise((r) => setTimeout(r, 10)); });
  await shown("Saved Lolev.master");
  expect(toastTitles()).toEqual(["Saved Lolev.master"]);
}, 30_000);

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

/** Drops `file` on the preview: the left half takes it as the texture, the
 *  right half as the mask. */
async function dropArt(file: File, clientX = 10) {
  const e = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", { value: { types: ["Files"], items: [{ kind: "file", type: file.type }], files: [file] } });
  Object.defineProperty(e, "clientX", { value: clientX });
  await act(async () => { document.body.dispatchEvent(e); await new Promise((r) => setTimeout(r, 10)); });
}
const textureFile = (name: string) => new File([name], name, { type: "image/png" });
/** Opens the Background well and waits until it shows `name`: the texture
 *  decoded and was adopted, which is when its slot's error would be cleared. */
async function textureShown(name: string) {
  await act(async () => (document.querySelector('[data-layer-id="background"] [data-slot="sidebar-menu-button"]') as HTMLElement).click());
  await vi.waitFor(() => expect(document.body.textContent).toContain(name), { timeout: 5_000 });
}
/** Decodes succeed, except for the files `broken` names; the canvas is stubbed
 *  for the preview pass. */
function stubDecoding(broken: string[]) {
  class FakeBitmap { width = 10; height = 10; close() {} }
  vi.stubGlobal("ImageBitmap", FakeBitmap);
  vi.stubGlobal("createImageBitmap", async (f: Blob) => {
    if (broken.includes((f as File).name)) throw new Error("Invalid image");
    return new FakeBitmap();
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() {} } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(new Blob(["png"])));
}
const TEXTURE_FAILED = 'Could not load texture "broken.png": Invalid image';
const toastTypes = () => [...document.querySelectorAll("[data-sonner-toast]")].map((el) => el.getAttribute("data-type"));

it("reports a failed texture decode without an unhandled rejection (#266)", async () => {
  vi.stubGlobal("createImageBitmap", async () => { throw new Error("Invalid image"); });
  await mount();
  await act(async () => { fileDrag("drop", new File(["bad"], "broken.png", { type: "image/png" })); });
  await shown(TEXTURE_FAILED);
  expect(toastTitles()).toEqual([TEXTURE_FAILED]);
}, 30_000);

// The error belongs to the texture slot: it stays on screen (no fade) until a
// texture that decodes replaces the broken one.
it("a texture that fails to decode keeps an error toast until a good texture replaces it", async () => {
  stubDecoding(["broken.png"]);
  await mount();
  await dropArt(textureFile("broken.png"));
  await shown(TEXTURE_FAILED);
  expect(toastTypes()).toEqual(["error"]);
  await settle();
  expect(toastTitles()).toEqual([TEXTURE_FAILED]);
  expect(removedFlags()).toEqual(["false"]);
  await dropArt(textureFile("art.png"));
  await vi.waitFor(() => expect(toastTitles()).toEqual([]), { timeout: 5_000 });
}, 30_000);

// Opening a label swaps the texture and mask out with the old label, so a load
// error for the one it replaced must not stay over the new label.
it("a texture load error does not outlive opening another label", async () => {
  vi.stubGlobal("createImageBitmap", async () => { throw new Error("Invalid image"); });
  const { props } = await mount();
  await act(async () => { fileDrag("drop", new File(["bad"], "broken.png", { type: "image/png" })); });
  await shown(TEXTURE_FAILED);
  expect(toastTitles()).toEqual([TEXTURE_FAILED]);
  const label = packLabel({ formatVersion: 3, masterId: "lolev", enabledVariants: [], values: {} }, {});
  await act(async () => root.render(createElement(DocumentEditor, {
    ...props, fileToOpen: { seq: 1, file: new File([label as unknown as BlobPart], "beer.label") },
  })));
  await vi.waitFor(() => expect(props.onOpenSettled).toHaveBeenCalledWith(1, false), { timeout: 15000 });
  await vi.waitFor(() => expect(toastTitles()).toEqual([]), { timeout: 5_000 });
}, 30_000);

it("a texture that loads keeps another slot's error on screen", async () => {
  stubDecoding(["broken-mask.png"]);
  await mount();
  const maskFailed = 'Could not load mask "broken-mask.png": Invalid image';
  await dropArt(textureFile("broken-mask.png"), window.innerWidth - 10);
  await shown(maskFailed);
  await dropArt(textureFile("art.png"));
  await textureShown("art.png");
  await settle();
  expect(toastTitles()).toEqual([maskFailed]);
  expect(removedFlags()).toEqual(["false"]);
}, 30_000);

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
}, 30_000);

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
}, 30_000);

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
    // The export has ended (its row is enabled again) before anything is checked.
    await vi.waitFor(() => expect(menu.actions.find((c) => c.id === command)!.disabled).toBe(false), { timeout: 5_000 });
    await settle();
    expect(toastTitles()).toEqual([]);
  }, 30_000);
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
  }, 30_000);
  // The pair's As… command is gone once two-file export is switched off; the
  // warning's Export again then runs the format's single-file As… command.
  it(`${extension}: Export again after two-file export was switched off asks for the single ${extension}`, async () => {
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

    await act(async () => root.render(createElement(DocumentEditor, { ...props, render: { ...DEFAULT_RENDER, twoFilePdfExport: false } })));
    expect(menu.actions.some((c) => c.id === command)).toBe(false);
    const again = [...document.querySelectorAll("button")].find((b) => b.textContent === "Export again")!;
    if (extension === "psd") {
      // The print PSD needs a canvas for its White Ink plate, which happy-dom
      // lacks: it fails before any dialog, which shows the single-file export ran.
      await act(async () => { again.click(); });
      await shown("No canvas to draw the White Ink plate.");
      expect(pick).toHaveBeenCalledTimes(2);
      return;
    }
    await act(async () => {
      again.click();
      await vi.waitFor(() => expect(pick).toHaveBeenCalledTimes(3), { timeout: 4000 });
    });
    expect(pick.mock.calls[2][0].suggestedName).toMatch(/^(?!.*-mask).*\.pdf$/);
    await shown("Saved ");
  }, 30_000);
  // Export again runs the menu's own export command, so it obeys the same gate:
  // a label made invalid since the warning exports nothing and says why.
  it(`${extension}: Export again on a blocked label shows Can't export yet and exports nothing`, async () => {
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
    // The export row stays enabled on a blocked label; the status region says
    // the label is blocked.
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.querySelector("[data-export-blocked-status]")!.textContent).toContain("Barcode");
    }, { timeout: 15000 });
    expect(menu.actions.find((c) => c.id === command)!.disabled).toBeFalsy();

    const again = [...document.querySelectorAll("button")].find((b) => b.textContent === "Export again")!;
    await act(async () => { again.click(); });
    await shown("Can't export yet");
    // Export again's own warning is gone; only the blocked toast is left.
    await vi.waitFor(() => expect(toastTitles()).toEqual(["Can't export yet"]), { timeout: 5_000 });
    expect(pick).toHaveBeenCalledTimes(2);
  }, 30_000);
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
  }, 30_000);
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
  }, 30_000);
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
  }, 30_000);
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
}, 30_000);

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
  const { pick, close } = picker(() => new Promise<void>((resolve) => { finish = resolve; }));
  await mount();
  await toggle("warning");
  await promoteWarning();
  const other = openMasterFile({ ...lolevMaster(), id: "master-other", name: "Other" });
  await run("master-open");
  await act(async () => finish());
  // The write's last step has run; the commit after it takes a moment more.
  await vi.waitFor(() => expect(close).toHaveBeenCalled(), { timeout: 5_000 });
  await settle();
  // The finished write must not pull the doc back to the saved master…
  expect(document.querySelector("#master-picker")?.textContent).toContain("Other");
  expect(document.body.textContent).not.toContain("Could not");
  // …nor announce a save of the master the document left.
  expect(toastTitles()).toEqual([]);
  // …nor move Other's baseline: its review lists only this label's override.
  await run("master-save");
  expect(reviewRows()).toBe(1);
  // …nor steal Other's save target: saving it writes to the file it came from.
  const save = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save Master")!;
  await act(async () => { save.click(); await new Promise((r) => setTimeout(r, 10)); });
  expect(pick).toHaveBeenCalledOnce();
  expect(other.createWritable).toHaveBeenCalledOnce();
}, 30_000);

it("the benched-values toast survives the master's texture loading (#11)", async () => {
  class FakeBitmap { width = 10; height = 10; close() {} }
  // The decode is held until the toast is on screen: Sonner takes a dismissal
  // sent in the same tick as the toast it names for the toast's own creation.
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  vi.stubGlobal("ImageBitmap", FakeBitmap);
  vi.stubGlobal("createImageBitmap", async () => { await held; return new FakeBitmap(); });
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
  // Its texture then loads, which the Background well shows once it has; the
  // toast is not the texture's to clear.
  await act(async () => release());
  await textureShown("art.png");
  await settle();
  expect(toastTitles()).toEqual(["Switched to “Other”"]);
  expect(removedFlags()).toEqual(["false"]);
  expect(document.querySelector("[data-sonner-toast] [data-description]")!.textContent).toContain("volume");
}, 30_000);

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

// A second switch replaces the first one's toast rather than stacking beside it.
it("two quick master switches leave one Switched toast", async () => {
  const label = packLabel({
    formatVersion: 3, masterId: "lolev", enabledVariants: [], values: { volume: "16 FL OZ", abv: "5%" },
  }, {});
  await mount({ seq: 1, file: new File([label as unknown as BlobPart], "beer.label") });
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  const base = lolevMaster();
  openMasterFile({ ...base, id: "master-other", name: "Other", layers: base.layers.filter((l) => l.id !== "volume") });
  await run("master-open");
  await shown("Switched to “Other”");
  openMasterFile({ ...base, id: "master-third", name: "Third", layers: base.layers.filter((l) => l.id !== "abv") });
  await run("master-open");
  await shown("Switched to “Third”");
  await settle();
  expect(toastTitles()).toEqual(["Switched to “Third”"]);
}, 30_000);

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
}, 30_000);

// The undo is the switch's own: once the document has moved on, its Undo could
// only do nothing, so the toast goes with the edit rather than offer it.
it("the Switched toast is dismissed once the label is edited", async () => {
  await openHidingMaster();
  await shown("Switched to “Other”");
  await toggle("warning");
  await vi.waitFor(() => expect(toastTitles()).toEqual([]), { timeout: 5_000 });
  // The edit stands; nothing undid the switch.
  expect(document.querySelector("#master-picker")?.textContent).toContain("Other");
  expect(warningPressed()).toBe("false");
}, 30_000);

// The toast leaves with an exit animation, and its Undo button stays clickable
// until it is gone. A click in that window must not undo the switch the edit has
// since moved past (the guard in commitRebind's action). The button is held from
// before the edit, as a click that lands mid-exit would hold it.
it("the Undo of a Switched toast that is leaving does nothing", async () => {
  await openHidingMaster();
  await shown("Switched to “Other”");
  const undo = [...document.querySelectorAll<HTMLButtonElement>("[data-sonner-toast] button")]
    .find((b) => b.textContent === "Undo")!;
  await toggle("warning");
  // Not gone yet: otherwise a click here would reach no handler and prove nothing.
  expect(undo.isConnected).toBe(true);
  await act(async () => undo.click());
  expect(document.querySelector("#master-picker")?.textContent).toContain("Other");
  expect(document.querySelector('[data-layer-id="volume"]')).toBeNull();
  expect(warningPressed()).toBe("false");
}, 30_000);

// Its Undo acts on this editor's document, so it must not outlive the tab.
it("closing the tab dismisses its Switched toast", async () => {
  await openHidingMaster();
  await shown("Switched to “Other”");
  await act(async () => root.unmount());
  await vi.waitFor(() => expect(toastTitles()).toEqual([]), { timeout: 5_000 });
}, 30_000);

// "Could not quit" is its own failure: it must not replace the install or
// update error the menu reported, nor be replaced by one.
it("a failed Quit and a failed menu install are two toasts", async () => {
  await mount();
  await act(async () => { menu.nativeError("Could not install the native menu: no icon"); });
  await shown("Could not install the native menu: no icon");
  await act(async () => { menu.nativeError("Could not quit: window is gone", "quit"); });
  await shown("Could not quit: window is gone");
  expect([...toastTitles()].sort()).toEqual([
    "Could not install the native menu: no icon", "Could not quit: window is gone"]);
  // A repeat of either still replaces its own.
  await act(async () => { menu.nativeError("Could not update the native menu: busy"); });
  await shown("Could not update the native menu: busy");
  await settle();
  expect([...toastTitles()].sort()).toEqual([
    "Could not quit: window is gone", "Could not update the native menu: busy"]);
});

it("⌘Z restores the master the toast's Undo would", async () => {
  await openHidingMaster();
  await run("undo");
  expect(document.querySelector("#master-picker")?.textContent).toContain("Lolev");
  expect(document.querySelector('[data-layer-id="volume"]')).not.toBeNull();
});

/** Stubs the browser open picker to hand back `bytes` as other.master. */
function stubMasterBytes(bytes: Uint8Array) {
  const getFile = vi.fn(async () => new File([bytes as unknown as BlobPart], "other.master"));
  vi.stubGlobal("showOpenFilePicker", async () => [{ name: "other.master", getFile }]);
  return getFile;
}
/** Stubs the open picker with a v1 master, which converts on the way in and
 *  warns about its unknown "mystery" layer. */
function stubConvertedMaster() {
  const old = lolevV1();
  old.layers = [...old.layers, { id: "mystery", name: "?", enabled: true }];
  old.defaults = { mystery: 1 } as never;
  return stubMasterBytes(new TextEncoder().encode(JSON.stringify(old)));
}

// A v1 master converts on the way in, with the converter's warnings: one toast
// for the open, the warnings joined, with no "Note:" lead-in.
it("Open Master shows a converted master's warnings in one toast, without Note:", async () => {
  stubConvertedMaster();
  await mount();
  await run("master-open");
  await shown("mystery");
  await settle();
  // The title names the file; the converter's warnings are the description.
  expect(toastTitles()).toEqual(["Opened other.master with changes"]);
  expect(document.querySelector("[data-sonner-toast] [data-description]")!.textContent).toContain("mystery");
  expect(document.body.textContent).not.toContain("Note:");
  expect(document.querySelector("[data-sonner-toast]")!.getAttribute("data-type")).toBe("warning");
}, 30_000);

it("opening a converted master twice shows its warnings once", async () => {
  const getFile = stubConvertedMaster();
  await mount();
  await run("master-open");
  await shown("mystery");
  await run("master-open");
  // The second open has read its file; its warning would land a tick later.
  await vi.waitFor(() => expect(getFile).toHaveBeenCalledTimes(2), { timeout: 5_000 });
  await settle();
  expect(toastTitles()).toHaveLength(1);
}, 30_000);

it("opening a second label with benched values replaces the first one's warning", async () => {
  const benched = (layer: string) => new File([packLabel(
    { formatVersion: 3, masterId: "lolev", enabledVariants: [], values: { [layer]: "stale" } }, {}) as unknown as BlobPart], `${layer}.label`);
  const { props } = await mount({ seq: 1, file: benched("gone-one") });
  await shown("gone-one");
  await act(async () => root.render(createElement(DocumentEditor, { ...props, fileToOpen: { seq: 2, file: benched("gone-two") } })));
  await shown("gone-two");
  await settle();
  expect(toastTitles()).toEqual(["Opened gone-two.label with changes"]);
  expect(document.querySelector("[data-sonner-toast] [data-description]")!.textContent).toContain("gone-two");
}, 30_000);

it("Open Master reports a file that is not a master as an error toast", async () => {
  stubMasterBytes(new TextEncoder().encode("not a master"));
  await mount();
  await run("master-open");
  await shown("Could not open master: ");
  expect(document.querySelector("[data-sonner-toast]")!.getAttribute("data-type")).toBe("error");
  expect(document.querySelector("#master-picker")?.textContent).toContain("Lolev");
}, 30_000);

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
  await shown("1 image in Lolev.master has no file to save");
  const toasts = [...document.querySelectorAll("[data-sonner-toast]")];
  const warning = toasts.find((li) => li.getAttribute("data-type") === "warning")!;
  expect(warning.querySelector("[data-title]")!.textContent).toBe("1 image in Lolev.master has no file to save");
  expect(warning.querySelector("[data-description]")!.textContent).toBe("It will be blank when you reopen this master.");
  const saved = toasts.find((li) => li.getAttribute("data-type") === "success")!;
  expect(saved.querySelector("[data-title]")!.textContent).toBe("Saved Lolev.master");
  expect(saved.textContent).not.toContain("no file");
  expect(toasts).toHaveLength(2);
}, 30_000);

// A render error belongs to the tab whose preview failed: it shows while that
// tab is in front, goes when it is not, and comes back with it. A frame that
// draws fine takes it away.
it("a render error toast belongs to its tab", async () => {
  const { props } = await mount();
  const showTab = (active: boolean) => act(async () => root.render(createElement(DocumentEditor, { ...props, active })));
  await act(async () => menu.renderError!("Preview failed: boom"));
  await shown("Preview failed: boom");
  expect(toastTypes()).toEqual(["error"]);
  expect(headerMessages()).toHaveLength(0);

  await showTab(false);
  await vi.waitFor(() => expect(toastTitles()).toEqual([]), { timeout: 5_000 });
  await showTab(true);
  await shown("Preview failed: boom");
  expect(toastTitles()).toEqual(["Preview failed: boom"]);

  await act(async () => menu.renderError!(""));
  await vi.waitFor(() => expect(toastTitles()).toEqual([]), { timeout: 5_000 });
}, 30_000);

// The warning is about the label, not about one edit: it shows when it first
// appears, and an edit that leaves the same warning in place does not bring it
// back after the user closed it.
it("a label overriding an unknown layer warns once", async () => {
  const ghost = packLabel({
    formatVersion: 3, masterId: "lolev", enabledVariants: [], values: {}, overrides: { ghost: { x: 10 } },
  }, {});
  await mount({ seq: 1, file: new File([ghost as unknown as BlobPart], "ghost.label") });
  const sentence = 'Label overrides unknown layer "ghost"; skipped.';
  await shown(sentence);
  expect(toastTitles()).toEqual([sentence]);
  expect(toastTypes()).toEqual(["warning"]);
  expect(headerMessages()).toHaveLength(0);

  act(() => { document.querySelector<HTMLButtonElement>("[data-close-button]")!.click(); });
  await vi.waitFor(() => expect(toastTitles()).toEqual([]), { timeout: 5_000 });
  await toggle("warning");
  await settle();
  expect(toastTitles()).toEqual([]);
}, 30_000);

// The header carries no messages: every error, warning and result is a toast.
it("the header shows no message after an export succeeds", async () => {
  picker();
  flatCanvas(0);
  await mount();
  await act(async () => { menu.actions.find((c) => c.id === "export-psd")!.run(); });
  await shown("Saved ");
  expect(toastTypes()).toEqual(["success"]);
  expect(headerMessages()).toHaveLength(0);
  expect(document.querySelector("header")!.textContent).not.toContain("Saved");
}, 30_000);

// The font gate and the asset assembly both hit the failure; they are one
// source, so there is one toast.
it("the header shows no message after an asset error", async () => {
  menu.fontError = "font file is gone";
  await mount();
  await shown("font file is gone");
  await settle();
  expect(toastTitles()).toEqual(["font file is gone"]);
  expect(toastTypes()).toEqual(["error"]);
  expect(headerMessages()).toHaveLength(0);
  expect(document.querySelector("header")!.textContent).not.toContain("font file is gone");
}, 30_000);

// ---- Toast paths: which toasts go with the tab, which stay, and the error paths ----

const MASK_FAILED = 'Could not load mask "broken-mask.png": Invalid image';
/** Drops a texture and a mask that both fail to decode, and waits for their toasts. */
async function dropBrokenArt() {
  stubDecoding(["broken.png", "broken-mask.png"]);
  const editor = await mount();
  await dropArt(textureFile("broken.png"));
  await dropArt(textureFile("broken-mask.png"), window.innerWidth - 10);
  await shown(TEXTURE_FAILED);
  await shown(MASK_FAILED);
  return editor;
}
const bothArtErrors = [MASK_FAILED, TEXTURE_FAILED];

// The open warnings of a label and of a restore are covered where they arise
// (stale-label-ids-dom, recovery-open-dom); these are the master's and the image's.
it("closing the tab dismisses its converted-master warning", async () => {
  stubConvertedMaster();
  await mount();
  await run("master-open");
  await shown("mystery");
  await act(async () => root.unmount());
  await vi.waitFor(() => expect(toastTitles()).toEqual([]), { timeout: 5_000 });
}, 30_000);

it("closing the tab dismisses its missing-image warning", async () => {
  const warning = "1 image in Lolev.master has no file to save";
  let written: Uint8Array | undefined;
  picker(async (b) => { written = b; }, "Lolev.master");
  await mount(logoLabel("ghost"));
  await promoteLogo("master-save", () => written);
  await shown(warning);
  await act(async () => root.unmount());
  // The Saved toast fades on its own, so only the warning is looked for.
  await vi.waitFor(() => expect(toastTitles()).not.toContain(warning), { timeout: 5_000 });
}, 30_000);

it("a promotion that fails to apply shows the load-error toast and writes nothing", async () => {
  const { pick } = picker();
  menu.promoteError = "layer id is taken";
  await mount();
  await run("master-save-as");
  await shown("Could not save master: layer id is taken");
  expect(toastTitles()).toEqual(["Could not save master: layer id is taken"]);
  expect(toastTypes()).toEqual(["error"]);
  expect(pick).not.toHaveBeenCalled();
}, 30_000);

it("a Save Master write that fails shows the load-error toast", async () => {
  picker(async () => { throw new Error("Disk full"); }, "Lolev.master");
  await mount();
  await run("master-save-as");
  await shown("Could not save master: Disk full");
  expect(toastTitles()).toEqual(["Could not save master: Disk full"]);
  expect(toastTypes()).toEqual(["error"]);
}, 30_000);

it("a boot restore that fails shows the load-error toast", async () => {
  menu.restoreError = "library unreadable";
  await mount();
  await shown("Could not restore master: library unreadable");
  expect(toastTitles()).toEqual(["Could not restore master: library unreadable"]);
  expect(toastTypes()).toEqual(["error"]);
}, 30_000);

// A read that fails is retried quietly twice (the OS may still be materialising
// the file); only the last failure is reported.
it("a label file that cannot be read reports the failure after the quiet retries", async () => {
  const getFile = vi.fn(async () => { throw new Error("disk went away"); });
  await mount({ seq: 1, handle: { name: "gone.label", getFile } as unknown as FileSystemFileHandle });
  await shown("Could not open label: disk went away");
  expect(getFile).toHaveBeenCalledTimes(3);
  expect(toastTitles()).toEqual(["Could not open label: disk went away"]);
  expect(toastTypes()).toEqual(["error"]);
}, 30_000);

it("a label file read that was aborted reports nothing", async () => {
  const getFile = vi.fn(async () => { throw new DOMException("Aborted", "AbortError"); });
  const { props } = await mount({ seq: 1, handle: { name: "gone.label", getFile } as unknown as FileSystemFileHandle });
  // The open ends after its third read; any report would land a tick later.
  await vi.waitFor(() => expect(props.onOpenSettled).toHaveBeenCalledWith(1, false), { timeout: 15000 });
  expect(getFile).toHaveBeenCalledTimes(3);
  await settle();
  expect(toastTitles()).toEqual([]);
}, 30_000);

// The retry loop reports its own failures; this is the open's outer catch,
// reached when reading the recovery snapshot again (for the new tab's key) fails.
it("a recovered snapshot that cannot be read again reports it", async () => {
  const bytes = packLabel({ formatVersion: 3, masterId: "lolev", enabledVariants: [], values: {} }, {});
  const file = new File([bytes as unknown as BlobPart], "alpha.label");
  let reads = 0;
  file.arrayBuffer = async () => {
    if (reads++) throw new Error("snapshot unreadable");
    return bytes.slice().buffer as ArrayBuffer;
  };
  await mount({ seq: 1, file, recovered: "old:1" });
  await shown("Could not open label: snapshot unreadable");
  expect(toastTitles()).toEqual(["Could not open label: snapshot unreadable"]);
}, 30_000);

// With no file picker (the browser fallback) Open Master clicks a hidden input.
it("Open Master through the hidden file input reports a file it cannot read", async () => {
  await mount();
  const input = document.querySelector<HTMLInputElement>('header input[type="file"]')!;
  const unreadable = new File(["x"], "broken.master");
  unreadable.arrayBuffer = async () => { throw new Error("file vanished"); };
  Object.defineProperty(input, "files", { value: [unreadable], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await shown("Could not open master: file vanished");
  expect(toastTitles()).toEqual(["Could not open master: file vanished"]);
  expect(toastTypes()).toEqual(["error"]);
}, 30_000);

// The art that failed to load is still not loaded after a Save, so its error stays.
it("a successful Save leaves the texture and mask error toasts up", async () => {
  picker();
  const { saveSlot } = await dropBrokenArt();
  await act(async () => { expect(await saveSlot.current!()).toBe(true); });
  await settle();
  expect([...toastTitles()].sort()).toEqual(bothArtErrors);
  expect(removedFlags()).toEqual(["false", "false"]);
}, 30_000);

// A master switch leaves the texture and mask where they are, and so their errors.
it("a master switch keeps the texture and mask error toasts", async () => {
  await dropBrokenArt();
  openMasterFile({ ...lolevMaster(), id: "master-other", name: "Other" });
  await run("master-open");
  await vi.waitFor(() => expect(document.querySelector("#master-picker")?.textContent).toContain("Other"), { timeout: 5_000 });
  await settle();
  expect([...toastTitles()].sort()).toEqual(bothArtErrors);
  expect(removedFlags()).toEqual(["false", "false"]);
}, 30_000);

// The user's close is final for that message: neither an edit nor the tab
// leaving and coming back shows it again. A different message is news. (The same
// text reported again changes no state, so there is nothing to test there.)
it("a render error the user closed stays closed until the message changes", async () => {
  const { props } = await mount();
  await act(async () => menu.renderError!("Preview failed: boom"));
  await shown("Preview failed: boom");
  act(() => { document.querySelector<HTMLButtonElement>("[data-close-button]")!.click(); });
  await vi.waitFor(() => expect(toastTitles()).toEqual([]), { timeout: 5_000 });

  await act(async () => root.render(createElement(DocumentEditor, { ...props, active: false })));
  await act(async () => root.render(createElement(DocumentEditor, { ...props, active: true })));
  await toggle("warning");
  await settle();
  expect(toastTitles()).toEqual([]);

  await act(async () => menu.renderError!("Preview failed: other"));
  await shown("Preview failed: other");
  expect(toastTitles()).toEqual(["Preview failed: other"]);
}, 30_000);
