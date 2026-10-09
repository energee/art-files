// @vitest-environment happy-dom
// use-project-save-dom.test.tsx — useProjectSave reports a pack failure (an
// asset over the archive size caps) as a load error and resolves false, so a
// close-tab Save keeps the tab instead of hanging (#416 review).
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useProjectSave } from "@/useProjectSave";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  const packedFor: string[] = [];
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
