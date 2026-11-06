// @vitest-environment happy-dom
// use-project-save-dom.test.tsx — useProjectSave reports a pack failure (an
// asset over the archive size caps) through onError and resolves false, so a
// close-tab Save keeps the tab instead of hanging (#416 review). Saves take
// turns (#690), and a Save's finish leaves alone a binding an Open made (#693).
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

/** A useProjectSave bound to /w/a.label whose writes each wait for the test:
 *  `written` holds each write's first byte in start order, `landed` in finish
 *  order, and `release(n)` ends the nth. */
async function heldSave(fail = (_n: number) => false) {
  vi.resetModules();
  const written: number[] = [];
  const landed: number[] = [];
  const finish: (() => void)[] = [];
  vi.doMock("@/files", () => ({
    confirmOverwrite: async () => "overwrite",
    nativeModifiedAt: async () => 1,
    saveThrough: async (content: ((name: string) => Uint8Array) | Uint8Array, options: { target?: { path: string } }) => {
      const path = options.target?.path ?? "/w/x.label"; // what Save As picks
      const bytes = typeof content === "function" ? content(path) : content;
      const n = written.push(bytes[0]) - 1;
      await new Promise<void>((resolve) => { finish.push(resolve); });
      if (fail(n)) throw new Error("Disk full");
      landed.push(bytes[0]);
      return { name: path, bytes, target: { path } };
    },
  }));
  const { useProjectSave: hook } = await import("@/useProjectSave");
  const onSaved = vi.fn(() => true);
  const onError = vi.fn();
  let api: ReturnType<typeof hook> | undefined;
  function Probe({ doc }: { doc: number }) {
    api = hook({
      pack: () => new Uint8Array([doc]),
      exportBase: "x", onSaved, onError,
      startSaveBatch: () => undefined, saveBytes: () => undefined,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = (doc: number) => act(async () => { root.render(createElement(Probe, { doc })); });
  await render(1);
  act(() => api!.bindPath("/w/a.label"));
  return {
    written, landed, onSaved, onError, render, api: () => api!, save: (as?: boolean) => api!.saveProject(as),
    release: (n: number) => finish[n](),
    cleanup: () => { act(() => root.unmount()); vi.doUnmock("@/files"); },
  };
}

// #690: rename is a sync command and the write is not, so two writes in flight
// could finish in either order and leave the older bytes on disk.
it("a Save during a write waits its turn, then writes the newest document", async () => {
  const s = await heldSave();
  const first = s.save();
  await vi.waitFor(() => expect(s.written).toEqual([1]));
  await s.render(2);
  const second = s.save();
  await s.render(3); // edited again while that Save waits
  await new Promise((r) => setTimeout(r, 0));
  expect(s.written).toEqual([1]); // the second write has not started
  s.release(0);
  await vi.waitFor(() => expect(s.written).toEqual([1, 3]));
  expect(s.landed).toEqual([1]);
  s.release(1);
  await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  expect(s.landed).toEqual([1, 3]); // the newest bytes land last
  s.cleanup();
});

// A failed write must not read as saved, and must not stop the Save behind it.
it("a failed write reports failure, and the Save behind it still runs", async () => {
  const s = await heldSave((n) => n === 0);
  const first = s.save();
  await vi.waitFor(() => expect(s.written).toEqual([1]));
  const second = s.save();
  s.release(0);
  await expect(first).resolves.toBe(false);
  expect(s.onError).toHaveBeenCalledWith("Could not save label: Disk full");
  expect(s.onSaved).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(s.written).toEqual([1, 1]));
  s.release(1);
  await expect(second).resolves.toBe(true);
  expect(s.onSaved).toHaveBeenCalledOnce();
  s.cleanup();
});

// #693: a pristine tab's Save As sheet can sit open while an OS open lands in
// that tab. The bytes written are the old document, so the file the sheet
// picked must not take the binding from the file now on screen.
it("a Save finishing after an Open leaves the Open's binding and clean state", async () => {
  const s = await heldSave();
  const saving = s.save(true);
  await vi.waitFor(() => expect(s.written).toEqual([1]));
  act(() => s.api().bindPath("/w/opened.label"));
  s.release(0);
  await act(async () => { await expect(saving).resolves.toBe(false); });
  expect(s.api().filePath).toBe("/w/opened.label");
  expect(s.onSaved).not.toHaveBeenCalled();
  s.cleanup();
});

// A dropped .label has no file: the Save must not bind it to the sheet's either.
it("a Save finishing after a pathless Open leaves the tab unbound", async () => {
  const s = await heldSave();
  const saving = s.save(true);
  await vi.waitFor(() => expect(s.written).toEqual([1]));
  act(() => s.api().forgetProjectFile());
  s.release(0);
  await act(async () => { await expect(saving).resolves.toBe(false); });
  expect(s.api().filePath).toBeNull();
  s.cleanup();
});

// An edit is not an Open: Save As still moves the tab to the file it wrote.
it("an edit during Save As still binds the tab to the new file", async () => {
  const s = await heldSave();
  const saving = s.save(true);
  await vi.waitFor(() => expect(s.written).toEqual([1]));
  await s.render(2);
  s.release(0);
  await act(async () => { await expect(saving).resolves.toBe(true); });
  expect(s.api().filePath).toBe("/w/x.label");
  s.cleanup();
});
