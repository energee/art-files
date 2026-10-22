// canscene-bend.test.ts — the Rendered view's Curve knob bends the flat label
// around a vertical axis without stretching it: every column keeps its
// distance along the surface, the centre column stays where the flat plane
// had it (so framing is unchanged), and the edges recede away from the camera
// like a can's.
import * as THREE from "three";
import { expect, it } from "vitest";
import { bendPlane } from "../src/three/canScene";

const W = 2, H = 1;
const columnX = (g: THREE.BufferGeometry) => {
  const p = g.getAttribute("position");
  return Array.from({ length: p.count }, (_, i) => [p.getX(i), p.getZ(i)] as const);
};

it("leaves the plane flat at radius Infinity", () => {
  const g = bendPlane(new THREE.PlaneGeometry(W, H, 8, 1), Infinity);
  for (const [, z] of columnX(g)) expect(z).toBe(0);
});

it("bends to a convex arc that keeps the label's width as arc length", () => {
  const r = 1;
  const flat = new THREE.PlaneGeometry(W, H, 8, 1);
  const xs = columnX(flat).map(([x]) => x);
  const g = bendPlane(new THREE.PlaneGeometry(W, H, 8, 1), r);
  columnX(g).forEach(([x, z], i) => {
    // Back on the circle centred at (0, -r)…
    expect(Math.hypot(x, z + r)).toBeCloseTo(r, 6);
    // …at the angle that preserves the flat x as arc length.
    expect(Math.atan2(x, z + r) * r).toBeCloseTo(xs[i], 6);
    expect(z).toBeLessThanOrEqual(1e-9); // edges recede, never bulge forward
  });
  // The centre column is untouched.
  const centre = columnX(g).find(([x]) => Math.abs(x) < 1e-9)!;
  expect(centre[1]).toBeCloseTo(0, 9);
});
