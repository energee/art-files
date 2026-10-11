// @vitest-environment happy-dom
// use-project-save-dom.test.tsx — useProjectSave reports a pack failure (an
// asset over the archive size caps) as a load error and resolves false, so a
// close-tab Save keeps the tab instead of hanging (#416 review).
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useProjectSave } from "@/useProjectSave";

it("saveProject resolves false with a load error when packing throws", async () => {
  const setLoadError = vi.fn();
  let save: (as?: boolean) => Promise<boolean> = async () => true;
  function Probe() {
    save = useProjectSave({
      pack: () => { throw new Error("Archive is too large"); },
      exportBase: "x", onSaved: () => true, setLoadError,
      startSaveBatch: () => undefined, saveBytes: () => undefined,
    }).saveProject;
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(Probe)); });
  await expect(save()).resolves.toBe(false);
  expect(setLoadError).toHaveBeenCalledWith("Could not save project: Archive is too large");
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
  }));
  const { useProjectSave: hook } = await import("@/useProjectSave");
  const packedFor: (string | undefined)[] = [];
  let api: ReturnType<typeof hook> | undefined;
  function Probe() {
    api = hook({
      pack: (p) => { packedFor.push(p); return new Uint8Array([1]); },
      exportBase: "x", onSaved: () => true, setLoadError: vi.fn(),
      startSaveBatch: () => undefined, saveBytes: () => undefined,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(Probe)); });
  act(() => api!.bindPath("/Users/me/beers/a.label"));
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
      exportBase: "x", onSaved: () => true, setLoadError: vi.fn(),
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
