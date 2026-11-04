// canscene-light.test.ts — CanScene.setLight turns the whole light rig (key,
// fill, rim) and the HDRI's reflections about the vertical axis together, so
// the operator can move the highlight around the can (issue #570). 0° is the
// original rig. The renderer, controls, and loaders are faked; happy-dom has
// no WebGL.
// @vitest-environment happy-dom
import * as THREE from "three";
import { expect, it, vi } from "vitest";

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class WebGLRenderer {
    domElement = document.createElement("canvas");
    capabilities = { getMaxAnisotropy: () => 1 };
    toneMapping = 0; toneMappingExposure = 1;
    setPixelRatio() {} setSize() {} render() {} forceContextLoss() {} dispose() {}
  }
  return { ...actual, WebGLRenderer };
});
vi.mock("three/addons/controls/OrbitControls.js", () => ({
  OrbitControls: class {
    target = { set() {}, copy() {}, clone() { return this; }, x: 0, y: 0, z: 0 };
    addEventListener() {} listenToKeyEvents() {} update() {} dispose() {}
  },
}));
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({ GLTFLoader: class { load() {} } }));
vi.mock("three/addons/loaders/HDRLoader.js", () => ({ HDRLoader: class { load() {} } }));
import { CanScene } from "../src/three/canScene";

/** World positions of the scene's directional lights, in insertion order. */
function lightPositions(scene: CanScene) {
  const root = (scene as unknown as { scene: THREE.Scene }).scene;
  root.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  root.traverse((o) => {
    if ((o as THREE.DirectionalLight).isDirectionalLight) out.push(o.getWorldPosition(new THREE.Vector3()));
  });
  return { root, out };
}

it("rotates every light and the environment about Y by the angle", () => {
  const scene = new CanScene(document.createElement("div"));
  const before = lightPositions(scene).out;
  expect(before).toHaveLength(3);
  scene.setLight(90);
  const { root, out } = lightPositions(scene);
  const turn = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  out.forEach((p, i) => {
    const want = before[i].clone().applyMatrix4(turn);
    expect(p.x).toBeCloseTo(want.x, 9);
    expect(p.y).toBeCloseTo(want.y, 9);
    expect(p.z).toBeCloseTo(want.z, 9);
  });
  expect(root.environmentRotation.y).toBeCloseTo(Math.PI / 2, 9);
  scene.dispose();
});

it("puts the rig back exactly at 0°", () => {
  const scene = new CanScene(document.createElement("div"));
  const before = lightPositions(scene).out;
  scene.setLight(-60);
  scene.setLight(0);
  const { root, out } = lightPositions(scene);
  out.forEach((p, i) => expect(p.equals(before[i])).toBe(true));
  expect(root.environmentRotation.y).toBe(0);
  scene.dispose();
});
