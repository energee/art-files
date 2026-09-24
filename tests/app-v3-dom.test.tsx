// app-v3-dom.test.tsx — real editor/list/inspector/history wiring in happy-dom.
// Graphics and font loading are replaced because this is a DOM contract check,
// not a browser raster test; the document model and editing components are real.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";

vi.mock("../src/components/PreviewCompare", () => ({ SNAP_PT: 6, PreviewCompare: (props: PreviewProps) => { perf.source = props.canvasRender; perf.preview = props; return null; } }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
type PreviewProps = import("react").ComponentProps<typeof import("../src/components/PreviewCompare").PreviewCompare>;
const perf = vi.hoisted(() => ({ fontLoads: 0, source: null as import("../src/canvas/draw").CanvasRenderSource | null, margin: null as null | ((n: number) => void), preview: null as PreviewProps | null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: (props: { onMarginChange: (n: number) => void }) => { perf.margin = props.onMarginChange; return null; } }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => { perf.fontLoads++; return (text: string, size: number) => text.length * size * 0.55; },
  labelFontCss: () => "sans-serif",
}));
import { DocumentEditor } from "../src/App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mount a real DocumentEditor; `onMeta` records the tab metadata it reports. */
async function mountEditor() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onMeta = vi.fn();
  await act(async () => {
    root.render(createElement(DocumentEditor, {
      active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta,
      saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
      onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
      onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
    }));
  });
  const unmount = async () => { await act(async () => { root.unmount(); }); container.remove(); };
  return { container, onMeta, unmount };
}

const pressUndo = () => act(async () => {
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
});

it("selects a v3 text layer, edits its content through the inspector, and undoes the label edit", async () => {
  const { container, onMeta, unmount } = await mountEditor();
  try {
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
    await pressUndo();
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
    await pressUndo();
    expect(onMeta.mock.lastCall?.[0].title).not.toBe("Peregrine");
    expect(editor.textContent).not.toContain("Peregrine");
  } finally {
    await unmount();
  }
});

// Issue #77: File → Save writes only the .label, so a master edit made before
// it (an added layer) is still unsaved — the editor must keep reporting it or
// the close prompt and the updater's dirty check go quiet and the layer is lost.
it("still reports an unsaved master edit after the label is saved", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onMeta = vi.fn();
  const saveSlot: { current: (() => Promise<boolean>) | null } = { current: null };
  try {
    await act(async () => {
      root.render(createElement(DocumentEditor, {
        active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta,
        saveSlot, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
        onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
        onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
      }));
    });
    expect(onMeta.mock.lastCall?.[0]).toMatchObject({ masterUnsaved: false });
    // base-ui's menu trigger opens on the full press, not click alone.
    const trigger = container.querySelector('[aria-label="Add layer"]')!;
    await act(async () => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
        trigger.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
      (trigger as HTMLElement).click();
      await Promise.resolve();
    });
    const text = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find((el) => el.textContent?.trim() === "Text") as HTMLElement;
    await act(async () => { text.click(); await Promise.resolve(); });
    expect(onMeta.mock.lastCall?.[0]).toMatchObject({ edited: true, masterUnsaved: true });
    let saved = false;
    await act(async () => { saved = await saveSlot.current!(); });
    expect(saved).toBe(true);
    expect(onMeta.mock.lastCall?.[0]).toMatchObject({ dirty: false, edited: true, masterUnsaved: true });
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

// #126 — opening the inspector must not steal focus into its rename box: the
// sheet opens on a selection, and Base UI's default initial focus landed in
// the first input, so a moment later Backspace/arrows renamed the layer
// ("Name" → "Nam") instead of deleting or nudging it.
it("leaves focus out of the inspector when a layer selection opens it", async () => {
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
    const row = container.querySelector('[data-layer-id="name"]')!;
    await act(async () => {
      (row.querySelector('[data-slot="sidebar-menu-button"]') as HTMLButtonElement).click();
    });
    // Base UI applies initial focus on the next animation frame after open.
    await act(async () => { await new Promise(requestAnimationFrame); });
    const sheet = document.querySelector('[data-slot="sheet-content"]');
    expect(sheet).not.toBeNull();
    expect(sheet!.contains(document.activeElement)).toBe(false);
  } finally {
    act(() => { root.unmount(); });
    container.remove();
  }
});

// Issue #73 — inspector fields passed a hard `coalesce: true`, so the first
// keystroke folded into whatever step came before it (a drag, a toggle): ⌘Z
// then undid the typing AND the earlier edit together.
it("opens a fresh undo step for inspector typing instead of folding into the previous edit", async () => {
  const { container, onMeta, unmount } = await mountEditor();
  try {
    const picker = () => container.querySelector("#master-picker")!.textContent ?? "";
    // The earlier, unrelated edit: switch the collab layer on (its own step).
    const leadPower = container.querySelector('[data-layer-id="collabLead"] button[aria-label$=": enabled"]') as HTMLButtonElement;
    await act(async () => leadPower.click());
    expect(picker()).toContain("Collab");
    const row = container.querySelector('[data-layer-id="name"]')!;
    await act(async () => {
      (row.querySelector('[data-slot="sidebar-menu-button"]') as HTMLButtonElement).click();
    });
    const editor = document.querySelector('[contenteditable="true"]') as HTMLElement;
    // Two keystrokes of one typing session: they coalesce with each other…
    for (const text of ["Pere", "Peregrine"]) {
      await act(async () => {
        editor.innerHTML = `<div>${text}</div>`;
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    expect(onMeta.mock.lastCall?.[0].title).toBe("Peregrine");
    // …but not with the toggle before them: one ⌘Z removes only the typing.
    await pressUndo();
    expect(onMeta.mock.lastCall?.[0].title).not.toMatch(/^Pere/);
    expect(picker()).toContain("Collab");
    await pressUndo();
    expect(picker()).not.toContain("Collab");
  } finally {
    await unmount();
  }
});

// Issue #74 — a drag (or resize) whose first move produced no patch (a
// snapped-to-zero delta) opened no undo step, yet its later moves still
// passed coalesce=true and folded into the edit before it; Escape's undo then
// reverted that earlier edit along with the drag.
async function renameThenGesture(gesture: (p: PreviewProps) => void) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onMeta = vi.fn();
  perf.source = null; // so the wait below waits for THIS mount's assets
  try {
    await act(async () => {
      root.render(createElement(DocumentEditor, {
        active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta,
        saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
        onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
        onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
      }));
    });
    // Gestures measure boxes off the decoded canvas assets.
    await vi.waitFor(() => expect(perf.source).not.toBeNull(), { timeout: 30_000 });
    const row = container.querySelector('[data-layer-id="name"]')!;
    await act(async () => {
      (row.querySelector('[data-slot="sidebar-menu-button"]') as HTMLButtonElement).click();
    });
    const editor = document.querySelector('[contenteditable="true"]') as HTMLElement;
    await act(async () => {
      editor.innerHTML = "<div>Peregrine</div>";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onMeta.mock.lastCall?.[0].title).toBe("Peregrine");
    await act(async () => gesture(perf.preview!));
    // Escape mid-gesture: undo only what the gesture itself did.
    await act(async () => perf.preview!.onDragCancel());
    expect(onMeta.mock.lastCall?.[0].title).toBe("Peregrine");
    // The rename is still its own step: one ⌘Z removes it.
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
    });
    expect(onMeta.mock.lastCall?.[0].title).not.toBe("Peregrine");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
}

it("a drag whose first move snaps to zero never folds into the previous edit", async () => {
  await renameThenGesture((p) => {
    // A first move whose snapped delta is zero patches nothing (snapDelta
    // passes an exact 0 through; a snap landing back on the start does too).
    expect(p.onDrag("barcode", 0, 0, true)).toMatchObject({ dx: 0, dy: 0 });
    p.onDrag("barcode", 40, 0, false);
  });
}, 60_000);

it("a resize whose first move changes nothing never folds into the previous edit", async () => {
  await renameThenGesture((p) => {
    // A text layer has no height to resize: a vertical-only pull is a no-op.
    p.onResize("name", { hx: 1, hy: 1 }, 0, 4, false, true);
    p.onResize("name", { hx: 1, hy: 1 }, 40, 4, false, false);
  });
}, 60_000);

it("Escape on a drag that never moved anything leaves the previous edit alone", async () => {
  await renameThenGesture((p) => { p.onDrag("barcode", 0, 0, true); });
}, 60_000);
