// app-v3-dom.test.tsx — real editor/list/inspector/history wiring in happy-dom.
// Graphics and font loading are replaced because this is a DOM contract check,
// not a browser raster test; the document model and editing components are real.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { packMaster } from "../src/model/files";
import { lolevMaster } from "../src/model/lolevLayers";

vi.mock("../src/components/PreviewCompare", () => ({ PreviewCompare: (props: { canvasRender: import("../src/canvas/draw").CanvasRenderSource | null }) => { perf.source = props.canvasRender; return null; } }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
const perf = vi.hoisted(() => ({ fontLoads: 0, source: null as import("../src/canvas/draw").CanvasRenderSource | null, margin: null as null | ((n: number) => void) }));
vi.mock("../src/components/Rulers", () => ({ Rulers: (props: { onMarginChange: (n: number) => void }) => { perf.margin = props.onMarginChange; return null; } }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => { perf.fontLoads++; return (text: string, size: number) => text.length * size * 0.55; },
  labelFontCss: () => "sans-serif",
}));
import { DocumentEditor } from "../src/App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("selects a v3 text layer, edits its content through the inspector, and undoes the label edit", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onMeta = vi.fn();
  try {
    await act(async () => {
      root.render(createElement(DocumentEditor, {
        active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta,
        saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
        onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
        onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
      }));
    });
    expect(container.querySelector("#master-picker")?.textContent).toContain("Lolev");
    // Switching a variant-added layer ON enables the variant that owns it —
    // read off the master Select, which names the version being shown now that
    // the variant chips are gone.
    const picker = () => container.querySelector("#master-picker")!.textContent ?? "";
    const leadPower = container.querySelector('[data-layer-id="collabLead"] button[aria-label$=": enabled"]') as HTMLButtonElement;
    expect(picker()).not.toContain("Collab");
    expect(leadPower.getAttribute("aria-pressed")).toBe("false");
    await act(async () => leadPower.click());
    expect(picker()).toContain("Collab");
    expect(leadPower.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).not.toContain("Invalid master file");
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
    });
    expect(picker()).not.toContain("Collab");
    const row = container.querySelector('[data-layer-id="name"]');
    expect(row).not.toBeNull();
    await act(async () => {
      (row!.querySelector('[data-slot="sidebar-menu-button"]') as HTMLButtonElement).click();
    });
    const editor = document.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(editor).not.toBeNull();
    await act(async () => {
      editor.innerHTML = "<div>Peregrine</div>";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onMeta.mock.lastCall?.[0]).toMatchObject({ title: "Peregrine", dirty: true, edited: true });
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
    });
    expect(onMeta.mock.lastCall?.[0].title).not.toBe("Peregrine");
    expect(editor.textContent).not.toContain("Peregrine");
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});

it("measures asset assembly while moving margin guides", async () => {
  vi.useFakeTimers();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(DocumentEditor, {
      active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
      saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
      onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
      onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
    })));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    const before = perf.fontLoads;
    const images = perf.source!.drawAssets;
    const oldTop = perf.source!.planAssets.guides!.top;
    for (let n = 0; n < 5; n++) {
      const previousTop = perf.source!.planAssets.guides!.top;
      await act(async () => perf.margin!(20 + n));
      expect(perf.source!.planAssets.guides!.top).not.toBe(previousTop);
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    }
    console.log("PERF guide asset assemblies", perf.fontLoads - before);
    expect(perf.fontLoads - before).toBe(0);
    expect(perf.source!.drawAssets).toBe(images);
    expect(perf.source!.planAssets.guides!.top).not.toBe(oldTop);
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers();
  }
});

// docs/plans/choice-input.md — the barcode and QR fill through App's own code
// field, not TextEditor, so wiring the picker into TextEditor alone left the
// tier list unreachable exactly where a tier is filled.
it("offers the barcode's tiers in the field that fills it", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(DocumentEditor, {
        active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
        saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
        onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
        onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
      }));
    });
    const row = container.querySelector('[data-layer-id="barcode"]')!;
    await act(async () => {
      (row.querySelector('[data-slot="sidebar-menu-button"]') as HTMLButtonElement).click();
    });
    // The inspector is a Sheet: it portals to document.body, not into the
    // container the app was rendered into.
    const field = document.querySelector("#barcode-content") as HTMLInputElement;
    expect(field).not.toBeNull();
    await act(async () => { field.focus(); });
    const tiers = Array.from(document.querySelectorAll("[data-choice]")).map((o) => o.textContent?.trim());
    expect(tiers).toContain("Tier 1");
    expect(tiers).toHaveLength(8);
  } finally {
    act(() => { root.unmount(); });
    container.remove();
  }
});

// docs/plans/template-switch.md, Task 10 — Open Master previews the
// rebind's bench counts (App.tsx's previewOpenedMaster / confirmOpenedMaster
// / rebindPreviewLine) before committing, through the same confirm-dialog
// pattern MasterSaveReview uses. The sidebar's own inline preview left with
// the library rows (MasterPicker no longer takes a `resolve`/`onMaster`);
// this is the only door left onto a different master.
function dialogContent() {
  return document.querySelector('[data-slot="dialog-content"]');
}
function dialogButton(text: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('[data-slot="dialog-content"] button'))
    .find((b) => b.textContent?.trim() === text);
}

/** A different brewery's master, missing the "name" layer entirely — so a
 *  label that has typed a name into it always benches that one value on
 *  rebind, a guaranteed non-empty preview (mirrors masterpicker-dom.test.tsx's
 *  otherMaster, which benched a variant instead — this drops a value). */
function otherMasterBytes(): Uint8Array {
  const base = lolevMaster();
  const other = {
    ...base, id: "other-brewery", name: "Other Brewery",
    layers: base.layers.filter((l) => l.id !== "name"),
  };
  return packMaster(other, {});
}

/** Drives the hidden `<input type="file" accept={MASTER_EXT}>` (App.tsx,
 *  Open Master's fallback) the same way a real file pick would, without a
 *  real OS dialog: happy-dom has no showOpenFilePicker, so openMasterPicker
 *  itself is unreachable here, but the input's onChange handler — the
 *  actual parse-and-preview code — runs on any input whose `files` changes. */
async function pickMasterFile(container: HTMLElement, name: string, bytes: Uint8Array) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([bytes as BlobPart], name);
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    // The handler reads the file asynchronously (arrayBuffer, then parse,
    // then setState) — a macrotask flush lands all of it before returning.
    await new Promise((r) => setTimeout(r, 0));
  });
}

it("Open Master previews the bench count and Cancel leaves the document alone", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(DocumentEditor, {
        active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
        saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
        onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
        onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
      }));
    });
    // Give the "name" layer a value so the alternate master (below) benches it.
    const row = container.querySelector('[data-layer-id="name"]')!;
    await act(async () => {
      (row.querySelector('[data-slot="sidebar-menu-button"]') as HTMLButtonElement).click();
    });
    const editor = document.querySelector('[contenteditable="true"]') as HTMLElement;
    await act(async () => {
      editor.innerHTML = "<div>Peregrine</div>";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(editor.textContent).toContain("Peregrine");

    await pickMasterFile(container, "other.master", otherMasterBytes());

    expect(dialogContent()?.textContent).toContain("Open Master");
    // The exact line, not just "a preview showed up" — this is the same
    // wording MasterPicker's now-deleted previewLine used, ported verbatim;
    // asserting it exactly catches the wording drifting silently.
    expect(dialogContent()?.textContent).toContain("1 value move to the bench — continue?");
    expect(container.querySelector("#master-picker")?.textContent).toContain("Lolev");

    await act(async () => { dialogButton("Cancel")!.click(); });
    expect(dialogContent()).toBeNull();
    // Nothing committed: the master is unchanged and the typed value is
    // still there — cancelling the preview must not touch the document.
    expect(container.querySelector("#master-picker")?.textContent).toContain("Lolev");
    expect(editor.textContent).toContain("Peregrine");
    // ...nor leave an extra step on the undo stack: one undo reverts
    // exactly the name edit above, nothing a cancelled rebind might add.
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
    });
    expect(editor.textContent).not.toContain("Peregrine");
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});

it("Open Master's Continue rebinds onto the opened master", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(DocumentEditor, {
        active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
        saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
        onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
        onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
      }));
    });
    await pickMasterFile(container, "other.master", otherMasterBytes());
    expect(dialogContent()).not.toBeNull();

    await act(async () => { dialogButton("Continue")!.click(); });
    expect(dialogContent()).toBeNull();
    expect(container.querySelector("#master-picker")?.textContent).toContain("Other Brewery");
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});
