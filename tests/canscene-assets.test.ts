// @vitest-environment happy-dom
// canscene-assets.test.ts — every 2D to 3D entry builds a new CanScene, so the
// parsed can and HDRI are kept at module level and shared (#733). Each test
// re-imports the module so its cache starts empty. The renderer and the loaders
// are faked; the can and texture objects are real.
import type * as THREE from "three";
import { beforeEach, expect, it, vi } from "vitest";

const loads = vi.hoisted(() => ({ can: 0, hdr: 0, failNext: false }));
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
vi.mock("three/addons/loaders/GLTFLoader.js", async () => {
  const { BoxGeometry, Group, Mesh } = await import("three");
  return {
    GLTFLoader: class {
      load(_url: string, done: (gltf: { scene: THREE.Group }) => void, _p: unknown, fail: (e: Error) => void) {
        loads.can++;
        if (loads.failNext) { fail(new Error("offline")); return; }
        const scene = new Group();
        scene.add(new Mesh(new BoxGeometry(1, 2, 1)));
        done({ scene });
      }
    },
  };
});
vi.mock("three/addons/loaders/HDRLoader.js", async () => {
  const { DataTexture } = await import("three");
  return {
    HDRLoader: class {
      load(_url: string, done: (texture: THREE.DataTexture) => void, _p: unknown, fail: (e: Error) => void) {
        loads.hdr++;
        if (loads.failNext) { fail(new Error("offline")); return; }
        done(new DataTexture(new Uint8Array(4), 1, 1));
      }
    },
  };
});

type Internals = {
  canModel: THREE.Object3D | null;
  canMaterial: THREE.Material;
  scene: THREE.Scene;
};
const meshOf = (model: THREE.Object3D) => model.children[0] as THREE.Mesh;

async function freshModule() {
  vi.resetModules();
  const { CanScene } = await import("../src/three/canScene");
  return async () => {
    const scene = new CanScene(document.createElement("div"));
    const internals = scene as unknown as Internals;
    await vi.waitFor(() => {
      expect(internals.canModel).not.toBeNull();
      expect(internals.scene.environment).not.toBeNull();
    });
    return { scene, internals };
  };
}

beforeEach(() => {
  Object.assign(loads, { can: 0, hdr: 0, failNext: false });
  const context = new Proxy({}, {
    get: (_, name) => (name === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {}),
    set: () => true,
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
});

it("parses the can and the HDRI once across scenes", async () => {
  const enter = await freshModule();
  for (let entry = 0; entry < 3; entry++) (await enter()).scene.dispose();
  expect(loads).toMatchObject({ can: 1, hdr: 1 });
});

it("gives each scene its own model over the shared geometry", async () => {
  const enter = await freshModule();
  const first = await enter();
  const model = first.internals.canModel!;
  const { x: scale } = model.scale;
  first.scene.dispose();

  const second = await enter();
  const again = second.internals.canModel!;
  expect(again).not.toBe(model);
  expect(meshOf(again).geometry).toBe(meshOf(model).geometry);
  expect(meshOf(again).material).toBe(second.internals.canMaterial);
  // Sized from the pristine model, not from one a scene already scaled.
  expect(again.scale.x).toBe(scale);
  second.scene.dispose();
});

it("lets a scene free its environment without touching the next one's", async () => {
  const enter = await freshModule();
  const first = await enter();
  const second = await enter();
  const freed = vi.fn();
  const environment = second.internals.scene.environment!;
  environment.addEventListener("dispose", freed);
  expect(environment).not.toBe(first.internals.scene.environment);
  expect(environment.source).toBe(first.internals.scene.environment!.source);
  first.scene.dispose();
  expect(freed).not.toHaveBeenCalled();
  second.scene.dispose();
  expect(freed).toHaveBeenCalledTimes(1);
});

it("retries a failed load on the next entry", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const enter = await freshModule();
  loads.failNext = true;
  const { CanScene } = await import("../src/three/canScene");
  const failed = new CanScene(document.createElement("div"));
  await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
  failed.dispose();

  loads.failNext = false;
  (await enter()).scene.dispose();
  expect(loads).toMatchObject({ can: 2, hdr: 2 });
  warn.mockRestore();
});
