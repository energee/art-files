// missing-master-dom.test.tsx — a .label whose master can't be found asks
// what to open it on instead of failing: "Use current" opens the label on the
// tab's master (values kept), Cancel leaves the tab as it was and does not
// re-ask on the quiet retries, and a failed Locate says why instead of
// re-asking.
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { packLabel } from "../src/model/files";

vi.mock("../src/masterCache", () => ({
  cacheMaster: async () => {},
  cachedMaster: async () => null,
  dropCachedMaster: async () => {},
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

afterEach(() => { localStorage.clear(); document.body.innerHTML = ""; });

const orphan = () => {
  const bytes = packLabel({
    formatVersion: 3, masterId: "master-gone", masterHint: "/elsewhere/gone.master", enabledVariants: [],
    values: { name: [{ text: "Orphan", fill: "#F3CD80", layer: "metallic" }] },
  }, {});
  return { name: "o.label", getFile: async () => new File([bytes as unknown as BlobPart], "o.label") } as unknown as FileSystemFileHandle;
};

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text));

async function openOrphan(pick: string) {
  const onMeta = vi.fn();
  const onOpenSettled = vi.fn();
  const props: ComponentProps<typeof DocumentEditor> = {
    active: true, fileToOpen: { seq: 1, handle: orphan() }, onOpenSettled, onMeta,
    saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
    onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
    onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
  };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => { root.render(createElement(DocumentEditor, props)); });
  for (let i = 0; i < 400 && !button(pick); i++) await tick();
  expect(document.body.textContent).toContain("This label was made with a different master");
  await act(async () => { button(pick)!.click(); });
  for (let i = 0; i < 400 && !onOpenSettled.mock.calls.length; i++) await tick();
  const title = onMeta.mock.calls.at(-1)?.[0]?.title;
  const reasked = !!button(pick);
  const text = document.body.textContent ?? "";
  await act(async () => { root.unmount(); });
  return { title, reasked, text };
}

it("Use current opens the label on this tab's master", async () => {
  const r = await openOrphan("Use “");
  expect(r.title).toBe("Orphan");
  expect(r.reasked).toBe(false);
}, 30_000);

it("Cancel leaves the tab alone and does not ask again", async () => {
  const r = await openOrphan("Cancel");
  expect(r.title).not.toBe("Orphan");
  expect(r.reasked).toBe(false);
}, 30_000);

it("Locate shows why it failed instead of quietly asking again", async () => {
  const broken = { getFile: async () => { throw new Error("disk went away"); } };
  (window as unknown as { showOpenFilePicker: () => Promise<unknown[]> }).showOpenFilePicker = async () => [broken];
  try {
    const r = await openOrphan("Locate");
    expect(r.title).not.toBe("Orphan");
    expect(r.reasked).toBe(false);
    expect(r.text).toContain("Could not open master: disk went away");
  } finally {
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  }
}, 30_000);
