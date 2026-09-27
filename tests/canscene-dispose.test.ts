// canscene-dispose.test.ts — CanScene.dispose() releases its WebGL context at
// once. CanView mounts a new scene on every 2D↔3D or tab switch, and
// renderer.dispose() alone leaves the context alive until GC, so rapid
// switching hit Chrome's "Too many active WebGL contexts" (issue #125).
// The renderer, controls, and loaders are faked; happy-dom has no WebGL.
// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class WebGLRenderer {
    domElement = document.createElement("canvas");
    capabilities = { getMaxAnisotropy: () => 1 };
    toneMapping = 0; toneMappingExposure = 1;
    setPixelRatio() {} setSize() {} render() {}
    forceContextLoss() { calls.push("forceContextLoss"); }
    dispose() { calls.push("dispose"); }
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
vi.mock("three/addons/loaders/RGBELoader.js", () => ({ RGBELoader: class { load() {} } }));
import { CanScene } from "../src/three/canScene";

it("disposes the renderer, then forces its WebGL context lost", () => {
  const host = document.createElement("div");
  const scene = new CanScene(host);
  scene.dispose();
  // dispose() first: its GL deletes run on a live context, and it removes
  // three's webglcontextlost listener before the forced loss fires it.
  expect(calls).toEqual(["dispose", "forceContextLoss"]);
});
