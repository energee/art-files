// @vitest-environment happy-dom
// use-project-save-dom.test.tsx — useProjectSave reports a pack failure (an
// asset over the archive size caps) through onError and resolves false, so a
// close-tab Save keeps the tab instead of hanging (#416 review).
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useProjectSave } from "@/useProjectSave";

it("saveProject resolves false and reports the error when packing throws", async () => {
  const onError = vi.fn();
  let save: (as?: boolean) => Promise<boolean> = async () => true;
  function Probe() {
    save = useProjectSave({
      pack: () => { throw new Error("Archive is too large"); },
      exportBase: "x", onSaved: () => true, onError,
      startSaveBatch: () => undefined, saveBytes: () => undefined,
    }).saveProject;
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(Probe)); });
  await expect(save()).resolves.toBe(false);
  expect(onError).toHaveBeenCalledWith("Could not save label: Archive is too large");
  act(() => root.unmount());
});

// #428: the label is packed once its destination is known, so the master hint
// can be written relative to the file actually saved (not an absolute path).
it("saveProject packs for the path the label is written to", async () => {
  vi.resetModules();
  vi.doMock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
  const written: string[] = [];
  vi.doMock("@tauri-apps/plugin-fs", () => ({
    writeFile: async () => undefined,
    rename: async (_from: string, to: string) => { written.push(to); },
    remove: async () => undefined,
    exists: async () => true, stat: async () => ({ mtime: new Date(1) }), // bindPath's baseline stat
  }));
  const { useProjectSave: hook } = await import("@/useProjectSave");
  const packedFor: (string | undefined)[] = [];
  let api: ReturnType<typeof hook> | undefined;
  function Probe() {
    api = hook({
      pack: (p) => { packedFor.push(p); return new Uint8Array([1]); },
      exportBase: "x", onSaved: () => true, onError: vi.fn(),
      startSaveBatch: () => undefined, saveBytes: () => undefined,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(Probe)); });
  // Settle bindPath's baseline stat first: vitest can hand a second, overlapping
  // dynamic import of a doMocked module the real one.
  await act(async () => { api!.bindPath("/Users/me/beers/a.label"); await new Promise((r) => setTimeout(r, 0)); });
  await expect(api!.saveProject()).resolves.toBe(true);
  expect(packedFor).toEqual(["/Users/me/beers/a.label"]);
  expect(written).toEqual(["/Users/me/beers/a.label"]);
  act(() => root.unmount());
  vi.doUnmock("@tauri-apps/api/core");
  vi.doUnmock("@tauri-apps/plugin-fs");
});

// #428 review: packing for the chosen destination must not move the size-cap
// failure after the dialog. An oversized label fails before Save As asks
// where; a new destination is packed again for its own path.
it("saveProject fails an oversized label before the dialog, and repacks for Save As", async () => {
  vi.resetModules();
  vi.doMock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
  const dialog = vi.fn(async () => "/Users/me/other/b.label");
  vi.doMock("@tauri-apps/plugin-dialog", () => ({ save: dialog }));
  vi.doMock("@tauri-apps/plugin-fs", () => ({
    writeFile: async () => undefined, rename: async () => undefined, remove: async () => undefined,
    exists: async () => true, stat: async () => ({ mtime: new Date(1) }), // bindPath's baseline stat
  }));
  const { useProjectSave: hook } = await import("@/useProjectSave");
  let tooBig = true;
  const packedFor: (string | undefined)[] = [];
  let api: ReturnType<typeof hook> | undefined;
  function Probe() {
    api = hook({
      pack: (p) => {
        packedFor.push(p);
        if (tooBig) throw new Error("Archive is too large");
        return new Uint8Array([1]);
      },
      exportBase: "x", onSaved: () => true, onError: vi.fn(),
      startSaveBatch: () => undefined, saveBytes: () => undefined,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(Probe)); });
  await expect(api!.saveProject(true)).resolves.toBe(false);
  expect(dialog).not.toHaveBeenCalled();
  tooBig = false;
  packedFor.length = 0;
  await expect(api!.saveProject(true)).resolves.toBe(true);
  expect(packedFor).toEqual([undefined, "/Users/me/other/b.label"]);
  act(() => root.unmount());
  vi.doUnmock("@tauri-apps/api/core");
  vi.doUnmock("@tauri-apps/plugin-dialog");
  vi.doUnmock("@tauri-apps/plugin-fs");
});

// Audit: crash recovery rebinds a restored tab only to a file still carrying
// the mtime this tab saw (recovery.ts canRebind), so binding a path records
// it, and a save re-records it once the tab's own write has landed.
it("bindPath and a save record the bound file's mtime as the recovery baseline", async () => {
  vi.resetModules();
  vi.doMock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
  let mtime = 100;
  vi.doMock("@tauri-apps/plugin-fs", () => ({
    writeFile: async () => undefined,
    rename: async () => { mtime = 200; },
    remove: async () => undefined,
    exists: async () => true,
    stat: async () => ({ mtime: new Date(mtime) }),
  }));
  const { useProjectSave: hook } = await import("@/useProjectSave");
  let api: ReturnType<typeof hook> | undefined;
  function Probe() {
    api = hook({
      pack: () => new Uint8Array([1]),
      exportBase: "x", onSaved: () => true, onError: vi.fn(),
      startSaveBatch: () => undefined, saveBytes: () => undefined,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(Probe)); });
  await act(async () => { api!.bindPath("/w/a.label"); await new Promise((r) => setTimeout(r, 0)); });
  expect(api!.boundModifiedAt()).toBe(100);
  await act(async () => { await api!.saveProject(); await new Promise((r) => setTimeout(r, 0)); });
  expect(api!.boundModifiedAt()).toBe(200);
  // A baseline the caller already knows (a restore cleared to rebind) is taken as is.
  act(() => api!.bindPath("/w/b.label", 42));
  expect(api!.boundModifiedAt()).toBe(42);
  act(() => api!.forgetProjectFile());
  expect(api!.boundModifiedAt()).toBeUndefined();
  act(() => root.unmount());
  vi.doUnmock("@tauri-apps/api/core");
  vi.doUnmock("@tauri-apps/plugin-fs");
});
