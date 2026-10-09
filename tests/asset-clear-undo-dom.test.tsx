// asset-clear-undo-dom.test.tsx — every inspector well's X can be taken back
// (#426). The texture and mask slots sit outside the document history, so
// their clear returns the well's own Undo; an image layer's clear is a
// history edit, so ⌘Z restores it. FileDrop is replaced by a prop-capturing
// stub (as in offvariant-image-drop-dom.test.tsx); App wiring is real.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";

type DropProps = { label: string; fileName?: string; onFile: (f: File) => unknown; onClear?: () => unknown };
const wells = vi.hoisted(() => ({} as Record<string, DropProps>));
vi.mock("../src/components/FileDrop", () => ({
  CHECKER: "", FILE_DROP_ATTR: "data-file-drop",
  FileDrop: (p: DropProps) => { wells[p.label] = p; return null; },
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("../src/components/PreviewCompare", () => ({ PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
import { DocumentEditor } from "../src/App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  for (const k of Object.keys(wells)) delete wells[k];
  // Raster decodes succeed; canvas is stubbed for the preview pass.
  class FakeBitmap { width = 10; height = 10; close() {} }
  vi.stubGlobal("ImageBitmap", FakeBitmap);
  vi.stubGlobal("createImageBitmap", async () => new FakeBitmap());
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() {} } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(new Blob(["png"])));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(DocumentEditor, {
      active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
      saveSlot: { current: null } as never, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
      onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
      onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
    }));
  });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const select = async (id: string) => {
  const row = container.querySelector(`[data-layer-id="${id}"]`)!;
  await act(async () => {
    (row.querySelector('[data-slot="sidebar-menu-button"]') as HTMLButtonElement).click();
  });
};

it("the texture well's X returns an undo that puts the file back", async () => {
  await select("background");
  await act(async () => { await wells.Texture.onFile(new File(["png"], "rock.png", { type: "image/png" })); });
  expect(wells.Texture.fileName).toBe("rock.png");
  let undo: unknown;
  await act(async () => { undo = wells.Texture.onClear!(); });
  expect(wells.Texture.fileName).toBeUndefined();
  expect(typeof undo).toBe("function");
  await act(async () => { (undo as () => void)(); });
  expect(wells.Texture.fileName).toBe("rock.png");
});

it("an image layer's clear is in history: ⌘Z restores it", async () => {
  // collabLeft is an image layer (the Collab variant's, off by default).
  await select("collabLeft");
  const svg = new File(['<svg viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z"/></svg>'],
    "logo.svg", { type: "image/svg+xml" });
  await act(async () => { await wells.Image.onFile(svg); });
  expect(wells.Image.fileName).toBe("logo.svg");
  // A real click comes well after the drop; past history's 500 ms window
  // the clear is its own step rather than folding into the drop's.
  const now = performance.now();
  vi.spyOn(performance, "now").mockReturnValue(now + 1000);
  let undo: unknown;
  await act(async () => { undo = wells.Image.onClear!(); await Promise.resolve(); });
  expect(wells.Image.fileName).toBeUndefined();
  // No well-level undo: the note names ⌘Z instead.
  expect(undo).toBeUndefined();
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
  });
  expect(wells.Image.fileName).toBe("logo.svg");
});
