// zoom-pan.test.ts — the preview pane's zoom math (useZoomPan.ts): the zoom
// range, the cover clamp that keeps the label from being stranded against
// empty background, and zooming about a point keeps that point still.
import { expect, it } from "vitest";
import { clampView, clampZoom, zoomAbout, ZOOM_FACTOR } from "../src/useZoomPan";
import { PREVIEW_OVERSAMPLE } from "../src/layout";

const pane = { width: 800, height: 600 } as DOMRect;

it("clamps zoom to fitted through the oversample ceiling", () => {
  expect(clampZoom(0.2)).toBe(1);
  expect(clampZoom(99)).toBe(PREVIEW_OVERSAMPLE);
  expect(clampZoom(1 * ZOOM_FACTOR)).toBe(1.25);
});

it("keeps the scaled content covering the pane", () => {
  expect(clampView(pane, 2, 50, 50)).toEqual({ z: 2, x: 0, y: 0 });
  expect(clampView(pane, 2, -5000, -5000)).toEqual({ z: 2, x: -800, y: -600 });
});

it("zooms about a point without moving what is under it", () => {
  const v = zoomAbout(pane, { z: 1, x: 0, y: 0 }, 2, 400, 300);
  // Content under (400, 300) at z=1 is content point (400, 300); at z=2 it
  // must still draw at (400, 300): 400 = x + 2 * 400.
  expect(v).toEqual({ z: 2, x: -400, y: -300 });
});
