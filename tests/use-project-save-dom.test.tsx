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
