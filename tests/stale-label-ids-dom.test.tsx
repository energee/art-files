// stale-label-ids-dom.test.tsx — a .label opened on the master it names, after
// that master dropped a layer or a variant, must not carry the orphan ids
// forever (#409): values for missing layers and variants the master no longer
// has are benched on `dormant` (non-destructive) and reported, the same as a
// rebind onto a different master.
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { localStorage.clear(); document.body.innerHTML = ""; });

it("benches and reports orphan value and variant ids when a label opens on its own master (#409)", async () => {
  const bytes = packLabel({
    formatVersion: 3, masterId: "lolev", enabledVariants: ["collab", "gone-variant"],
    values: {
      name: [{ text: "Alpha", fill: "#F3CD80", layer: "metallic" }],
      "gone-layer": "stale",
    },
  }, {});
  const writes: Uint8Array[] = [];
  const handle = {
    name: "a.label",
    getFile: async () => new File([bytes as unknown as BlobPart], "a.label"),
    createWritable: async () => ({ write: async (b: Uint8Array) => { writes.push(b); }, close: async () => {} }),
  } as unknown as FileSystemFileHandle;
  const onOpenSettled = vi.fn();
  const saveSlot: { current: (() => Promise<boolean>) | null } = { current: null };
  const props: ComponentProps<typeof DocumentEditor> = {
    active: true, fileToOpen: { seq: 1, handle }, onOpenSettled, onMeta: vi.fn(),
    saveSlot, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
    onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
    onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
  };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  try {
    await act(async () => { root.render(createElement(DocumentEditor, props)); });
    for (let i = 0; i < 400 && !onOpenSettled.mock.calls.length; i++)
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(onOpenSettled).toHaveBeenCalledWith(1);
    expect(container.textContent).toContain("1 value(s) benched: gone-layer");
    expect(container.textContent).toContain("1 variant(s) benched: gone-variant");

    await act(async () => { await saveSlot.current!(); });
    const saved = unpackLabel(writes.at(-1)!).label!;
    expect(saved.enabledVariants).toEqual(["collab"]);
    expect(saved.values["gone-layer"]).toBeUndefined();
    expect(saved.values.name?.[0]).toMatchObject({ text: "Alpha" });
    expect(saved.dormant).toMatchObject({ values: { "gone-layer": "stale" }, variants: ["gone-variant"] });
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
}, 30_000);
