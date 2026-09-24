// preview-spinner-dom.test.tsx — the "rendering label…" spinner is a loading
// state, so it must clear when the preview build is skipped on purpose (a
// validation error blocks it), not only when a build finishes (issue #127).
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
async function settle(ms = 400) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

/** Mounts an editor that opens a Lolev .label with the given barcode. */
async function mountWithBarcode(barcode: string) {
  const bytes = packLabel({
    formatVersion: 3, masterId: "lolev", enabledVariants: [],
    values: { barcode },
  }, {});
  const onMeta = vi.fn();
  const props: Props = {
    ...editorProps, onMeta,
    fileToOpen: { seq: 1, file: new File([bytes as unknown as BlobPart], "beer.label") },
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(createElement(DocumentEditor, props)); });
  return {
    container,
    onMeta,
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

it("an invalid barcode does not leave the spinner up after returning to the tab", async () => {
  const ed = await mountWithBarcode("999");
  try {
    await settle();
    // Switch away (drops the decoded render source) and back.
    await ed.setActive(false);
    await settle();
    await ed.setActive(true);
    await settle();
    // The validation error is what's blocking the preview — and it's shown.
    expect(ed.container.textContent).toContain("not a valid UPC-A code");
    expect(spinning(ed.container)).toBe(false);
  } finally {
    await ed.unmount();
  }
});
