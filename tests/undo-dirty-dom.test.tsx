// undo-dirty-dom.test.tsx — issue #76: the browser ⌘Z / ⇧⌘Z key handler must
// mark the document dirty like the Edit menu's Undo/Redo, or an undo after a
// save is silently lost (Save disabled, no close prompt).
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";

vi.mock("../src/components/PreviewCompare", () => ({ PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
import { DocumentEditor } from "../src/App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each([
  ["⌘Z undo", { key: "z", shiftKey: false }],
  ["⇧⌘Z redo", { key: "z", shiftKey: true }],
])("%s from the keyboard marks a saved document dirty", async (_name, keys) => {
  URL.createObjectURL ??= () => "blob:test";
  URL.revokeObjectURL ??= () => {};
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onMeta = vi.fn();
  const saveSlot: { current: (() => Promise<boolean>) | null } = { current: null };
  const press = (init: KeyboardEventInit) => act(async () => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { metaKey: true, bubbles: true, ...init }));
  });
  try {
    await act(async () => {
      root.render(createElement(DocumentEditor, {
        active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta,
        saveSlot, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
        onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
        onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
      }));
    });
    // One undoable edit: switch a variant-added layer on.
    const power = container.querySelector('[data-layer-id="collabLead"] button[aria-label$=": enabled"]') as HTMLButtonElement;
    await act(async () => power.click());
    // For redo, step back first so there is something to redo.
    if (keys.shiftKey) await press({ key: "z" });
    await act(async () => { await saveSlot.current!(); });
    expect(onMeta.mock.lastCall?.[0].dirty).toBe(false);
    await press(keys);
    expect(power.getAttribute("aria-pressed")).toBe(keys.shiftKey ? "true" : "false");
    expect(onMeta.mock.lastCall?.[0].dirty).toBe(true);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});
