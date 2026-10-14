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

async function restore(fileToOpen: ComponentProps<typeof DocumentEditor>["fileToOpen"]) {
  const onMeta = vi.fn();
  const onOpenSettled = vi.fn();
  const props: ComponentProps<typeof DocumentEditor> = {
    active: true, fileToOpen, onOpenSettled, onMeta,
    saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
    onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
    onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(), recoveryKey: "now:2",
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(createElement(DocumentEditor, props)); });
  for (let i = 0; i < 400 && !onOpenSettled.mock.calls.length; i++)
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  expect(onOpenSettled).toHaveBeenCalledWith(1);
  const unmount = async () => { await act(async () => { root.unmount(); }); container.remove(); };
  return { meta: () => onMeta.mock.calls.at(-1)![0], container, unmount };
}

function snapshotFile(extra: Record<string, unknown> = {}) {
  const bytes = packLabel({
    formatVersion: 3, masterId: "lolev", enabledVariants: [],
    values: { name: [{ text: "Alpha", fill: "#F3CD80", layer: "metallic" }], ...extra },
  } as Parameters<typeof packLabel>[0], {});
  return new File([bytes as BlobPart], "alpha.label");
}

it("a restored snapshot opens unsaved and takes the snapshot over", async () => {
  const { meta, unmount } = await restore({ seq: 1, file: snapshotFile(), recovered: "old:1" });
  try {
    expect(meta().title).toBe("Alpha");
    expect(unsaved(meta())).toBe(true);
    expect(meta().filePath).toBeNull();
    // Copied to this tab's key first, then the old key dropped.
    const keep = calls.indexOf("keep now:2");
    expect(keep).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("drop old:1")).toBeGreaterThan(keep);
    // The mount-time drop (nothing unsaved yet) is fine; none may follow the copy.
    expect(calls.slice(keep)).not.toContain("drop now:2");
  } finally {
    await unmount();
  }
}, 30_000);

// UX audit 26: the shell hands back the file the tab was bound to when
// rebinding is safe, so Save writes there instead of asking where.
it("a restore the shell cleared to rebind saves back to the original file", async () => {
  const { meta, unmount } = await restore({
    seq: 1, file: snapshotFile(), recovered: "old:1", recoveredPath: { path: "/w/alpha.label", rebind: true },
  });
  try {
    expect(meta().filePath).toBe("/w/alpha.label");
    expect(unsaved(meta())).toBe(true);
  } finally {
    await unmount();
  }
}, 30_000);

it("a restore that cannot rebind keeps Save asking where and names the original", async () => {
  const { meta, container, unmount } = await restore({
    seq: 1, file: snapshotFile(), recovered: "old:1", recoveredPath: { path: "/w/alpha.label", rebind: false },
  });
  try {
    expect(meta().filePath).toBeNull();
    expect(container.textContent).toContain("/w/alpha.label");
  } finally {
    await unmount();
  }
}, 30_000);

// The recovery note joins the open's own notes (a benched layer here) rather
// than replacing them.
it("the cannot-rebind note keeps the open's other notes", async () => {
  const { container, unmount } = await restore({
    seq: 1, file: snapshotFile({ ghost: "Boo" }), recovered: "old:1",
    recoveredPath: { path: "/w/alpha.label", rebind: false },
  });
  try {
    expect(container.textContent).toContain("/w/alpha.label");
    expect(container.textContent).toMatch(/ghost/i);
  } finally {
    await unmount();
  }
}, 30_000);
