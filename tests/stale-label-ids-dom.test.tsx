// stale-label-ids-dom.test.tsx — a .label opened on the master it names, after
// that master dropped a layer or a variant, must not carry the orphan ids
// forever (#409): values for missing layers and variants the master no longer
// has are benched on `dormant` (non-destructive) and reported, the same as a
// rebind onto a different master, and the tab is left unsaved so Save writes
// the cleaned label. A v2 label's orphans are reported too.
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { strToU8, zipSync } from "fflate";
import { packLabel, unpackLabel } from "../src/model/files";
import { setLanguage } from "../src/i18n";

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

afterEach(() => { setLanguage("en"); localStorage.clear(); document.body.innerHTML = ""; });

type Ctx = {
  container: HTMLElement; save: () => Promise<void>; writes: Uint8Array[];
  /** The tab's dirty flag after the open — false means Save is disabled. */
  dirty: boolean;
};

/** Mount a DocumentEditor opening `label` (packed as a.label, or raw .label
 *  bytes) on the shipped master, wait for the open to settle, run `check`,
 *  then unmount. Saves land in `writes`. */
async function openLabel(
  label: Parameters<typeof packLabel>[0] | Uint8Array,
  check: (ctx: Ctx) => Promise<void>,
) {
  const bytes = label instanceof Uint8Array ? label : packLabel(label, {});
  const writes: Uint8Array[] = [];
  const handle = {
    name: "a.label",
    getFile: async () => new File([bytes as unknown as BlobPart], "a.label"),
    createWritable: async () => ({ write: async (b: Uint8Array) => { writes.push(b); }, close: async () => {} }),
  } as unknown as FileSystemFileHandle;
  const onOpenSettled = vi.fn();
  const onMeta = vi.fn();
  const saveSlot: { current: (() => Promise<boolean>) | null } = { current: null };
  const props: ComponentProps<typeof DocumentEditor> = {
    active: true, fileToOpen: { seq: 1, handle }, onOpenSettled, onMeta,
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
    expect(onOpenSettled).toHaveBeenCalledWith(1, false);
    const save = () => act(async () => { expect(await saveSlot.current!()).toBe(true); });
    await check({ container, save, writes, dirty: onMeta.mock.calls.at(-1)![0].dirty });
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
  }, async ({ container, save, writes, dirty }) => {
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("gone-layer");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("gone-variant");
    expect(dirty).toBe(true); // Save stays live so the cleaned label reaches disk

    await save();
    const saved = unpackLabel(writes.at(-1)!).label!;
    expect(saved.enabledVariants).toEqual(["collab"]);
    expect(saved.values["gone-layer"]).toBeUndefined();
    expect(saved.values.name?.[0]).toMatchObject({ text: "Alpha" });
    expect(saved.dormant).toMatchObject({ values: { "gone-layer": "stale" }, variants: ["gone-variant"] });
  });
}, 30_000);

// The note is marked a warning where it is made, so it stays amber after the
// UI language changes (its text keeps the language it was made in).
it("keeps the open's note a warning after a language switch", async () => {
  await openLabel({ formatVersion: 3, masterId: "lolev", enabledVariants: [], values: { "gone-layer": "stale" } }, async ({ container }) => {
    const alert = () => container.querySelector('[role="alert"]');
    expect(alert()?.querySelector(".text-warning-text")?.textContent).toContain("gone-layer");
    await act(async () => { setLanguage("de"); });
    expect(alert()?.querySelector(".text-warning-text")?.textContent).toContain("gone-layer");
  });
}, 30_000);

// A bench the label already carries (a collab rebind off another master) is
// not news: reopening it must not announce "benched" every time (#409 review).
it("does not re-announce values and variants the label already had benched", async () => {
  await openLabel({
    formatVersion: 3, masterId: "lolev", enabledVariants: [],
    values: { name: "Alpha" },
    // "constructor" is an Object.prototype key: an `in` test would mistake it
    // for a live value and announce it.
    dormant: { values: { "other-layer": "x", constructor: "y" }, variants: ["other-variant"] },
  }, async ({ container, save, writes, dirty }) => {
    expect(container.textContent).not.toContain("benched");
    expect(dirty).toBe(false);
    await save();
    const saved = unpackLabel(writes.at(-1)!).label!;
    expect(saved.dormant).toMatchObject({ values: { "other-layer": "x", constructor: "y" }, variants: ["other-variant"] });
  });
}, 30_000);

// convertLabelV2 benches a v2 label's orphan values without a warning, so the
// open must judge "newly benched" against the file as written (#409 review).
it("reports a v2 label's value for a layer its master no longer has", async () => {
  const bytes = zipSync({ "label.json": strToU8(JSON.stringify({
    formatVersion: 2, masterId: "lolev", enabledVariants: [],
    values: { name: "Alpha", "gone-layer": "stale" },
  })) });
  await openLabel(bytes, async ({ container, dirty }) => {
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("gone-layer");
    expect(dirty).toBe(true);
  });
}, 30_000);
