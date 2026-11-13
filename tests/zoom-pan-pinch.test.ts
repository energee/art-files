// tests/zoom-pan-pinch.test.ts — two fingers zoom about their midpoint and
// pan with it, clamped as the wheel is (phone layout, Phase 3).
import { expect, it } from "vitest";
import { pinchView, zoomAbout } from "../src/useZoomPan";

const R = { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 } as DOMRect;
const P = (x: number, y: number) => ({ x, y });

it("doubling the spread about a still midpoint zooms 2x about it, as the wheel would", () => {
  const v = { z: 1, x: 0, y: 0 };
  const next = pinchView(R, v, P(300, 300), P(500, 300), P(200, 300), P(600, 300));
  expect(next).toEqual({ z: 2, x: -400, y: -300 });
  expect(next).toEqual(zoomAbout(R, v, 2, 400, 300));
});

it("moving both fingers together pans by the midpoint's move", () => {
  expect(pinchView(R, { z: 2, x: -400, y: -300 }, P(300, 300), P(500, 300), P(320, 310), P(520, 310)))
    .toEqual({ z: 2, x: -380, y: -290 });
});

it("zooms and pans in one move", () => {
  expect(pinchView(R, { z: 1, x: 0, y: 0 }, P(300, 300), P(500, 300), P(250, 350), P(650, 350)))
    .toEqual({ z: 2, x: -350, y: -250 });
});

// Review Focus 3: at the limits nothing moves (so liveView tells nobody, #726).
it("stops at the top of the range without drifting", () => {
  const v = { z: 2.5, x: -600, y: -450 };
  expect(pinchView(R, v, P(300, 300), P(500, 300), P(200, 300), P(600, 300))).toEqual(v);
});

it("stops at the bottom of the range, and a fitted view cannot pan", () => {
  const v = { z: 1, x: 0, y: 0 };
  expect(pinchView(R, v, P(300, 300), P(500, 300), P(350, 300), P(450, 300))).toEqual(v);
  expect(pinchView(R, v, P(300, 300), P(500, 300), P(350, 350), P(550, 350))).toEqual(v);
});

it("treats fingers that start on one spot as a pan, never NaN", () => {
  const v = { z: 2, x: -400, y: -300 };
  expect(pinchView(R, v, P(400, 300), P(400, 300), P(390, 300), P(410, 300))).toEqual(v);
});
