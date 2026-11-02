// recovery-open-dom.test.tsx — a tab restored from a crash-recovery snapshot
// (#394) is still unsaved work: Save stays live, closing it prompts, and the
// snapshot moves to the new tab's key before the old one is dropped, so a
// second crash before a save can still offer it back. A restore Save can't
// rebind says so in a warning toast (the real <Toaster /> is mounted beside the
// editor).
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { packLabel } from "../src/model/files";
import { unsaved } from "../src/tabs";
import { mountToaster, settle, shown, toastTitles, unmountToaster } from "./real-timer-toaster";

const calls = vi.hoisted(() => [] as string[]);
const kept = vi.hoisted(() => [] as { key: string; filePath?: string; fileModifiedAt?: number }[]);
vi.mock("../src/recovery", () => ({
  keepRecovery: async (key: string, snap: { filePath?: string; fileModifiedAt?: number }) => {
    calls.push(`keep ${key}`);
    kept.push({ key, filePath: snap.filePath, fileModifiedAt: snap.fileModifiedAt });
    return true;
  },
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
  await mountToaster();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  /** Closes the tab: the editor unmounts, the toaster stays. */
  const closeTab = () => act(async () => { root.unmount(); });
  const unmount = async () => { await closeTab(); container.remove(); await unmountToaster(); };
  try {
    await act(async () => { root.render(createElement(DocumentEditor, props)); });
    for (let i = 0; i < 400 && !onOpenSettled.mock.calls.length; i++)
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(onOpenSettled).toHaveBeenCalledWith(1, false);
  } catch (err) {
    await unmount(); // the caller never gets the handle to do it
    throw err;
  }
  return { meta: () => onMeta.mock.calls.at(-1)![0], unmount, closeTab };
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

// Audit: what the snapshots record decides the next launch's rebind. A
// rebound restore re-saves with the file and the baseline mtime it was cleared
// against, and the tab's later snapshots (bound, still edited) keep both.
it("a rebound restore's snapshots record the file and its baseline mtime", async () => {
  kept.length = 0;
  const { unmount } = await restore({
    seq: 1, file: snapshotFile(), recovered: "old:1",
    recoveredPath: { path: "/w/alpha.label", rebind: true, modifiedAt: 4 },
  });
  try {
    expect(kept[0]).toEqual({ key: "now:2", filePath: "/w/alpha.label", fileModifiedAt: 4 });
    await act(async () => { await new Promise((r) => setTimeout(r, 2500)); }); // the snapshot debounce
    expect(kept.length).toBeGreaterThan(1);
    expect(kept.at(-1)).toEqual({ key: "now:2", filePath: "/w/alpha.label", fileModifiedAt: 4 });
  } finally {
    await unmount();
  }
}, 30_000);

// A refused path must not ride along: with a fresh savedAt it could be
// rebound after a second crash.
it("a restore that cannot rebind re-saves its snapshot without the file", async () => {
  kept.length = 0;
  const { unmount } = await restore({
    seq: 1, file: snapshotFile(), recovered: "old:1",
    recoveredPath: { path: "/w/alpha.label", rebind: false, modifiedAt: 4 },
  });
  try {
    expect(kept[0]).toEqual({ key: "now:2", filePath: undefined, fileModifiedAt: undefined });
  } finally {
    await unmount();
  }
}, 30_000);

// The toast names the original by its base name, not the desktop path.
it("a restore that cannot rebind keeps Save asking where and names the original", async () => {
  const { meta, unmount } = await restore({
    seq: 1, file: snapshotFile(), recovered: "old:1", recoveredPath: { path: "/w/alpha.label", rebind: false },
  });
  try {
    expect(meta().filePath).toBeNull();
    await shown("Restored from alpha.label");
    expect(toastTitles()).toEqual(["Restored from alpha.label"]);
    expect(document.querySelector("[data-sonner-toast] [data-description]")!.textContent)
      .toBe("It moved, changed or is open in another tab, so Save asks where");
    expect(document.querySelector("[data-sonner-toast]")!.getAttribute("data-type")).toBe("warning");
    expect(document.body.textContent).not.toContain("/w/");
    expect(document.body.textContent).not.toContain("Note:");
  } finally {
    await unmount();
  }
}, 30_000);

// The recovery note is its own toast beside the open's (a benched layer here).
it("the cannot-rebind note comes beside the open's other notes", async () => {
  const { unmount } = await restore({
    seq: 1, file: snapshotFile({ ghost: "Boo" }), recovered: "old:1",
    recoveredPath: { path: "/w/alpha.label", rebind: false },
  });
  try {
    await shown("Restored from alpha.label");
    await settle();
    expect(toastTitles()).toHaveLength(2);
    expect(toastTitles()).toEqual(expect.arrayContaining(["Restored from alpha.label", "Opened alpha.label with changes"]));
    expect(document.body.textContent).toMatch(/ghost/i);
  } finally {
    await unmount();
  }
}, 30_000);

// A restore note is about this tab's label; it does not outlive the tab.
it("closing the tab dismisses its cannot-rebind note", async () => {
  const { closeTab, unmount } = await restore({
    seq: 1, file: snapshotFile(), recovered: "old:1", recoveredPath: { path: "/w/alpha.label", rebind: false },
  });
  try {
    await shown("Restored from alpha.label");
    await closeTab();
    await vi.waitFor(() => expect(toastTitles()).toEqual([]), { timeout: 5_000 });
  } finally {
    await unmount();
  }
}, 30_000);

it("a restore that rebinds says nothing", async () => {
  const { unmount } = await restore({
    seq: 1, file: snapshotFile(), recovered: "old:1", recoveredPath: { path: "/w/alpha.label", rebind: true },
  });
  try {
    await settle();
    expect(toastTitles()).toEqual([]);
  } finally {
    await unmount();
  }
}, 30_000);
