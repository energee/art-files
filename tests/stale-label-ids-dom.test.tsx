// stale-label-ids-dom.test.tsx — a .label opened on the master it names, after
// that master dropped a layer or a variant, must not carry the orphan ids
// forever (#409): values for missing layers and variants the master no longer
// has are benched on `dormant` (non-destructive) and reported, the same as a
// rebind onto a different master, and the tab is left unsaved so Save writes
// the cleaned label. A v2 label's orphans are reported too. The report is one
// warning toast per open (the real <Toaster /> is mounted beside the editor).
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { strToU8, zipSync } from "fflate";
import { packLabel, unpackLabel } from "../src/model/files";
import { setLanguage } from "../src/i18n";
import { mountToaster, settle, shown, toastTitles, unmountToaster } from "./real-timer-toaster";

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

afterEach(() => { setLanguage("system"); localStorage.clear(); document.body.innerHTML = ""; });

type Ctx = {
  save: () => Promise<void>; writes: Uint8Array[];
  /** Closes the tab: the editor unmounts, the toaster stays. */
  closeTab: () => Promise<void>;
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
  await mountToaster();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  try {
    await act(async () => { root.render(createElement(DocumentEditor, props)); });
    for (let i = 0; i < 400 && !onOpenSettled.mock.calls.length; i++)
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(onOpenSettled).toHaveBeenCalledWith(1, false);
    const save = () => act(async () => { expect(await saveSlot.current!()).toBe(true); });
    const closeTab = () => act(async () => { root.unmount(); });
    await check({ save, writes, closeTab, dirty: onMeta.mock.calls.at(-1)![0].dirty });
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    await unmountToaster();
  }
}

it("benches and reports orphan value and variant ids when a label opens on its own master (#409)", async () => {
  await openLabel({
    formatVersion: 3, masterId: "lolev", enabledVariants: ["collab", "gone-variant"],
    values: {
      name: [{ text: "Alpha", fill: "#F3CD80", layer: "metallic" }],
      "gone-layer": "stale",
    },
  }, async ({ save, writes, dirty }) => {
    await shown("gone-layer");
    expect(document.body.textContent).toContain("gone-variant");
    expect(dirty).toBe(true); // Save stays live so the cleaned label reaches disk

    await save();
    const saved = unpackLabel(writes.at(-1)!).label!;
    expect(saved.enabledVariants).toEqual(["collab"]);
    expect(saved.values["gone-layer"]).toBeUndefined();
    expect(saved.values.name?.[0]).toMatchObject({ text: "Alpha" });
    expect(saved.dormant).toMatchObject({ values: { "gone-layer": "stale" }, variants: ["gone-variant"] });
  });
}, 30_000);

// What the open benched shows once, as a warning toast with no "Note:" lead-in:
// a second render of the editor (a language switch) must not show it again.
it("open warnings show once, without Note:", async () => {
  await openLabel({
    formatVersion: 3, masterId: "lolev", enabledVariants: ["gone-variant"], values: { "gone-layer": "stale" },
  }, async () => {
    await shown("gone-layer");
    await act(async () => { setLanguage("de"); });
    await settle();
    // The title names the file; what was benched is the description.
    expect(toastTitles()).toHaveLength(1);
    expect(toastTitles()[0]).toContain("a.label");
    const toast = document.querySelector("[data-sonner-toast]")!;
    expect(toast.querySelector("[data-description]")!.textContent).toContain("gone-variant");
    expect(document.body.textContent).not.toContain("Note:");
    expect(toast.getAttribute("data-type")).toBe("warning");
    // A warning stays until closed; it has a close button.
    expect(toast.querySelector("[data-close-button]")).not.toBeNull();
  });
}, 30_000);

it("names the file in the warning's title and the benched values in its description", async () => {
  await openLabel({
    formatVersion: 3, masterId: "lolev", enabledVariants: [], values: { "gone-layer": "stale" },
  }, async () => {
    await shown("gone-layer");
    expect(toastTitles()).toEqual(["Opened a.label with changes"]);
    expect(document.querySelector("[data-sonner-toast] [data-description]")!.textContent).toBe("1 value benched: gone-layer");
  });
}, 30_000);

// The warning is about this tab's label, so it goes with the tab. A failure to
// open or load reports a problem nothing else in the editor shows, and stays.
it("closing the tab dismisses its open warning", async () => {
  await openLabel({
    formatVersion: 3, masterId: "lolev", enabledVariants: [], values: { "gone-layer": "stale" },
  }, async ({ closeTab }) => {
    await shown("gone-layer");
    await closeTab();
    await vi.waitFor(() => expect(toastTitles()).toEqual([]), { timeout: 5_000 });
  });
}, 30_000);

it("a load failure's toast survives its tab closing", async () => {
  await openLabel(new TextEncoder().encode("not a label"), async ({ closeTab }) => {
    await shown("Could not open a.label");
    await closeTab();
    await settle();
    expect(toastTitles()).toHaveLength(1);
    expect(toastTitles()[0]).toContain("Could not open a.label");
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
  }, async ({ save, writes, dirty }) => {
    await settle();
    expect(toastTitles()).toEqual([]);
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
  await openLabel(bytes, async ({ dirty }) => {
    await shown("gone-layer");
    expect(dirty).toBe(true);
  });
}, 30_000);
