// image-asset-undo-dom.test.tsx — an image layer's dropped art must survive
// undo (#75), and Save must pack only the art the doc still references (#84).
// FileDrop is replaced by a prop-capturing stub so the test can drop files
// and read the well's thumbnail; the document model and App wiring are real.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";

type DropProps = { label: string; fileName?: string; previewUrl?: string; onFile: (f: File) => unknown; onClear?: () => void };
const wells = vi.hoisted(() => ({ image: null as null | DropProps }));
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

it("a good image clears the error a bad one left in the header (#511)", async () => {
  await act(async () => { await wells.image!.onFile(new File(["not an image"], "bad.svg", { type: "image/svg+xml" })); });
  expect(document.body.textContent).toContain("Could not load image");
  await act(async () => { await wells.image!.onFile(svg("a.svg", "M0 0 L10 0 L10 10 Z")); });
  await settle();
  expect(document.body.textContent).not.toContain("Could not load image");
});
