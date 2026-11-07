// gesture-races-dom.test.tsx — what happens when something else reaches the
// document during a canvas drag or resize (#689, #703), when a late async
// change lands next to the user's own edit (#702), and when a layer is removed
// before a tab's render source is back (#708). PreviewCompare is a prop-capturing
// stub, so a test calls onDrag/onResize as the pointer would, and the image
// decode and the font load are held open with controlled promises to fix each
// interleaving. The document model, history and App wiring are real.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { mountToaster, settle, shown, toastTitles, unmountToaster } from "./real-timer-toaster";
import type { Command } from "../src/components/CommandMenu";

type PreviewProps = import("react").ComponentProps<typeof import("../src/components/PreviewCompare").PreviewCompare>;
type DropProps = { label: string; fileName?: string; onFile: (f: File) => unknown };
const held = vi.hoisted(() => ({
  preview: null as PreviewProps | null,
  well: null as DropProps | null,
  actions: [] as Command[],
  /** While set, an image decode waits on it. */
  decode: null as Promise<void> | null,
  /** While set, the render source's font load waits on it. */
  faces: null as Promise<void> | null,
}));
// "abv" carries a `binding` to "volume", the record removal needs a box for.
vi.mock("../src/model/starterLayers", async () => {
  const { lolevMaster } = await import("./fixtures/lolevMaster");
  return {
    starterMaster: () => {
      const m = lolevMaster();
      return {
        ...m,
        layers: m.layers.map((l) => l.id === "abv" ? { ...l, binding: { to: "volume", side: "bottom", gap: 4 } } : l),
      };
    },
  };
});
vi.mock("../src/components/PreviewCompare", () => ({
  SNAP_PT: 6, PreviewCompare: (p: PreviewProps) => { held.preview = p; return null; },
}));
vi.mock("../src/components/FileDrop", () => ({
  FILE_DROP_ATTR: "data-file-drop",
  FileDrop: (p: DropProps) => { if (p.label === "Image") held.well = p; return null; },
}));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/components/AppMenu", () => ({
  AppMenu: (p: { actions: Command[] }) => { held.actions = p.actions; return null; },
}));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => { await held.faces; return (text: string, size: number) => text.length * size * 0.55; },
  labelFontCss: () => "sans-serif",
}));
vi.mock("../src/assets/io", async (original) => {
  const io = await original<typeof import("../src/assets/io")>();
  return {
    ...io,
    readCustomImage: async (f: File) => { await held.decode; return io.readCustomImage(f); },
  };
});
import { DocumentEditor } from "../src/App";
import { packMaster } from "../src/model/files";
import { lolevMaster } from "./fixtures/lolevMaster";

const svg = () => new File(['<svg viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z"/></svg>'], "a.svg", { type: "image/svg+xml" });
/** A promise and its resolver, to hold one step of an interleaving open. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { opened, open };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onMeta = vi.fn();
const editor = (active: boolean) => createElement(DocumentEditor, {
  active, fileToOpen: null, onOpenSettled: vi.fn(), onMeta,
  saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
  onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
  onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
});
const row = (id: string) => container.querySelector(`[data-layer-id="${id}"]`);
const pick = (id: string) => act(async () => {
  (row(id)!.querySelector('[data-slot="sidebar-menu-button"]') as HTMLButtonElement).click();
});
const toggle = (id: string) => act(async () => {
  (row(id)!.querySelector('button[aria-label$=": enabled"]') as HTMLButtonElement).click();
});
const enabled = (id: string) => row(id)!.querySelector('button[aria-label$=": enabled"]')!.getAttribute("aria-pressed");
const pressKey = (init: KeyboardEventInit) => act(async () => {
  document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
});
const undo = () => pressKey({ key: "z", metaKey: true });
const layerOf = (id: string) => held.preview!.layers.find((l) => l.id === id)!;
const xOf = (id: string) => layerOf(id).x;
const yOf = (id: string) => layerOf(id).y as number;
/** One pointermove on the barcode; resolves to the delta after snapping. */
async function drag(dx: number, dy: number, first = false) {
  let moved = { dx: 0, dy: 0 };
  await act(async () => { moved = held.preview!.onDrag("barcode", dx, dy, first); });
  return moved;
}
const escape = () => act(async () => held.preview!.onDragCancel());
const title = () => onMeta.mock.lastCall?.[0].title as string;
/** The inspector's in-place Name edit: a field-keyed edit from outside the gesture. */
async function rename(name: string) {
  await pick("name");
  const field = document.querySelector('[contenteditable="true"]') as HTMLElement;
  await act(async () => {
    field.innerHTML = `<div>${name}</div>`;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  held.preview = null; held.well = null; held.decode = null; held.faces = null;
  onMeta.mockClear();
  await mountToaster();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root.render(editor(true)));
  await vi.waitFor(() => expect(held.preview?.canvasRender).toBeTruthy(), { timeout: 30_000 });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  await unmountToaster();
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** An image layer selected with its well up (Collab's Text logo). */
async function selectImageLayer() {
  await toggle("collabLeft");
  await pick("collabLeft");
  expect(held.well).not.toBeNull();
}

it("a drag keeps an image that finishes decoding while it runs (#689)", async () => {
  await selectImageLayer();
  const startX = xOf("barcode");
  const decode = gate();
  held.decode = decode.opened;
  const landing = held.well!.onFile(svg());
  const before = await drag(10, 0, true);
  decode.open();
  await act(async () => { await landing; });
  expect(held.well!.fileName).toBe("a.svg");
  const after = await drag(20, 0);
  expect(held.well!.fileName).toBe("a.svg");
  expect(xOf("barcode")).toBeCloseTo(startX + after.dx);
  // Three steps: the rest of the drag, the image, the drag up to it.
  await undo();
  expect(held.well!.fileName).toBe("a.svg");
  expect(xOf("barcode")).toBeCloseTo(startX + before.dx);
  await undo();
  expect(held.well!.fileName).toBeUndefined();
  expect(xOf("barcode")).toBeCloseTo(startX + before.dx);
  await undo();
  expect(xOf("barcode")).toBeCloseTo(startX);
}, 60_000);

it("a resize keeps an edit made while it runs (#689)", async () => {
  const start = layerOf("barcode");
  await act(async () => { held.preview!.onResize("barcode", { hx: 1, hy: 1 }, 10, 10, false, true); });
  await toggle("abv");
  await act(async () => { held.preview!.onResize("barcode", { hx: 1, hy: 1 }, 20, 20, false, false); });
  expect(enabled("abv")).toBe("false");
  expect(layerOf("barcode")).not.toEqual(start);
}, 60_000);

it("a master switch landing mid-drag stays switched and reads as saved (#689)", async () => {
  const bytes = packMaster({ ...lolevMaster(), id: "master-other", name: "Other" }, {});
  vi.stubGlobal("showOpenFilePicker", async () => [
    { name: "other.master", getFile: async () => new File([bytes as unknown as BlobPart], "other.master") },
  ]);
  await drag(10, 0, true);
  await act(async () => { await held.actions.find((c) => c.id === "master-open")!.run(); });
  const picker = () => container.querySelector("#master-picker")?.textContent;
  await vi.waitFor(() => expect(picker()).toContain("Other"));
  await drag(20, 0);
  expect(picker()).toContain("Other");
  expect(onMeta.mock.lastCall?.[0]).toMatchObject({ masterUnsaved: false });
}, 60_000);

it("a move only ever writes the dragged layer's own position (#689)", async () => {
  const startY = yOf("barcode");
  await drag(10, 10, true);
  await rename("Peregrine");
  const { dy } = await drag(10, 30);
  expect(title()).toBe("Peregrine");
  expect(yOf("barcode")).toBeCloseTo(startY + dy);
}, 60_000);

// #164: moveBy leaves out an axis whose delta is 0, so the gesture has to put
// that axis back itself.
it("an axis dragged back to 0 returns to where the gesture began (#164)", async () => {
  const [startX, startY] = [xOf("barcode"), yOf("barcode")];
  await drag(30, 30, true);
  const { dy } = await drag(0, 30);
  expect(xOf("barcode")).toBeCloseTo(startX);
  expect(yOf("barcode")).toBeCloseTo(startY + dy);
  await drag(0, 0);
  expect(layerOf("barcode")).toMatchObject({ x: startX, y: startY });
  // A second drag's start is where the first left it, not the master's value.
  const { dx } = await drag(50, 0);
  await drag(40, 0, true);
  await drag(0, 0);
  expect(xOf("barcode")).toBeCloseTo(startX + dx);
}, 60_000);

it("a resize dragged back to nothing restores the layer it started from", async () => {
  const start = layerOf("name");
  const handle = { hx: 1, hy: 0 } as const;
  await act(async () => { held.preview!.onResize("name", handle, 40, 0, false, true); });
  expect(layerOf("name")).not.toEqual(start);
  await act(async () => { held.preview!.onResize("name", handle, 0, 0, false, false); });
  expect(layerOf("name")).toEqual(start);
}, 60_000);

it("⌘Z during a drag then Escape keeps the edit before the drag (#703)", async () => {
  await rename("Peregrine");
  await drag(10, 0, true);
  await undo();
  await drag(20, 0);
  await escape();
  expect(title()).toBe("Peregrine");
}, 60_000);

it("Escape straight after ⌘Z during a drag has nothing left to undo (#703)", async () => {
  await rename("Peregrine");
  await drag(10, 0, true);
  await undo();
  await escape();
  expect(title()).toBe("Peregrine");
}, 60_000);

it("⌘Z after a finished drag still undoes it (#703)", async () => {
  const startX = xOf("barcode");
  await drag(10, 0, true);
  await undo();
  expect(xOf("barcode")).toBeCloseTo(startX);
}, 60_000);

// A pinned clock puts the landing inside history's 500 ms window however
// loaded the machine is.
it("an image decoded just after an edit is its own undo step (#702)", async () => {
  await selectImageLayer();
  vi.spyOn(performance, "now").mockReturnValue(performance.now() + 10_000);
  const decode = gate();
  held.decode = decode.opened;
  const landing = held.well!.onFile(svg());
  await toggle("qr");
  decode.open();
  await act(async () => { await landing; });
  await undo();
  expect(held.well!.fileName).toBeUndefined();
  expect(enabled("qr")).toBe("false");
}, 60_000);

it("the next edit after a drag never folds into the drag's step", async () => {
  vi.spyOn(performance, "now").mockReturnValue(performance.now() + 10_000);
  const startX = xOf("barcode");
  const { dx } = await drag(10, 0, true);
  await toggle("qr");
  await undo();
  expect(enabled("qr")).toBe("true");
  expect(xOf("barcode")).toBeCloseTo(startX + dx);
}, 60_000);
