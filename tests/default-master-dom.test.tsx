// default-master-dom.test.tsx — an untitled editor boots onto the last
// master this operator applied (layers and positions), without that master's
// fill values or raster art.
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { lolevMaster } from "../src/model/lolevLayers";
import { packLabel, packMaster } from "../src/model/files";

const cache = new Map<string, Uint8Array>();
vi.mock("../src/masterCache", () => ({
  cacheMaster: async (id: string, bytes: Uint8Array) => { cache.set(id, bytes); },
  cachedMaster: async (id: string) => cache.get(id) ?? null,
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("../src/components/PreviewCompare", () => ({ PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));

const { rememberMaster } = await import("../src/masters");
const { DocumentEditor } = await import("../src/App");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const editorProps = {
  active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
  saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
  onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
  onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
};

beforeEach(() => { cache.clear(); localStorage.clear(); });

afterEach(() => { localStorage.clear(); });

async function waitFor(pred: () => boolean, tries = 30) {
  for (let i = 0; i < tries; i++) {
    if (pred()) return;
    await act(async () => { await Promise.resolve(); });
  }
}

async function mountEditor(props: ComponentProps<typeof DocumentEditor>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(DocumentEditor, props));
  });
  return {
    container,
    async unmount() {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

function pickerText(container: HTMLElement) {
  return container.querySelector("#master-picker")?.textContent ?? "";
}

it("loads the last master's layers without its fill values or art", async () => {
  const base = lolevMaster();
  const mine = {
    ...base,
    id: "master-mine",
    name: "Mine",
    layers: base.layers.map((layer) =>
      layer.id === "name" && layer.kind === "text"
        ? { ...layer, lines: [{ ...layer.lines[0], text: "Old Beer" }] }
        : layer),
  };
  const texture = { name: "old.png", bytes: new Uint8Array([137, 80, 78, 71]) };
  await rememberMaster(mine, "mine.master", packMaster(mine, { texture }));
  await act(async () => { await Promise.resolve(); });

  const onMeta = vi.fn();
  const { container, unmount } = await mountEditor({ ...editorProps, onMeta });
  try {
    await waitFor(() => pickerText(container).includes("Mine"));
    expect(pickerText(container)).toContain("Mine");
    expect(pickerText(container)).not.toContain("Lolev");
    for (let i = 0; i < 10; i++) {
      expect(onMeta.mock.calls.some((c) => c[0]?.title === "Old Beer")).toBe(false);
      await act(async () => { await Promise.resolve(); });
    }
  } finally {
    await unmount();
  }
});

it("shows the last applied master on a fresh untitled document", async () => {
  const mine = { ...lolevMaster(), id: "master-mine", name: "Mine" };
  await rememberMaster(mine, "mine.master", packMaster(mine, {}));
  await act(async () => { await Promise.resolve(); });

  const { container, unmount } = await mountEditor(editorProps);
  try {
    await waitFor(() => pickerText(container).includes("Mine"));
    expect(pickerText(container)).toContain("Mine");
    expect(pickerText(container)).not.toContain("Lolev");
  } finally {
    await unmount();
  }
});

it("does not replace a .label that is already queued to open", async () => {
  const mine = { ...lolevMaster(), id: "master-mine", name: "Mine" };
  await rememberMaster(mine, "mine.master", packMaster(mine, {}));
  await act(async () => { await Promise.resolve(); });

  const bytes = packLabel({
    formatVersion: 3, masterId: "lolev", enabledVariants: [],
    values: { name: [{ text: "Peregrine", fill: "#F3CD80", layer: "metallic" }] },
  }, {});
  const onMeta = vi.fn();
  const { container, unmount } = await mountEditor({
    ...editorProps,
    onMeta,
    fileToOpen: { seq: 1, file: new File([bytes as unknown as BlobPart], "beer.label") },
  });
  try {
    await waitFor(() => onMeta.mock.calls.some((c) => c[0]?.title === "Peregrine"));
    expect(pickerText(container)).toContain("Lolev");
    expect(pickerText(container)).not.toContain("Mine");
  } finally {
    await unmount();
  }
});
