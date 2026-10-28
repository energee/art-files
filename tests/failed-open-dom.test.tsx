// failed-open-dom.test.tsx — a .label open that fails mid-way (an embedded
// asset won't decode) must leave the tab exactly as it was: still showing the
// previous file, still bound to the previous file's Save target, so ⌘S can
// never write the failed file's content over the file the tab came from (#81).
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { packLabel, unpackLabel } from "../src/model/files";

vi.mock("../src/masterCache", () => ({
  cacheMaster: async () => {},
  cachedMaster: async () => null,
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("../src/components/PreviewCompare", () => ({ PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));

const { DocumentEditor } = await import("../src/App");

beforeEach(() => {
  localStorage.clear();
  // Every raster decode fails, so b.label's embedded texture throws mid-open.
  vi.stubGlobal("createImageBitmap", () => Promise.reject(new Error("decode failed")));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

const labelBytes = (name: string, assets = {}) => packLabel({
  formatVersion: 3, masterId: "lolev", enabledVariants: [],
  values: { name: [{ text: name, fill: "#F3CD80", layer: "metallic" }] },
}, assets);

/** A FileSystemFileHandle stand-in recording every write. */
function fakeHandle(fileName: string, bytes: Uint8Array) {
  const writes: Uint8Array[] = [];
  const handle = {
    name: fileName,
    getFile: async () => new File([bytes as unknown as BlobPart], fileName),
    createWritable: async () => ({
      write: async (b: Uint8Array) => { writes.push(b); },
      close: async () => {},
    }),
  } as unknown as FileSystemFileHandle;
  return { handle, writes };
}

it.each([
  { assets: { texture: { name: "bad.png", bytes: new Uint8Array([1, 2, 3]) } } },
  { overrides: { name: { lines: "oops" } } },
  { values: { name: ["oops"] } },
  { overrides: { name: { kind: "qr" } } },
  { overrides: { name: null } },
  // Overrides the resolver tolerates but the UI can't draw (#267 follow-up):
  // an unknown kind, a whole layer with no id, a required field nulled out.
  { overrides: { stamp: { kind: "shape", id: "stamp", name: "Stamp" } } },
  { overrides: { stamp: { kind: "text", name: "Stamp" } } },
  { overrides: { name: { style: null } } },
])("a failed open keeps the tab and Save target: %j", async (bad) => {
  const a = fakeHandle("a.label", labelBytes("Alpha"));
  const b = fakeHandle("b.label", packLabel({
    formatVersion: 3, masterId: "lolev", enabledVariants: [], values: {}, ...bad,
  } as Parameters<typeof packLabel>[0], ("assets" in bad ? bad.assets : undefined) ?? {}));
  const onMeta = vi.fn();
  const onOpenSettled = vi.fn();
  const saveSlot: { current: (() => Promise<boolean>) | null } = { current: null };
  const props: ComponentProps<typeof DocumentEditor> = {
    active: true, fileToOpen: { seq: 1, handle: a.handle }, onOpenSettled, onMeta,
    saveSlot, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
    onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
    onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
  };
  const lastTitle = () => onMeta.mock.calls.at(-1)?.[0]?.title;
  const settle = async (seq: number) => {
    for (let i = 0; i < 400 && !onOpenSettled.mock.calls.some((c) => c[0] === seq); i++)
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(onOpenSettled).toHaveBeenCalledWith(seq, false);
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(createElement(DocumentEditor, props)); });
    await settle(1);
    expect(lastTitle()).toBe("Alpha");

    // b.label's open fails (all retries) on its texture decode.
    await act(async () => {
      root.render(createElement(DocumentEditor, { ...props, fileToOpen: { seq: 2, handle: b.handle } }));
    });
    await settle(2);
    expect(container.textContent).toContain("Could not open b.label");

    // The tab still shows a.label, and ⌘S writes a.label's own content back.
    expect(lastTitle()).toBe("Alpha");
    const picked = fakeHandle("picked.label", new Uint8Array());
    vi.stubGlobal("showSaveFilePicker", async () => picked.handle);
    await act(async () => { await saveSlot.current!(); });
    expect(picked.writes).toHaveLength(0);
    expect(b.writes).toHaveLength(0);
    expect(a.writes).toHaveLength(1);
    expect(unpackLabel(a.writes[0]).label?.values.name?.[0]).toMatchObject({ text: "Alpha" });
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
}, 30_000);
