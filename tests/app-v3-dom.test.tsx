// app-v3-dom.test.tsx — real editor/list/inspector/history wiring in happy-dom.
// Graphics and font loading are replaced because this is a DOM contract check,
// not a browser raster test; the document model and editing components are real.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import type { TextLayer } from "../src/model/layers";

vi.mock("../src/components/PreviewCompare", () => ({ SNAP_PT: 6, PreviewCompare: (props: PreviewProps) => { perf.source = props.canvasRender; perf.preview = props; return null; } }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
type PreviewProps = import("react").ComponentProps<typeof import("../src/components/PreviewCompare").PreviewCompare>;
const perf = vi.hoisted(() => ({ facesGate: null as Promise<void> | null, fontLoads: 0, fontArgs: [] as unknown[][], source: null as import("../src/canvas/draw").CanvasRenderSource | null, margin: null as null | ((n: number) => void), preview: null as PreviewProps | null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: (props: { onMarginChange: (n: number) => void }) => { perf.margin = props.onMarginChange; return null; } }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async (...args: unknown[]) => { perf.fontLoads++; perf.fontArgs.push(args); await perf.facesGate; return (text: string, size: number) => text.length * size * 0.55; },
  labelFontCss: () => "sans-serif",
  FONT_URLS: { poppins: {}, "barlow-condensed": {} },
}));
// Exports wait on loadFonts; the export test holds every call open to read
// the in-flight overlay, then rejects them all to finish the export. Every
// pending reject is kept: an export makes several loadFonts calls, and the
// inspector's character-height readout may make another.
const exportFonts = vi.hoisted(() => ({ rejects: [] as ((e: Error) => void)[] }));
vi.mock("../src/pdf/fonts", () => ({
  loadFonts: () => new Promise((_resolve, reject) => { exportFonts.rejects.push(reject); }),
}));
import { DocumentEditor } from "../src/App";

/** Mount a real DocumentEditor; `onMeta` records the tab metadata it reports. */
async function mountEditor() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onMeta = vi.fn();
  const saveSlot: { current: (() => Promise<boolean>) | null } = { current: null };
  await act(async () => {
    root.render(createElement(DocumentEditor, {
      active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta,
      saveSlot, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
      onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
      onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
    }));
  });
  const unmount = async () => { await act(async () => { root.unmount(); }); container.remove(); };
  return { container, onMeta, saveSlot, unmount };
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

async function withEditor(run: () => Promise<void>) {
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
    await run();
  } finally {
    act(() => { root.unmount(); });
    container.remove();
  }
}

async function selectLayer(id: string) {
  const row = document.querySelector(`[data-layer-id="${id}"]`)!;
  await act(async () => {
    (row.querySelector('[data-slot="sidebar-menu-button"]') as HTMLButtonElement).click();
  });
}

/** Type into a React-controlled input the way the browser does: the native
 *  value setter, then an input event React's onChange listens for. */
function typeInto(input: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

// #128/#129 — an invalid fill is stored in the label but resolveLayers skips
// applying it, so a field fed from the RESOLVED layer snapped back to the
// master's value (barcode) or went blank (ABV) while the header named the
// bad value. The field must show what the label holds, error beneath.
it("keeps an invalid barcode code in the Code field, with its error (#128)", async () => {
  await withEditor(async () => {
    await selectLayer("barcode");
    const field = () => document.querySelector("#barcode-content") as HTMLInputElement;
    await act(async () => { field().focus(); });
    await act(async () => { typeInto(field(), "ABC123"); });
    await act(async () => {
      field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await act(async () => { field().blur(); });
    expect(field().value).toBe("ABC123");
    expect(field().getAttribute("aria-invalid")).toBe("true");
  });
});

// #221 — after a rejected code, retyping the master's valid code and leaving
// the field with Tab (a blur, no Enter) must commit it and clear the error,
// exactly as Enter does.
it("clears a rejected barcode code when the valid one is retyped and Tabbed out (#221)", async () => {
  await withEditor(async () => {
    await selectLayer("barcode");
    const field = () => document.querySelector("#barcode-content") as HTMLInputElement;
    const good = field().value;
    await act(async () => { field().focus(); });
    await act(async () => { typeInto(field(), "ABC123"); });
    await act(async () => { field().blur(); });
    expect(field().getAttribute("aria-invalid")).toBe("true");
    await act(async () => { field().focus(); });
    await act(async () => { typeInto(field(), good); });
    await act(async () => { field().blur(); });
    expect(field().value).toBe(good);
    expect(field().getAttribute("aria-invalid")).toBeNull();
  });
});

it("keeps a negative ABV in the ABV field, with its error (#129)", async () => {
  await withEditor(async () => {
    await selectLayer("abv");
    const field = () => document.querySelector("#abv-content") as HTMLInputElement;
    await act(async () => { field().focus(); });
    await act(async () => { typeInto(field(), "-3"); });
    await act(async () => { field().blur(); });
    expect(field().value).toBe("-3");
    expect(document.body.textContent).toContain("Must be at least 0.");
  });
});

// #171 — the on-canvas editor read the RESOLVED layer too, so after a
// rejected entry it opened on the master's value (a blank ABV) while the
// header named the bad one. It must open on what the label holds.
it("opens the on-canvas editor on a rejected ABV, not the master value (#171)", async () => {
  await withEditor(async () => {
    await selectLayer("abv");
    const field = () => document.querySelector("#abv-content") as HTMLInputElement;
    await act(async () => { field().focus(); });
    await act(async () => { typeInto(field(), "25"); });
    await act(async () => { field().blur(); });
    expect(document.body.textContent).toContain("Must be at most 20.");
    const p = perf.preview!;
    const shown = p.editLayerOf(p.layers.find((l) => l.id === "abv")!);
    expect(shown.kind === "text" && shown.lines[0].text).toBe("25");
  });
});

// docs/plans/choice-input.md — the barcode and QR fill through App's own code
// field, not TextEditor, so wiring the picker into TextEditor alone left the
// tier list unreachable exactly where a tier is filled.
it("offers the barcode's tiers in the field that fills it", async () => {
  await withEditor(async () => {
    await selectLayer("barcode");
    // The inspector is a Sheet: it portals to document.body, not into the
    // container the app was rendered into.
    const field = document.querySelector("#barcode-content") as HTMLInputElement;
    expect(field).not.toBeNull();
    await act(async () => { field.focus(); });
    const tiers = Array.from(document.querySelectorAll("[data-choice]")).map((o) => o.textContent?.trim());
    expect(tiers).toContain("Tier 1");
    expect(tiers).toHaveLength(8);
  });
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

// Issue #411 — the preview loads only the families a label uses, so picking a
// new font on a layer must hand that family to the font gate.
it("loads a layer's newly picked font family (#411)", async () => {
  const { container, unmount } = await mountEditor();
  try {
    expect(perf.fontArgs.at(-1)).toEqual(["poppins", []]);
    const row = container.querySelector('[data-layer-id="name"]')!;
    await act(async () => {
      (row.querySelector('[data-slot="sidebar-menu-button"]') as HTMLButtonElement).click();
    });
    const font = document.querySelector('[aria-label="Font"]')!;
    await act(async () => { font.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const option = Array.from(document.querySelectorAll('[role="option"]'))
      .find((el) => el.textContent?.includes("Barlow Condensed"))!;
    await act(async () => {
      option.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
      option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(perf.fontArgs.at(-1)).toEqual(["poppins", ["barlow-condensed"]]);
  } finally {
    await unmount();
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

/** mountEditor, then waits for its canvas assets (gestures measure boxes off
 *  them), runs `body`, and unmounts. `p()` reads the latest PreviewCompare
 *  props, so it sees each re-render's layers. */
async function withCanvasEditor(
  body: (
    p: () => PreviewProps, container: HTMLElement, onMeta: ReturnType<typeof vi.fn>,
    save: () => Promise<boolean>,
  ) => Promise<void>,
) {
  perf.source = null; // so the wait below waits for THIS mount's assets
  const { container, onMeta, saveSlot, unmount } = await mountEditor();
  try {
    await vi.waitFor(() => expect(perf.source).not.toBeNull(), { timeout: 30_000 });
    await body(() => perf.preview!, container, onMeta, () => saveSlot.current!());
  } finally {
    await unmount();
  }
}

// Issue #74 — a drag (or resize) whose first move produced no patch (a
// snapped-to-zero delta) opened no undo step, yet its later moves still
// passed coalesce=true and folded into the edit before it; Escape's undo then
// reverted that earlier edit along with the drag.
async function renameThenGesture(
  gesture: (p: PreviewProps) => void, cancel = (p: PreviewProps) => p.onDragCancel(),
) {
  await withCanvasEditor(async (p, container, onMeta) => {
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
    await act(async () => gesture(p()));
    // Escape mid-gesture: undo only what the gesture itself did.
    await act(async () => cancel(p()));
    expect(onMeta.mock.lastCall?.[0].title).toBe("Peregrine");
    // The rename is still its own step: one ⌘Z removes it.
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
    });
    expect(onMeta.mock.lastCall?.[0].title).not.toBe("Peregrine");
  });
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

// #132: the inspector Sheet is 300px at every width (see the SheetContent
// comment in App.tsx for why the base's variant classes won). happy-dom
// computes no Tailwind CSS, so this pins the merged class list instead.
it("sizes the inspector sheet to 300px at every breakpoint (#132)", async () => {
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
    const sheet = document.querySelector('[data-slot="sheet-content"]');
    expect(sheet).not.toBeNull();
    // Only what applies to this right-side sheet: other sides' classes never match.
    const sizing = sheet!.className.split(/\s+/)
      .filter((c) => /(^|:)(max-)?w-/.test(c) && !/data-\[side=(left|top|bottom)\]/.test(c));
    expect(sizing.length).toBeGreaterThan(0);
    for (const c of sizing) expect(c).toMatch(/w-\[300px\]$|max-w-none$/);
  } finally {
    act(() => { root.unmount(); });
    container.remove();
  }
});

// Issue #164 — a drag's moves are patches against the layer as it was at the
// gesture's start, but each one landed on the doc as it was AFTER the last
// move: an axis whose delta returned to exactly 0 patched nothing for that
// axis, so the layer kept the last move's offset there instead of returning
// to where the drag began.
const layerOf = (p: PreviewProps, id: string) => p.layers.find((l) => l.id === id)!;

it("a drag back to exactly its start puts the layer back where it began", async () => {
  await withCanvasEditor(async (p) => {
    const { x, y } = layerOf(p(), "barcode");
    await act(async () => p().onDrag("barcode", 40, 30, true));
    expect(layerOf(p(), "barcode").x).not.toBe(x);
    await act(async () => p().onDrag("barcode", 0, 0, false));
    expect(layerOf(p(), "barcode")).toMatchObject({ x, y });
  });
}, 60_000);

it("a drag back to its start on one axis restores that axis", async () => {
  await withCanvasEditor(async (p) => {
    const { x } = layerOf(p(), "barcode");
    await act(async () => p().onDrag("barcode", 40, 0, true));
    await act(async () => p().onDrag("barcode", 0, 30, false));
    expect(layerOf(p(), "barcode").x).toBe(x);
  });
}, 60_000);

// #164 part 1 — the in-place editor's first keystroke must open the session's
// step even when it leaves the text as it was (a rejected character in a
// number field re-applies the same value), or Escape reverts the edit before.
it("an in-place session whose first keystroke changes nothing never folds into the previous edit", async () => {
  await renameThenGesture((p) => {
    const { lines } = layerOf(p, "abv") as TextLayer;
    p.onEditText("abv", lines, true);
    p.onEditText("abv", [{ ...lines[0], text: "6.5" }], false);
  }, (p) => p.onEditCancel());
}, 60_000);

it("each arrow nudge has its own undo step (#287)", async () => {
  const { container, unmount } = await mountEditor();
  try {
    await vi.waitFor(() => expect(perf.source).not.toBeNull());
    const row = container.querySelector('[data-layer-id="name"] [data-slot="sidebar-menu-button"]') as HTMLButtonElement;
    await act(async () => row.click());
    const x = () => layerOf(perf.preview!, "name").x;
    const start = x();
    for (let n = 0; n < 2; n++) await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(x()).toBeCloseTo(start + 2);
    await pressUndo();
    expect(x()).toBeCloseTo(start + 1);
    await pressUndo();
    expect(x()).toBeCloseTo(start);
  } finally { await unmount(); }
});

/** Stubs the browser save picker with a handle whose writes succeed. */
function stubSavePicker() {
  const handle = { name: "Beer.label", createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
  vi.stubGlobal("showSaveFilePicker", async () => handle);
}

// A held arrow key is ONE gesture: OS auto-repeat keydowns (e.repeat) fold
// into the step the first press opened, so a long hold can't push the rest
// of the history past its 100-step limit.
it("a held arrow key nudges as one undo step", async () => {
  const { container, unmount } = await mountEditor();
  try {
    await vi.waitFor(() => expect(perf.source).not.toBeNull());
    const row = container.querySelector('[data-layer-id="name"] [data-slot="sidebar-menu-button"]') as HTMLButtonElement;
    await act(async () => row.click());
    const x = () => layerOf(perf.preview!, "name").x;
    const start = x();
    for (const repeat of [false, true, true]) await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", repeat, bubbles: true }));
    });
    expect(x()).toBeCloseTo(start + 3);
    await pressUndo();
    expect(x()).toBeCloseTo(start);
  } finally { await unmount(); }
}, 60_000);

// The 3D can's OrbitControls take the arrow keys (pan/rotate) and call
// preventDefault: a handled arrow must not also nudge the selected layer.
it("an arrow key something else already handled does not nudge", async () => {
  const { container, unmount } = await mountEditor();
  try {
    await vi.waitFor(() => expect(perf.source).not.toBeNull());
    const row = container.querySelector('[data-layer-id="name"] [data-slot="sidebar-menu-button"]') as HTMLButtonElement;
    await act(async () => row.click());
    const start = layerOf(perf.preview!, "name").x;
    const owner = document.createElement("div");
    document.body.append(owner);
    owner.addEventListener("keydown", (e) => e.preventDefault());
    await act(async () => {
      owner.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    });
    owner.remove();
    expect(layerOf(perf.preview!, "name").x).toBe(start);
  } finally { await unmount(); }
}, 60_000);

// React bubbles a portaled menu's click through the component tree, so the
// sidebar's click-empty-space-to-deselect saw Add layer → Image and cleared
// the selection onAddLayer had just set.
it("Add layer from the portaled menu leaves the new layer selected", async () => {
  const { container, unmount } = await mountEditor();
  try {
    await vi.waitFor(() => expect(perf.preview).not.toBeNull());
    const trigger = container.querySelector('[aria-label="Add layer"]')!;
    await act(async () => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
        trigger.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
      (trigger as HTMLElement).click();
      await Promise.resolve();
    });
    const image = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find((el) => el.textContent?.trim() === "Image") as HTMLElement;
    expect(container.contains(image)).toBe(false); // it really is portaled
    await act(async () => { image.click(); await Promise.resolve(); });
    expect(perf.preview!.selected).toHaveLength(1);
  } finally { await unmount(); }
}, 60_000);

it("cancelling in-place text restores the pre-session dirty state (#278)", async () => {
  stubSavePicker();
  try {
    await withCanvasEditor(async (p, _container, onMeta, save) => {
      // Start from a saved, untouched doc so a cancel that leaves it dirty fails.
      await act(async () => { expect(await save()).toBe(true); });
      expect(onMeta.mock.calls.at(-1)![0]).toMatchObject({ dirty: false, edited: false });
      const lines = (layerOf(p(), "name") as TextLayer).lines;
      await act(async () => p().onEditSession?.("name"));
      await act(async () => p().onEditText("name", [{ ...lines[0], text: "Temporary" }], true));
      expect(onMeta.mock.calls.at(-1)![0]).toMatchObject({ dirty: true, edited: true });
      await act(async () => p().onEditCancel());
      await act(async () => p().onEditSession?.(null));
      expect((layerOf(p(), "name") as TextLayer).lines).toEqual(lines);
      expect(onMeta.mock.calls.at(-1)![0]).toMatchObject({ dirty: false, edited: false });
    });
  } finally {
    vi.unstubAllGlobals();
  }
}, 60_000);

it("cancelling in-place text after a mid-session save leaves the tab dirty", async () => {
  stubSavePicker();
  try {
    await withCanvasEditor(async (p, _container, onMeta, save) => {
      await act(async () => { expect(await save()).toBe(true); });
      const lines = (layerOf(p(), "name") as TextLayer).lines;
      await act(async () => p().onEditSession?.("name"));
      await act(async () => p().onEditText("name", [{ ...lines[0], text: "TYPEDTEXT" }], true));
      // ⌘S inside the field: the file now holds TYPEDTEXT.
      await act(async () => { expect(await save()).toBe(true); });
      expect(onMeta.mock.calls.at(-1)![0].dirty).toBe(false);
      await act(async () => p().onEditCancel());
      await act(async () => p().onEditSession?.(null));
      expect((layerOf(p(), "name") as TextLayer).lines).toEqual(lines);
      // The reverted doc no longer matches the file.
      expect(onMeta.mock.calls.at(-1)![0]).toMatchObject({ dirty: true, edited: true });
    });
  } finally {
    vi.unstubAllGlobals();
  }
}, 60_000);

// Undoing an add leaves the added id in the selection. Delete on a still-
// present selected row must drop that stale id, not throw "Unknown layer"
// and delete nothing.
it("Delete with a stale id in a multi-row selection removes the rows that exist", async () => {
  const { container, unmount } = await mountEditor();
  try {
    await vi.waitFor(() => expect(perf.preview).not.toBeNull());
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
    const added = perf.preview!.selected[0];
    const nameRow = () => container.querySelector('[data-layer-id="name"] [data-slot="sidebar-menu-button"]') as HTMLButtonElement | null;
    await act(async () => nameRow()!.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })));
    expect(perf.preview!.selected).toEqual(expect.arrayContaining([added, "name"]));
    await pressUndo();
    expect(container.querySelector(`[data-layer-id="${added}"]`)).toBeNull();
    await act(async () => nameRow()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
    expect(nameRow()).toBeNull();
  } finally { await unmount(); }
}, 60_000);

// An export's status region exists before the export starts, so a screen
// reader announces "Building …" (a live region mounted already holding its
// text is not announced). PSD export isn't gated on the preview, so its note
// shows, not "rendering label…", while the preview is still assembling.
it("the export note is announced through a pre-existing status region, preview ready or not", async () => {
  // Hold the font faces so the preview stays unassembled throughout.
  let release!: () => void;
  perf.facesGate = new Promise((r) => { release = r; });
  perf.source = null;
  const { container, unmount } = await mountEditor();
  try {
    const region = container.querySelector('[data-export-status]');
    expect(region?.getAttribute("role")).toBe("status");
    expect(region?.textContent).toBe("");
    exportFonts.rejects = [];
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "e", metaKey: true, shiftKey: true, bubbles: true }));
    });
    expect(container.querySelector('[data-export-status]')).toBe(region);
    expect(region!.textContent).toBe("Building PSDs…");
    expect(container.textContent).not.toContain("rendering label…");
    await vi.waitFor(() => expect(exportFonts.rejects.length).toBeGreaterThan(0));
    await act(async () => { for (const reject of exportFonts.rejects) reject(new Error("stop")); });
    await vi.waitFor(() => expect(region!.textContent).toBe(""));
    expect(perf.source).toBeNull(); // the preview never assembled
  } finally { await unmount(); release(); perf.facesGate = null; }
}, 60_000);

// Issue #401: an export blurred the preview under a "rendering preview…" note,
// so a long export read as a stalled preview. The note names the export.
it.each([
  ["PDFs", { key: "e", metaKey: true }],
  ["PSDs", { key: "e", metaKey: true, shiftKey: true }],
])("an export in flight shows Building %s…, not rendering preview…", async (kind, keys) => {
  await withCanvasEditor(async (_p, container) => {
    exportFonts.rejects = [];
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { ...keys, bubbles: true }));
    });
    // Announced, not just drawn: a screen reader hears what the blur means.
    expect([...container.querySelectorAll('[role="status"]')].map((el) => el.textContent))
      .toContain(`Building ${kind}…`);
    expect(container.textContent).not.toContain("rendering preview…");
    await vi.waitFor(() => expect(exportFonts.rejects.length).toBeGreaterThan(0));
    await act(async () => { for (const reject of exportFonts.rejects) reject(new Error("stop")); });
    await vi.waitFor(() => expect(container.textContent).not.toContain(`Building ${kind}…`));
  });
}, 60_000);

// Issue #425: the status-bar view button gave a screen reader only its visible
// text — not that a click cycles the view, nor the 1–3 keys.
it("names the view-mode button's action and its keyboard shortcuts", async () => {
  const { container, unmount } = await mountEditor();
  try {
    const button = [...container.querySelectorAll("button")]
      .find((b) => b.textContent?.startsWith("View Mode:")) as HTMLButtonElement;
    expect(button.getAttribute("aria-label")).toBe("View Mode: Label — switch to Mask");
    expect(button.getAttribute("aria-keyshortcuts")).toBe("1 2 3");
    // PreviewCompare is mocked, so report the divider at the mask end the way
    // its showMask() would.
    await act(async () => perf.preview!.onSplit!(100));
    expect(button.getAttribute("aria-label")).toBe("View Mode: Mask — switch to Can");
  } finally { await unmount(); }
});
