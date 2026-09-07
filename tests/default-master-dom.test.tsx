// default-master-dom.test.tsx — a new untitled editor must boot onto the
// last master this operator applied, not the hardcoded Lolev fixture.
// @vitest-environment happy-dom
import { act, createElement } from "react";
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

it("shows the last applied master on a fresh untitled document", async () => {
  const mine = { ...lolevMaster(), id: "master-mine", name: "Mine" };
  rememberMaster(mine, "mine.master", packMaster(mine, {}));
  await act(async () => { await Promise.resolve(); });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(DocumentEditor, editorProps));
    });
    await waitFor(() => (container.querySelector("#master-picker")?.textContent ?? "").includes("Mine"));
    expect(container.querySelector("#master-picker")?.textContent).toContain("Mine");
    expect(container.querySelector("#master-picker")?.textContent).not.toContain("Lolev");
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});

it("does not replace a .label that is already queued to open", async () => {
  const mine = { ...lolevMaster(), id: "master-mine", name: "Mine" };
  rememberMaster(mine, "mine.master", packMaster(mine, {}));
  await act(async () => { await Promise.resolve(); });

  const bytes = packLabel({
    formatVersion: 3, masterId: "lolev", enabledVariants: [],
    values: { name: [{ text: "Peregrine", fill: "#F3CD80", layer: "metallic" }] },
  }, {});
  const onMeta = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(DocumentEditor, {
        ...editorProps,
        onMeta,
        fileToOpen: { seq: 1, file: new File([bytes as unknown as BlobPart], "beer.label") },
      }));
    });
    await waitFor(() => onMeta.mock.calls.some((c) => c[0]?.title === "Peregrine"));
    expect(container.querySelector("#master-picker")?.textContent).toContain("Lolev");
    expect(container.querySelector("#master-picker")?.textContent).not.toContain("Mine");
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});
