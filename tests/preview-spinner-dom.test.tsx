// preview-spinner-dom.test.tsx — a validation error must not stall the
// preview: the build still runs (the rejected value falls back to the
// master's), so the "rendering label…" spinner clears (issue #127).
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { packLabel } from "../src/model/files";

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

type Props = ComponentProps<typeof DocumentEditor>;
const editorProps: Props = {
  active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
  saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
  onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
  onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
};

beforeEach(() => { localStorage.clear(); });
afterEach(() => { localStorage.clear(); });

const spinning = (c: HTMLElement) => (c.textContent ?? "").includes("rendering label…");

/** Flushes microtasks and lets the 150ms debounced asset build fire. */
async function settle(ms = 200) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

/** Mounts an editor that opens a Lolev .label with the given barcode. */
async function mountWithBarcode(barcode: string) {
  const bytes = packLabel({
    formatVersion: 3, masterId: "lolev", enabledVariants: [],
    values: { barcode },
  }, {});
  const props: Props = {
    ...editorProps,
    fileToOpen: { seq: 1, file: new File([bytes as unknown as BlobPart], "beer.label") },
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(createElement(DocumentEditor, props)); });
  return {
    container,
    async setActive(active: boolean) {
      await act(async () => { root.render(createElement(DocumentEditor, { ...props, active })); });
    },
    async unmount() {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

it("control: a valid label builds its preview and the spinner clears", async () => {
  const ed = await mountWithBarcode("850051366224");
  try {
    await settle();
    expect(spinning(ed.container)).toBe(false);
  } finally {
    await ed.unmount();
  }
});

it("an invalid barcode still rebuilds the preview after returning to the tab", async () => {
  const ed = await mountWithBarcode("999");
  try {
    await settle();
    // Switch away (drops the decoded render source) and back.
    await ed.setActive(false);
    await ed.setActive(true);
    await settle();
    // The error still shows (export stays blocked), but the preview rebuilt.
    expect(ed.container.textContent).toContain("not a valid UPC-A code");
    expect(spinning(ed.container)).toBe(false);
  } finally {
    await ed.unmount();
  }
});
