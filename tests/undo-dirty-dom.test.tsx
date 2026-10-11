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

it("⌘Z and ⇧⌘Z from the keyboard mark a saved document dirty", async () => {
  URL.createObjectURL ??= () => "blob:test";
  URL.revokeObjectURL ??= () => {};
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onMeta = vi.fn();
  const saveSlot: { current: (() => Promise<boolean>) | null } = { current: null };
  const dirty = () => onMeta.mock.lastCall?.[0].dirty;
  const save = () => act(async () => { await saveSlot.current!(); });
  const press = (shiftKey: boolean) => act(async () => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, shiftKey, bubbles: true }));
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
    // Nothing to undo yet: the key must not dirty a saved document.
    await save();
    await press(false);
    expect(dirty()).toBe(false);
    // One undoable edit: switch a variant-added layer on.
    const power = container.querySelector('[data-layer-id="collabLead"] button[aria-label$=": enabled"]') as HTMLButtonElement;
    await act(async () => power.click());
    await save();
    expect(dirty()).toBe(false);
    await press(false);
    expect(power.getAttribute("aria-pressed")).toBe("false");
    expect(dirty()).toBe(true);
    await save();
    expect(dirty()).toBe(false);
    await press(true);
    expect(power.getAttribute("aria-pressed")).toBe("true");
    expect(dirty()).toBe(true);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
}, 20_000); // a full editor mount; the 5s default flakes under machine load
