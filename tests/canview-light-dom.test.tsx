// canview-light-dom.test.tsx — CanView hands its lightDeg prop to the scene:
// the first render sets the rig's angle, and a changed prop turns it once
// (issue #570). The scene and texture build are faked; happy-dom has no WebGL.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { CanvasRenderSource } from "../src/canvas/draw";
import { measure } from "./fixtures";

const setLight = vi.hoisted(() => vi.fn());
vi.mock("../src/three/canScene", () => ({
  CanScene: class {
    onZoomChange?: unknown;
    setLight = setLight;
    setZoom() {} setPan() {} resize() {} dispose() {} setMode() {} setCurve() {} setLabelOptions() {} applyTextures() {}
  },
}));
vi.mock("../src/three/labelTextures", () => ({
  drawPlates: () => ({}), buildLabelTextures: () => new Promise(() => {}),
}));
import { CanView } from "../src/components/CanView";

const source: CanvasRenderSource = {
  m: measure, planAssets: {}, drawAssets: {}, skip: new Set(), fontCss: "sans-serif",
};

it("sets the light angle on mount and again when the prop changes", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const show = (lightDeg: number) => act(async () => {
    root.render(createElement(CanView, {
      layers: [], source, bleedIn: 0.125, mode: "can", cornerRadiusPct: 0, edgeSoftnessPct: 0, curvePct: 0,
      lightDeg, onRenderError: () => undefined,
    }));
  });
  try {
    await show(-60);
    expect(setLight.mock.calls).toEqual([[-60]]);
    setLight.mockClear();
    await show(45);
    expect(setLight.mock.calls).toEqual([[45]]);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
  }
});
