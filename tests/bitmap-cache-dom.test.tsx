// bitmap-cache-dom.test.tsx — DocumentEditor's preview bitmaps (#413):
// changing one page-art slot re-decodes only that slot, and closing the tab
// closes every decoded bitmap.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";

vi.mock("../src/components/PreviewCompare", () => ({ PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", () => ({ loadLabelFaces: async () => (t: string, s: number) => t.length * s * 0.55, labelFontCss: () => "sans-serif", FONT_URLS: { poppins: {} } }));
import { DocumentEditor } from "../src/App";

let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("re-decodes only the changed page art, and closes every bitmap on unmount", async () => {
  class FakeBitmap { width = 10; height = 10; closed = false; close() { this.closed = true; } }
  vi.stubGlobal("ImageBitmap", FakeBitmap);
  // A dropped File decodes during the upload (readRaster); a bare Blob is a
  // preview decode of the slot's previewBytes — the ones the cache owns.
  const previews: FakeBitmap[] = [];
  vi.stubGlobal("createImageBitmap", async (src: Blob) => {
    const b = new FakeBitmap();
    if (!(src instanceof File)) previews.push(b);
    return b;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() {} } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(new Blob(["png"])));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(DocumentEditor, {
    active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(), saveSlot: { current: null },
    render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(), onOpenProject: vi.fn(),
    onNewTab: vi.fn(), onCloseTab: vi.fn(), onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
  })));
  // The left half of the window takes a texture, the right half a mask.
  const drop = async (file: File, clientX: number) => {
    const e = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "dataTransfer", { value: { types: ["Files"], items: [{ kind: "file", type: file.type }], files: [file] } });
    Object.defineProperty(e, "clientX", { value: clientX });
    await act(async () => { document.body.dispatchEvent(e); });
  };
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 250)); });

  await drop(new File(["t"], "art.png", { type: "image/png" }), 10);
  await vi.waitFor(async () => { await settle(); expect(previews).toHaveLength(1); });
  const texture = previews[0];
  await drop(new File(["m"], "mask.png", { type: "image/png" }), window.innerWidth - 10);
  await vi.waitFor(async () => { await settle(); expect(previews).toHaveLength(2); });
  await settle();
  expect(previews).toHaveLength(2); // the texture kept its decode
  expect(texture.closed).toBe(false);

  await act(async () => root.unmount());
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(previews.every((b) => b.closed)).toBe(true);
}, 30_000);
