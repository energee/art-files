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

/** Mount a DocumentEditor opening `label` (packed as a.label) on the shipped
 *  master, wait for the open to settle, run `check`, then unmount. Saves land
 *  in `writes`. */
async function openLabel(
  label: Parameters<typeof packLabel>[0],
  check: (ctx: { container: HTMLElement; save: () => Promise<void>; writes: Uint8Array[] }) => Promise<void>,
) {
  const bytes = packLabel(label, {});
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
    const save = () => act(async () => { expect(await saveSlot.current!()).toBe(true); });
    await check({ container, save, writes });
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
}

it("benches and reports orphan value and variant ids when a label opens on its own master (#409)", async () => {
  await openLabel({
    formatVersion: 3, masterId: "lolev", enabledVariants: ["collab", "gone-variant"],
    values: {
      name: [{ text: "Alpha", fill: "#F3CD80", layer: "metallic" }],
      "gone-layer": "stale",
    },
  }, async ({ container, save, writes }) => {
    expect(container.textContent).toContain("1 value(s) benched: gone-layer");
    expect(container.textContent).toContain("1 variant(s) benched: gone-variant");

    await save();
    const saved = unpackLabel(writes.at(-1)!).label!;
    expect(saved.enabledVariants).toEqual(["collab"]);
    expect(saved.values["gone-layer"]).toBeUndefined();
    expect(saved.values.name?.[0]).toMatchObject({ text: "Alpha" });
    expect(saved.dormant).toMatchObject({ values: { "gone-layer": "stale" }, variants: ["gone-variant"] });
  });
}, 30_000);

// A bench the label already carries (a collab rebind off another master) is
// not news: reopening it must not announce "benched" every time (#409 review).
it("does not re-announce values and variants the label already had benched", async () => {
  await openLabel({
    formatVersion: 3, masterId: "lolev", enabledVariants: [],
    values: { name: "Alpha" },
    dormant: { values: { "other-layer": "x" }, variants: ["other-variant"] },
  }, async ({ container, save, writes }) => {
    expect(container.textContent).not.toContain("benched");
    await save();
    const saved = unpackLabel(writes.at(-1)!).label!;
    expect(saved.dormant).toMatchObject({ values: { "other-layer": "x" }, variants: ["other-variant"] });
  });
}, 30_000);
