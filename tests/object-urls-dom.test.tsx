// object-urls-dom.test.tsx — a DocumentEditor must release every blob URL it
// mints: a closed tab (unmount) revokes its thumbnails and export URLs, and a
// custom image that fails to decode never leaves its preview URL behind (#85).
// Decoders mint no URL; one is minted only as a decode commits to state, so a
// decode that is discarded (a sibling failed, or the slot was already
// filled) leaves nothing to revoke (#432).
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import type { LabelAssets } from "../src/labelfile";
import type { Command } from "../src/components/CommandMenu";
import { lolevMaster } from "../src/model/lolevLayers";
import type { MasterAssets } from "../src/model/files";

vi.mock("../src/masterCache", () => ({
  cacheMaster: async () => {},
  cachedMaster: async () => null,
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("../src/components/PreviewCompare", () => ({ PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
const menu = vi.hoisted(() => ({ actions: [] as Command[] }));
vi.mock("../src/components/AppMenu", () => ({ AppMenu: (p: { actions: Command[] }) => { menu.actions = p.actions; return null; } }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));

const { DocumentEditor } = await import("../src/App");
const { packLabel, packMaster } = await import("../src/model/files");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let created: string[];
let revoked: Set<string>;
beforeEach(() => {
  localStorage.clear();
  created = [];
  revoked = new Set();
  let n = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const url = `blob:test/${n++}`;
    created.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((u) => { revoked.add(u); });
  // Every raster decode fails; SVG art never decodes a bitmap.
  vi.stubGlobal("createImageBitmap", () => Promise.reject(new Error("decode failed")));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"><rect width="10" height="5"/></svg>');

function labelHandle(name: string, assets: LabelAssets) {
  const bytes = packLabel({
    formatVersion: 3, masterId: "lolev", enabledVariants: [],
    values: { name: [{ text: "Alpha", fill: "#F3CD80", layer: "metallic" }] },
  }, assets);
  return { name, getFile: async () => new File([bytes as unknown as BlobPart], name) } as unknown as FileSystemFileHandle;
}

/** Mount an editor opening `handle`, wait for the open to settle, run `body`. */
async function openThen(handle: FileSystemFileHandle, body: (unmount: () => Promise<void>) => Promise<void>) {
  const onOpenSettled = vi.fn();
  const props: ComponentProps<typeof DocumentEditor> = {
    active: true, fileToOpen: { seq: 1, handle }, onOpenSettled, onMeta: vi.fn(),
    saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
    onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
    onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let mounted = true;
  const unmount = async () => {
    if (!mounted) return;
    mounted = false;
    await act(async () => { root.unmount(); });
    container.remove();
  };
  try {
    await act(async () => { root.render(createElement(DocumentEditor, props)); });
    for (let i = 0; i < 400 && !onOpenSettled.mock.calls.length; i++)
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(onOpenSettled).toHaveBeenCalled();
    await body(unmount);
  } finally {
    await unmount();
  }
}

const leaked = () => created.filter((u) => !revoked.has(u));

it("revokes a closed tab's image thumbnails", async () => {
  await openThen(labelHandle("a.label", { customImages: { img1: { name: "logo.svg", bytes: SVG } } }), async (unmount) => {
    expect(created.length).toBeGreaterThan(0);
    expect(leaked().length).toBeGreaterThan(0); // still on screen while the tab is open
    await unmount();
    expect(leaked()).toEqual([]);
  });
}, 30_000);

it("never leaves a URL behind for a custom image that fails to decode", async () => {
  await openThen(labelHandle("b.label", {
    customImages: { good: { name: "logo.svg", bytes: SVG }, bad: { name: "bad.png", bytes: new Uint8Array([1, 2, 3]) } },
  }), async () => {
    // The open failed on bad.png, so logo.svg's decode never committed and
    // never minted its thumbnail (#432).
    expect(created).toEqual([]);
  });
}, 30_000);

it("a master whose images fail to decode leaves no URL from the ones that decoded (#432)", async () => {
  await openThen(labelHandle("c.label", {}), async () => {
    const assets: MasterAssets = {
      customImages: { good: { name: "logo.svg", bytes: SVG }, bad: { name: "bad.png", bytes: new Uint8Array([1, 2, 3]) } },
    };
    const bytes = packMaster({ ...lolevMaster(), id: "master-other", name: "Other" }, assets);
    vi.stubGlobal("showOpenFilePicker", async () => [{
      name: "other.master", getFile: async () => new File([bytes as unknown as BlobPart], "other.master"),
    }]);
    await act(async () => {
      await menu.actions.find((c) => c.id === "master-open")!.run();
      await new Promise((r) => setTimeout(r, 20));
    });
    // bad.png failed the adopt, so logo.svg's decode never reached state.
    expect(document.body.textContent).toContain("Could not open master");
    expect(leaked()).toEqual([]);
  });
}, 30_000);
