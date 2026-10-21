// canview-export-spinner-dom.test.tsx — the can's "rendering…" spinner and
// the editor's export note share the bottom-left corner, so while an export
// runs the can's spinner stands down rather than stacking under the note.
// The scene and texture build are faked; happy-dom has no WebGL.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { CanvasRenderSource } from "../src/canvas/draw";
import { measure } from "./fixtures";

vi.mock("../src/three/canScene", () => ({
  CanScene: class {
    onZoomChange?: unknown;
    setZoom() {} setPan() {} resize() {} dispose() {} setMode() {} setLabelOptions() {} applyTextures() {}
  },
}));
// Never settles, so the view stays "loading" for the whole test.
vi.mock("../src/three/labelTextures", () => ({
  drawPlates: () => ({}), buildLabelTextures: () => new Promise(() => {}),
}));
import { CanView } from "../src/components/CanView";

const source: CanvasRenderSource = {
  m: measure, planAssets: { logoSvg: "" }, drawAssets: {}, skip: new Set(), fontCss: "sans-serif",
};

it("hides the can's rendering spinner while an export runs", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const show = (exporting: boolean) => act(async () => {
    root.render(createElement(CanView, {
      layers: [], source, bleedIn: 0.125, mode: "can", cornerRadiusPct: 0, edgeSoftnessPct: 0,
      onRenderError: () => undefined, exporting,
    }));
  });
  try {
    await show(false);
    expect(container.textContent).toContain("rendering…");
    await show(true);
    expect(container.textContent).not.toContain("rendering…");
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
  }
});
