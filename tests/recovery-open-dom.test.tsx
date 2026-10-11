// recovery-open-dom.test.tsx — a tab restored from a crash-recovery snapshot
// (#394) is still unsaved work: Save stays live, closing it prompts, and the
// snapshot moves to the new tab's key before the old one is dropped, so a
// second crash before a save can still offer it back.
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { packLabel } from "../src/model/files";
import { unsaved } from "../src/tabs";

const calls = vi.hoisted(() => [] as string[]);
vi.mock("../src/recovery", () => ({
  keepRecovery: async (key: string) => { calls.push(`keep ${key}`); return true; },
  dropRecovery: async (key: string) => { calls.push(`drop ${key}`); },
}));
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

it("a restored snapshot opens unsaved and takes the snapshot over", async () => {
  const bytes = packLabel({
    formatVersion: 3, masterId: "lolev", enabledVariants: [],
    values: { name: [{ text: "Alpha", fill: "#F3CD80", layer: "metallic" }] },
  }, {});
  const file = new File([bytes as BlobPart], "alpha.label");
  const onMeta = vi.fn();
  const onOpenSettled = vi.fn();
  const props: ComponentProps<typeof DocumentEditor> = {
    active: true, fileToOpen: { seq: 1, file, recovered: "old:1" }, onOpenSettled, onMeta,
    saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
    onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
    onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(), recoveryKey: "now:2",
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(createElement(DocumentEditor, props)); });
    for (let i = 0; i < 400 && !onOpenSettled.mock.calls.length; i++)
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(onOpenSettled).toHaveBeenCalledWith(1);

    const meta = onMeta.mock.calls.at(-1)![0];
    expect(meta.title).toBe("Alpha");
    expect(unsaved(meta)).toBe(true);
    // Copied to this tab's key first, then the old key dropped.
    const keep = calls.indexOf("keep now:2");
    expect(keep).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("drop old:1")).toBeGreaterThan(keep);
    // The mount-time drop (nothing unsaved yet) is fine; none may follow the copy.
    expect(calls.slice(keep)).not.toContain("drop now:2");
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
}, 30_000);
