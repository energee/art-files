// app-v3-dom.test.tsx — real editor/list/inspector/history wiring in happy-dom.
// Graphics and font loading are replaced because this is a DOM contract check,
// not a browser raster test; the document model and editing components are real.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";

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
    const variant = container.querySelector('[aria-label="Collab variant"]')!;
    const leadPower = container.querySelector('[data-layer-id="collabLead"] button[aria-label$=": enabled"]') as HTMLButtonElement;
    expect(variant.getAttribute("aria-pressed")).toBe("false");
    expect(leadPower.getAttribute("aria-pressed")).toBe("false");
    await act(async () => leadPower.click());
    expect(variant.getAttribute("aria-pressed")).toBe("true");
    expect(leadPower.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).not.toContain("Invalid master file");
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
    });
    expect(variant.getAttribute("aria-pressed")).toBe("false");
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

it("edits land in the .label until Edit master is on", async () => {
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
    const row = (id: string) => container.querySelector(`[data-layer-id="${id}"]`)!;
    const lock = (id: string) => row(id).querySelector('button[aria-label$=": locked"]') as HTMLButtonElement;
    const dot = (id: string) => row(id).querySelector('[role="img"][aria-label="Overridden"]');
    // Edit master off: locking Name is a label override, so the row shows the dot.
    expect(dot("name")).toBeNull();
    await act(async () => lock("name").click());
    expect(lock("name").getAttribute("aria-pressed")).toBe("true");
    expect(dot("name")).not.toBeNull();
    // Edit master on: the same switch on another layer changes the master, no dot.
    const chip = container.querySelector('button[aria-label="Edit master"]') as HTMLButtonElement;
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    await act(async () => chip.click());
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    await act(async () => lock("wordmark").click());
    expect(lock("wordmark").getAttribute("aria-pressed")).toBe("true");
    expect(dot("wordmark")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
