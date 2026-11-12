// settings-cross-window-dom.test.tsx — two browser windows share localStorage
// but not memory (#701): a window's write must not put its stale copy of the
// render settings or swatches back over what the other window saved. The other
// window is played here by writing storage and firing its `storage` event.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { addColor, DEFAULT_RENDER, loadRenderSettings, setSwatches, useSwatches, type RenderSettings } from "../src/settings";

const editor = vi.hoisted(() => ({
  props: null as unknown as { render: RenderSettings; onRenderChange: (next: RenderSettings) => void },
}));
vi.mock("../src/components/DesktopUpdater", () => ({ DesktopUpdater: () => null }));
vi.mock("../src/App", () => ({
  DocumentEditor: (props: typeof editor.props) => { editor.props = props; return null; },
}));
const { default: TabsShell } = await import("../src/TabsShell");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  localStorage.clear();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => { await act(async () => { root.unmount(); }); });

it("a render change from another window survives this window's next change", async () => {
  await act(async () => { root.render(createElement(TabsShell)); });
  await act(async () => {
    localStorage.setItem("labellab.render", JSON.stringify({ ...DEFAULT_RENDER, bleedIn: 0.125 }));
    window.dispatchEvent(new StorageEvent("storage", { key: "labellab.render" }));
  });
  expect(editor.props.render.bleedIn).toBe(0.125);
  await act(async () => { editor.props.onRenderChange({ ...editor.props.render, cornerRadius: 5 }); });
  expect(loadRenderSettings()).toMatchObject({ bleedIn: 0.125, cornerRadius: 5 });
});

it("a swatch saved in another window survives a save in this one", async () => {
  let shown: string[] = [];
  await act(async () => { root.render(createElement(() => { shown = useSwatches(); return null; })); });
  localStorage.setItem("labellab.swatches", JSON.stringify(["#111111"]));
  await act(async () => { setSwatches((list) => addColor(list, "#222222")); });
  expect(JSON.parse(localStorage.getItem("labellab.swatches")!)).toEqual(["#111111", "#222222"]);
  expect(shown).toEqual(["#111111", "#222222"]);
  await act(async () => { setSwatches(() => []); });
});
