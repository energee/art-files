// image-asset-undo-dom.test.tsx — an image layer's dropped art must survive
// undo (#75), and Save must pack only the art the doc still references (#84).
// FileDrop is replaced by a prop-capturing stub so the test can drop files
// and read the well's thumbnail; the document model and App wiring are real, and
// so is the <Toaster /> an image load error shows in.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { mountToaster, shown, toastTitles, unmountToaster } from "./real-timer-toaster";

type DropProps = { label: string; fileName?: string; previewUrl?: string; onFile: (f: File) => unknown; onClear?: () => void };
const wells = vi.hoisted(() => ({ image: null as null | DropProps }));
// Written against the Lolev layers and its "lolev" id (barcode, QR, Collab),
// so the shipped master is swapped for the Lolev fixture here.
vi.mock("../src/model/starterLayers", async () => ({ starterMaster: (await import("./fixtures/lolevMaster")).lolevMaster }));
vi.mock("../src/components/FileDrop", () => ({
  FILE_DROP_ATTR: "data-file-drop",
  FileDrop: (p: DropProps) => { if (p.label === "Image") wells.image = p; return null; },
}));
vi.mock("../src/components/PreviewCompare", () => ({ PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
const packed = vi.hoisted(() => ({ ids: [] as string[][] }));
vi.mock("../src/model/files", async (orig) => {
  const real = await orig<typeof import("../src/model/files")>();
  return {
    ...real,
    packLabel: (l: Parameters<typeof real.packLabel>[0], a: Parameters<typeof real.packLabel>[1]) => {
      packed.ids.push(Object.keys(a.customImages ?? {}));
      return real.packLabel(l, a);
    },
  };
});
import { DocumentEditor } from "../src/App";

const svg = (name: string, d: string) =>
  new File([`<svg viewBox="0 0 10 10"><path d="${d}"/></svg>`], name, { type: "image/svg+xml" });

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const saveSlot: { current: null | (() => Promise<boolean>) } = { current: null };
// History folds edits made within 500ms into one undo step; each drop here
// must be its own step, as it is for a person dropping files by hand.
const settle = () => act(() => new Promise((r) => setTimeout(r, 600)));
const undo = () => act(async () => {
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
});

beforeEach(async () => {
  wells.image = null;
  packed.ids = [];
  await mountToaster();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(DocumentEditor, {
      active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
      saveSlot: saveSlot as never, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
      onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
      onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
    }));
  });
  // Select the collab Text Logo — a plain image layer with its own well —
  // after switching it on (which enables the Collab variant that owns it).
  const row = container.querySelector('[data-layer-id="collabLeft"]')!;
  await act(async () => (row.querySelector('button[aria-label$=": enabled"]') as HTMLButtonElement).click());
  await act(async () => {
    (row.querySelector('[data-slot="sidebar-menu-button"]') as HTMLButtonElement).click();
  });
  expect(wells.image).not.toBeNull();
  await settle();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  await unmountToaster();
  container.remove();
});

it("undo after replacing an image layer's art brings the first image back (#75)", async () => {
  await act(async () => { await wells.image!.onFile(svg("a.svg", "M0 0 L10 0 L10 10 Z")); });
  expect(wells.image!.fileName).toBe("a.svg");
  const urlA = wells.image!.previewUrl;
  expect(urlA).toBeTruthy();
  await settle();
  await act(async () => { await wells.image!.onFile(svg("b.svg", "M0 0 L10 10 L0 10 Z")); });
  expect(wells.image!.fileName).toBe("b.svg");
  await undo();
  expect(wells.image!.fileName).toBe("a.svg");
  expect(wells.image!.previewUrl).toBe(urlA);
});

it("undo after clearing an image layer brings the image back (#75)", async () => {
  await act(async () => { await wells.image!.onFile(svg("a.svg", "M0 0 L10 0 L10 10 Z")); });
  await settle();
  await act(async () => { wells.image!.onClear!(); });
  expect(wells.image!.fileName).toBeUndefined();
  await undo();
  expect(wells.image!.fileName).toBe("a.svg");
});

it("Save packs only the image art the document still references (#84)", async () => {
  await act(async () => { await wells.image!.onFile(svg("a.svg", "M0 0 L10 0 L10 10 Z")); });
  await act(async () => { await wells.image!.onFile(svg("b.svg", "M0 0 L10 10 L0 10 Z")); });
  await act(async () => { await saveSlot.current!(); });
  // An unsaved label is packed twice — before the dialog (size check) and
  // again for the chosen destination (#428) — and every pack holds one image.
  expect(packed.ids.length).toBeGreaterThan(0);
  for (const ids of packed.ids) expect(ids).toHaveLength(1);
});

// #737: history holds 100 steps. Art no step can reach goes, thumbnail URL and
// all; every step that can reach art still restores it.
describe("replaced art past the undo limit", () => {
  const drop = (name: string) => act(async () => { await wells.image!.onFile(svg(name, "M0 0 L10 0 L10 10 Z")); });
  let revoke: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // Each drop must be its own step without a real 500ms wait between them.
    let clock = performance.now();
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 1000));
    revoke = vi.spyOn(URL, "revokeObjectURL");
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("releases art the stack trimmed away, and undo reaches all the rest", async () => {
    const urls: string[] = [];
    for (let i = 0; i < 103; i++) {
      await drop(`${i}.svg`);
      urls.push(wells.image!.previewUrl!);
    }
    // 103 drops: the stack holds drops 2..101 behind drop 102.
    expect(revoke).toHaveBeenCalledWith(urls[0]);
    expect(revoke).toHaveBeenCalledWith(urls[1]);
    expect(revoke).toHaveBeenCalledTimes(2);
    for (let i = 101; i >= 2; i--) {
      await undo();
      expect(wells.image!.fileName).toBe(`${i}.svg`);
      expect(wells.image!.previewUrl).toBe(urls[i]);
    }
  }, 30_000);

  it("keeps art only redo can reach until a new edit ends that redo", async () => {
    await drop("a.svg");
    await drop("b.svg");
    const urlB = wells.image!.previewUrl!;
    await undo();
    expect(revoke).not.toHaveBeenCalled();
    await drop("c.svg");
    expect(revoke).toHaveBeenCalledWith(urlB);
    expect(revoke).toHaveBeenCalledTimes(1);
  });
});

it("a good image dismisses the error toast a bad one left (#511)", async () => {
  await act(async () => { await wells.image!.onFile(new File(["not an image"], "bad.svg", { type: "image/svg+xml" })); });
  await shown("Could not load image");
  expect(toastTitles()).toEqual([expect.stringContaining("Could not load image")]);
  await act(async () => { await wells.image!.onFile(svg("a.svg", "M0 0 L10 0 L10 10 Z")); });
  await vi.waitFor(() => expect(toastTitles()).toEqual([]), { timeout: 5_000 });
}, 30_000);
