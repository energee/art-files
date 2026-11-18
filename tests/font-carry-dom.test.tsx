// font-carry-dom.test.tsx — App-level carry of imported fonts (font import
// task 9): a label opened with an imported font saves it back under the same
// id and bytes; a save leaves out a font no layer uses any more; a recovered
// tab opens with its font and keeps it in its next snapshot, its unsaved
// master included; and a file whose font bytes don't match the id they are
// stored under is refused on open. The real font gate's registry runs; only
// face loading is stubbed.
// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { readImportedFont } from "../src/fontImport";
import type { ImportedFont } from "../src/labelfile";
import { packLabel, packMaster, unpackLabel, unpackMaster } from "../src/model/files";
import type { LabelFile, Layer, TextLayer } from "../src/model/layers";
import { lolevMaster } from "./fixtures/lolevMaster";
import { mountToaster, shown, unmountToaster } from "./real-timer-toaster";

const snaps = vi.hoisted(() => [] as import("../src/recovery").RecoverySnapshot[]);
const arts = vi.hoisted(() => [] as (import("../src/recovery").SnapshotArt | undefined)[]);
vi.mock("../src/model/starterLayers", async () => ({ starterMaster: (await import("./fixtures/lolevMaster")).lolevMaster }));
vi.mock("../src/recovery", () => ({
  keepRecovery: async (_key: string, snap: import("../src/recovery").RecoverySnapshot, art?: import("../src/recovery").SnapshotArt) => {
    snaps.push(snap);
    arts.push(art);
    return true;
  },
  dropRecovery: async () => {},
  discardCount: () => 0,
}));
vi.mock("../src/masterCache", () => ({ cacheMaster: async () => {}, cachedMaster: async () => null }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("../src/components/PreviewCompare", () => ({ PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/fonts")>(),
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));

const { DocumentEditor } = await import("../src/App");
const { importedFamilies } = await import("../src/fonts");

const svn = () => readImportedFont([{
  name: "SVN-Poppins-Bold.ttf", bytes: new Uint8Array(readFileSync("tests/fixtures/fonts/SVN-Poppins-Bold.ttf")),
}]);
const nameLayer = () => lolevMaster().layers.find((l) => l.id === "name") as TextLayer;
const labelWith = (overrides?: LabelFile["overrides"]): LabelFile =>
  ({ formatVersion: 3, masterId: "lolev", enabledVariants: [], values: {}, ...overrides ? { overrides } : {} });
const file = (bytes: Uint8Array, name = "beer.label") => new File([bytes as BlobPart], name);

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = container = undefined;
  await unmountToaster();
  vi.unstubAllGlobals();
  snaps.length = 0;
  arts.length = 0;
});

/** Mount one editor on `fileToOpen` and wait until the open settles. */
async function open(fileToOpen: ComponentProps<typeof DocumentEditor>["fileToOpen"]) {
  await mountToaster();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const saveSlot: { current: (() => Promise<boolean>) | null } = { current: null };
  const onOpenSettled = vi.fn();
  const onMeta = vi.fn();
  const props: ComponentProps<typeof DocumentEditor> = {
    active: true, fileToOpen, onOpenSettled, onMeta, saveSlot,
    render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(), onOpenProject: vi.fn(), onNewTab: vi.fn(),
    onCloseTab: vi.fn(), onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(), recoveryKey: "now:2",
  };
  await act(async () => { root!.render(createElement(DocumentEditor, props)); });
  await vi.waitFor(() => expect(onOpenSettled).toHaveBeenCalled(), { timeout: 10_000 });
  return { saveSlot, container };
}

/** Save through a stubbed browser save picker; resolves to the bytes written. */
async function save(saveSlot: { current: (() => Promise<boolean>) | null }): Promise<Uint8Array> {
  let written: Uint8Array | undefined;
  const writable = { write: async (b: Uint8Array) => { written = b; }, close: async () => {} };
  vi.stubGlobal("showSaveFilePicker", async () => ({ name: "beer.label", createWritable: async () => writable }));
  await act(async () => { expect(await saveSlot.current!()).toBe(true); });
  return written!;
}

const bytesOf = (font: ImportedFont) => [font.faces.regular.bytes, font.faces.semibold.bytes, font.faces.bold.bytes];

it("saves a label's imported font under the same id and bytes it opened with", async () => {
  const { id, font } = await svn();
  const bytes = packLabel(labelWith({ name: { fontFamily: id } }), { fonts: { [id]: font } });
  const { saveSlot } = await open({ seq: 1, file: file(bytes) });
  expect(importedFamilies().get(id)?.label).toBe(font.family);
  const reopened = unpackLabel(await save(saveSlot));
  expect((reopened.label?.overrides?.name as Partial<TextLayer>).fontFamily).toBe(id);
  expect(Object.keys(reopened.assets.fonts ?? {})).toEqual([id]);
  expect(bytesOf(reopened.assets.fonts![id])).toEqual(bytesOf(font));
}, 30_000);

it("leaves out of the save a font whose last layer was removed", async () => {
  const { id, font } = await svn();
  const extra = { ...nameLayer(), id: "extra", name: "Extra", fontFamily: id } as Layer;
  const bytes = packLabel(labelWith({ extra: extra as never }), { fonts: { [id]: font } });
  const { saveSlot, container } = await open({ seq: 1, file: file(bytes) });
  await act(async () => {
    (container.querySelector('[data-layer-id="extra"] [data-slot="sidebar-menu-button"]') as HTMLElement).click();
  });
  await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })); });
  expect(container.querySelector('[data-layer-id="extra"]')).toBeNull();
  expect(unpackLabel(await save(saveSlot)).assets.fonts).toBeUndefined();
}, 30_000);

it("refuses a file whose font bytes don't match the id they are stored under", async () => {
  const { font } = await svn();
  const forged = "imported:0123456789abcdef0123456789abcdef";
  const bytes = packLabel(labelWith({ name: { fontFamily: forged } }), { fonts: { [forged]: font } });
  await open({ seq: 1, file: file(bytes, "forged.label") });
  await shown(`Could not open forged.label: This file's font ${font.family} is damaged.`);
  expect(importedFamilies().has(forged)).toBe(false);
}, 30_000);

// A crash snapshot of a tab whose master was edited to an imported font: the
// tab comes back with the font, and its next snapshot still carries it, in
// the label's art and in the master (which can't reopen without it).
it("a recovered tab opens with its font and keeps it in the next snapshot", async () => {
  const { id, font } = await svn();
  const base = lolevMaster();
  const edited = { ...base, layers: base.layers.map((l) => l.id === "name" ? { ...l, fontFamily: id } as Layer : l) };
  const snapshot = packLabel(labelWith(), { fonts: { [id]: font } });
  await open({
    seq: 1, file: file(snapshot), recovered: "old:1",
    recoveredMaster: { edited: packMaster(edited, { fonts: { [id]: font } }), base: packMaster(base, {}) },
  });
  expect(importedFamilies().get(id)?.label).toBe(font.family);
  // The tab's own snapshot (it packs art), not the shell's copy of the old one.
  await vi.waitFor(() => expect(arts.at(-1)).toBeDefined(), { timeout: 10_000 });
  const master = unpackMaster(snaps.at(-1)!.master!.edited);
  expect((master.master.layers.find((l) => l.id === "name") as TextLayer).fontFamily).toBe(id);
  expect(Object.keys(unpackLabel(arts.at(-1)!.pack()).assets.fonts ?? {})).toEqual([id]);
}, 30_000);
