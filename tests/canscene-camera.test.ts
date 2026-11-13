// @vitest-environment happy-dom
// Exercise the installed OrbitControls: its change threshold is deliberately
// coarser than its remaining damping motion. Only WebGL and asset loading are
// faked; the camera, gestures, damping and render scheduler are real.
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class WebGLRenderer {
    domElement = document.createElement("canvas");
    capabilities = { getMaxAnisotropy: () => 1 };
    toneMapping = 0; toneMappingExposure = 1;
    setPixelRatio() {}
    setSize(w: number, h: number) {
      Object.defineProperties(this.domElement, {
        clientWidth: { configurable: true, value: w },
        clientHeight: { configurable: true, value: h },
      });
    }
    render() {} forceContextLoss() {} dispose() {}
  }
  return { ...actual, WebGLRenderer };
});
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({ GLTFLoader: class { load() {} } }));
vi.mock("three/addons/loaders/HDRLoader.js", () => ({ HDRLoader: class { load() {} } }));
import { CanScene } from "../src/three/canScene";

type CameraScene = {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  renderer: THREE.WebGLRenderer;
  requestRender(): void;
};
let scene: CanScene;
let internals: CameraScene;
let host: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;

function drainFrames() {
  let count = 0;
  while (frames.size) {
    if (++count > 100) throw new Error("Camera failed to settle within 100 frames");
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(count * 16));
  }
  return count;
}

function cameraState() {
  return [
    ...internals.camera.position.toArray(),
    ...internals.camera.quaternion.toArray(),
    ...internals.controls.target.toArray(),
  ];
}

function expectCameraNear(expected: number[]) {
  cameraState().forEach((value, index) => expect(value).toBeCloseTo(expected[index], 12));
}

beforeEach(() => {
  frames = new Map();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  host = document.createElement("div");
  Object.defineProperties(host, {
    clientWidth: { value: 640 }, clientHeight: { value: 640 },
  });
  document.body.appendChild(host);
  scene = new CanScene(host);
  internals = scene as unknown as CameraScene;
  scene.resize();
  drainFrames();
});

afterEach(() => {
  scene.dispose();
  host.remove();
  vi.unstubAllGlobals();
});

it.each([
  ["orbit", (controls: OrbitControls) => controls.rotateLeft(0.4)],
  ["tilt", (controls: OrbitControls) => controls.rotateUp(0.2)],
  ["pan", (controls: OrbitControls) => controls.pan(80, 35)],
  ["zoom", (controls: OrbitControls) => controls.dollyIn(0.8)],
] as const)("settles %s completely before unrelated renders", (_name, gesture) => {
  const before = cameraState();
  gesture(internals.controls);
  expect(drainFrames()).toBeGreaterThan(0);
  const settled = cameraState();
  expect(settled).not.toEqual(before);
  expect(internals.controls.enableDamping).toBe(true);

  // No tolerance here: an idle paint must not even update the controls.
  for (let index = 0; index < 20; index++) {
    internals.requestRender();
    scene.setLight(index * 13);
    expect(frames.size).toBe(1);
    expect(drainFrames()).toBe(1);
    expect(cameraState()).toEqual(settled);
  }
  // A same-size resize intentionally synchronizes controls and pan/zoom. It
  // must not release any leftover inertia or restore an earlier damped pan.
  for (let index = 0; index < 10; index++) {
    scene.resize();
    drainFrames();
    expectCameraNear(settled);
  }
  internals.controls.update();
  expectCameraNear(settled);
  expect(frames.size).toBe(0);
});

it("settles a keyboard pan even when the first movement emits no change", () => {
  internals.controls.keyPanSpeed = 0.1;
  const changed = vi.fn();
  internals.controls.addEventListener("change", changed);
  const before = cameraState();
  const event = new KeyboardEvent("keydown", { code: "ArrowRight", cancelable: true });
  host.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(changed).not.toHaveBeenCalled();
  expect(drainFrames()).toBeGreaterThan(0);
  const settled = cameraState();
  expect(settled).not.toEqual(before);
  internals.controls.update();
  expectCameraNear(settled);
  expect(frames.size).toBe(0);
});

it("wakes sub-threshold pointer gestures on start/end and still stops", () => {
  const before = cameraState();
  internals.controls.dispatchEvent({ type: "start" });
  internals.controls.rotateLeft(0.0001);
  internals.controls.dispatchEvent({ type: "end" });
  expect(drainFrames()).toBeGreaterThan(0);
  const settled = cameraState();
  expect(settled).not.toEqual(before);
  internals.controls.update();
  expectCameraNear(settled);
  expect(frames.size).toBe(0);
});

it("cancels settling and ignores subsequent input after disposal", () => {
  internals.controls.rotateLeft(0.4);
  expect(frames.size).toBe(1);
  scene.dispose();
  expect(frames.size).toBe(0);
  const render = vi.spyOn(internals.renderer, "render");
  host.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));
  internals.requestRender();
  expect(frames.size).toBe(0);
  expect(render).not.toHaveBeenCalled();
});

// OrbitControls reports a change whenever its distance clamp bites, and a
// camera resting on a limit can sit one rounding error past it on every call.
// Whether it does depends on the pane and the orbit, so this walks a grid of
// panes through every way of landing on a limit (#721).
it("stops rendering when the camera rests on a distance limit, in any pane", () => {
  const looped: string[] = [];
  const landings: [string, (s: CanScene, c: OrbitControls) => void][] = [
    ["framed", (s) => { s.setZoom(1.5); drainFrames(); s.setZoom(1); }],
    ["zoomed all the way in", (_, c) => c.dollyIn(0.001)],
    ["zoomed all the way out", (_, c) => c.dollyOut(0.001)],
  ];
  const settles = () => {
    try { drainFrames(); return true; } catch { frames.clear(); return false; }
  };
  for (let w = 500; w <= 1800; w += 37) {
    for (let h = 400; h <= 1100; h += 101) {
      const pane = document.createElement("div");
      Object.defineProperties(pane, { clientWidth: { value: w }, clientHeight: { value: h } });
      for (const [name, land] of landings) {
        const paneScene = new CanScene(pane);
        const { controls } = paneScene as unknown as CameraScene;
        paneScene.resize();
        controls.rotateLeft(0.37);
        const settled = settles() && (land(paneScene, controls), settles());
        if (!settled) looped.push(`${w}x${h} ${name}`);
        paneScene.dispose();
      }
    }
  }
  expect(looped).toEqual([]);
});

it("still paints every picture change once the camera has stopped on a limit", () => {
  scene.setZoom(1);
  drainFrames();
  const render = vi.spyOn(internals.renderer, "render");
  const changes: [string, () => void][] = [
    ["light", () => scene.setLight(45)],
    ["mode", () => scene.setMode("pack")],
    ["zoom", () => scene.setZoom(1.2)],
    ["back to the limit", () => scene.setZoom(1)],
    ["pan", () => scene.setPan({ x: 0.1, y: 0 })],
    ["resize", () => scene.resize()],
  ];
  for (const [name, change] of changes) {
    render.mockClear();
    change();
    drainFrames();
    expect(render.mock.calls.length, name).toBeGreaterThan(0);
  }
});

// The 3D half of Fit (tests/fit-sheet-dom.test.tsx has the 2D half): at 100%
// the flat label stands as tall on screen as the 2D sheet would, and on a
// short pane that sheet is the pane's full height (fitSheetWidth).
it("frames the flat label at 100% as tall as a short pane, like the 2D sheet", () => {
  const pane = document.createElement("div");
  Object.defineProperties(pane, { clientWidth: { value: 543 }, clientHeight: { value: 241 } });
  const flat = new CanScene(pane);
  flat.resize(); flat.setMode("flat"); flat.setZoom(1); drainFrames();
  const { camera, controls } = flat as unknown as CameraScene;
  const labelHeight = (flat as unknown as { labelHeight(): number }).labelHeight();
  const viewHeight = 2 * camera.position.distanceTo(controls.target) * Math.tan((camera.fov * Math.PI) / 360);
  expect((labelHeight / viewHeight) * 241).toBeCloseTo(241, 6);
  flat.dispose();
});
