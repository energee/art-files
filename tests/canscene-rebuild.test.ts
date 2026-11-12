// @vitest-environment happy-dom
// canscene-rebuild.test.ts — what one edit costs the 3D view. A rebuild swaps
// the label's maps on the live material and meshes; the counts here stand in
// for GL work (a disposed material relinks its shaders, a new texture is an
// upload), because happy-dom has no WebGL. Only the renderer, the 2D canvas
// context and asset loading are faked.
import * as THREE from "three";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class WebGLRenderer {
    domElement = document.createElement("canvas");
    capabilities = { getMaxAnisotropy: () => 1 };
    toneMapping = 0; toneMappingExposure = 1;
    setPixelRatio() {} setSize() {} forceContextLoss() {} dispose() {}
    render() { renders.count++; }
  }
  return { ...actual, WebGLRenderer };
});
const renders = vi.hoisted(() => ({ count: 0 }));
/** Calls that pull pixels back to or from a 2D canvas on the main thread. */
const readbacks = vi.hoisted(() => ({ count: 0 }));
/** What the fake mask plate reads back as: one RGB value for every pixel. */
let maskInk = 255;
vi.mock("three/addons/loaders/GLTFLoader.js", async () => {
  const { BoxGeometry, Group, Mesh } = await import("three");
  return {
    GLTFLoader: class {
      load(_url: string, done: (gltf: { scene: THREE.Group }) => void) {
        const scene = new Group();
        scene.add(new Mesh(new BoxGeometry(1, 2, 1)));
        done({ scene });
      }
    },
  };
});
vi.mock("three/addons/loaders/HDRLoader.js", () => ({ HDRLoader: class { load() {} } }));
import { CanScene, type CanSceneMode } from "../src/three/canScene";
import { buildLabelTextures, drawPlates, type LabelTextures } from "../src/three/labelTextures";

type Label = THREE.MeshStandardMaterial;
type Internals = {
  canModel: THREE.Object3D | null;
  labelMaterial: Label;
  labelMesh: THREE.Mesh;
  flat: { front: THREE.Mesh; back: THREE.Mesh<THREE.BufferGeometry, Label> };
  packGroup: THREE.Group | null;
};

const canvas = () => {
  const c = document.createElement("canvas");
  c.width = 8; c.height = 4;
  return c;
};
const plates = (): LabelTextures => ({
  art: canvas(), metalness: canvas(), metalnessPixels: new Uint8ClampedArray(0),
});

let frames: Map<number, FrameRequestCallback>;
const drainFrames = () => {
  while (frames.size) {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  }
};

beforeEach(() => {
  renders.count = 0;
  maskInk = 255;
  vi.stubGlobal("ImageData", class { constructor(public data: Uint8ClampedArray) {} });
  frames = new Map();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  // Only canvas sizes and call counts matter here, never the pixels.
  const pixels = () => {
    readbacks.count++;
    return { data: new Uint8ClampedArray(8 * 4 * 4).fill(maskInk) };
  };
  const calls: Record<string, () => unknown> = {
    getImageData: pixels, createImageData: pixels, putImageData: () => { readbacks.count++; },
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  const context = new Proxy({}, { get: (_, name: string) => calls[name] ?? (() => {}), set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
});

async function loadedScene(mode: CanSceneMode = "can") {
  const host = document.createElement("div");
  Object.defineProperties(host, { clientWidth: { value: 640 }, clientHeight: { value: 480 } });
  const scene = new CanScene(host);
  const internals = scene as unknown as Internals;
  await vi.waitFor(() => expect(internals.canModel).not.toBeNull());
  scene.applyTextures(plates());
  scene.setMode(mode);
  drainFrames();
  return { scene, internals };
}

it("swaps the maps on the live material, so a rebuild relinks no shaders", async () => {
  const { scene, internals } = await loadedScene();
  const material = internals.labelMaterial;
  const backing = internals.flat.back.material;
  const { version } = material;
  const disposed = vi.fn();
  material.addEventListener("dispose", disposed);
  backing.addEventListener("dispose", disposed);

  const next = plates();
  scene.applyTextures(next);

  expect(internals.labelMaterial).toBe(material);
  expect(internals.flat.back.material).toBe(backing);
  expect(disposed).not.toHaveBeenCalled();
  // needsUpdate bumps this, and that is what sends three back to the programs.
  expect(material.version).toBe(version);
  expect(material.map!.image).toBe(next.art);
  scene.dispose();
});

it("keeps the meshes through a rebuild and frees the replaced maps", async () => {
  const { scene, internals } = await loadedScene();
  const { labelMesh, flat } = internals;
  const geometry = labelMesh.geometry;
  const oldMap = internals.labelMaterial.map!;
  const freed = vi.fn();
  oldMap.addEventListener("dispose", freed);

  scene.applyTextures(plates());

  expect(internals.labelMesh).toBe(labelMesh);
  expect(internals.labelMesh.geometry).toBe(geometry);
  expect(internals.flat).toBe(flat);
  expect(freed).toHaveBeenCalledTimes(1);
  scene.dispose();
});

it("paints a rebuild, in every view", async () => {
  for (const mode of ["can", "pack", "flat"] as const) {
    const { scene, internals } = await loadedScene(mode);
    renders.count = 0;
    const next = plates();
    scene.applyTextures(next);
    drainFrames();
    expect(renders.count, mode).toBeGreaterThan(0);
    // The 4-pack's clones share the material, so they carry the new art too.
    const labels: THREE.Mesh[] = [];
    internals.packGroup?.traverse((o) => {
      if ((o as THREE.Mesh).material === internals.labelMaterial) labels.push(o as THREE.Mesh);
    });
    expect(labels).toHaveLength(mode === "pack" ? 4 : 0);
    expect(internals.labelMaterial.map!.image).toBe(next.art);
    scene.dispose();
  }
});

it("derives roughness in the shader, with no pixel readback on a rebuild", async () => {
  const { scene, internals } = await loadedScene();
  readbacks.count = 0;
  scene.applyTextures(plates());
  scene.setLabelOptions({ edgeSoftnessRatio: 0.004 });
  expect(readbacks.count).toBe(0);
  expect(internals.labelMaterial.roughnessMap).toBeNull();
  scene.dispose();
});

it("patches three's own standard shader with the two roughness endpoints", async () => {
  const { scene, internals } = await loadedScene();
  const shader = { fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  internals.labelMaterial.onBeforeCompile(shader as never, null as never);
  // Guards a three upgrade: a renamed chunk would leave the shader unpatched.
  expect(shader.fragmentShader).not.toContain("<roughnessmap_fragment>");
  // 204/255 where the mask is black (white ink), 84/255 where it's white (foil).
  expect(shader.fragmentShader).toContain("mix(0.800000, 0.329412, texture2D( metalnessMap");
  scene.dispose();
});

/** One debounced edit, end to end, counting the canvases it creates and the
 *  textures it hands the GPU. */
async function countEdit(scene: CanScene, previous: LabelTextures | null) {
  const made = vi.spyOn(document, "createElement");
  const uploads = vi.spyOn(THREE, "CanvasTexture");
  const textures = await buildLabelTextures(drawPlates([], {} as never, "serif"), previous);
  scene.applyTextures(textures);
  const canvases = made.mock.calls.filter(([tag]) => tag === "canvas").length;
  const uploaded = uploads.mock.calls.length;
  made.mockRestore();
  uploads.mockRestore();
  return { canvases, uploads: uploaded, textures };
}

it("redraws and uploads only the art when the mask plate is unchanged", async () => {
  const { scene, internals } = await loadedScene();
  const first = await countEdit(scene, null);
  const { metalnessMap, alphaMap } = internals.labelMaterial;

  const second = await countEdit(scene, first.textures);

  // The two plates are always drawn; nothing derived from the mask is redone.
  expect(second.canvases).toBe(2);
  expect(second.uploads).toBe(1);
  expect(second.textures.metalness).toBe(first.textures.metalness);
  expect(internals.labelMaterial.metalnessMap).toBe(metalnessMap);
  expect(internals.labelMaterial.alphaMap).toBe(alphaMap);
  scene.dispose();
});

it("rebuilds the mask maps when the mask plate changes", async () => {
  const { scene, internals } = await loadedScene();
  const first = await countEdit(scene, null);
  const { metalnessMap, alphaMap } = internals.labelMaterial;

  maskInk = 0;
  const second = await countEdit(scene, first.textures);

  // The plates, the classified mask and its blurred copy.
  expect(second.canvases).toBe(4);
  expect(second.uploads).toBe(2);
  expect(second.textures.metalness).not.toBe(first.textures.metalness);
  expect(internals.labelMaterial.metalnessMap).not.toBe(metalnessMap);
  expect(internals.labelMaterial.alphaMap).toBe(alphaMap);
  scene.dispose();
});

it("feeds metalness and bump from one texture", async () => {
  const { scene, internals } = await loadedScene();
  expect(internals.labelMaterial.bumpMap).toBe(internals.labelMaterial.metalnessMap);
  scene.setLabelOptions({ edgeSoftnessRatio: 0.004 });
  expect(internals.labelMaterial.bumpMap).toBe(internals.labelMaterial.metalnessMap);
  scene.dispose();
});

it("redraws the die-cut silhouette for a new corner radius, front and back", async () => {
  const { scene, internals } = await loadedScene();
  const before = internals.labelMaterial.alphaMap;
  scene.setLabelOptions({ cornerRadiusPct: 12 });
  const after = internals.labelMaterial.alphaMap;
  expect(after).not.toBe(before);
  scene.applyTextures(plates());
  expect(internals.labelMaterial.alphaMap).toBe(after);
  expect(internals.flat.back.material.alphaMap).toBe(after);
  scene.dispose();
});

it("repaints when the edge softness changes after a rebuild reused the mask", async () => {
  const { scene, internals } = await loadedScene();
  const first = await countEdit(scene, null);
  const second = await countEdit(scene, first.textures);
  const before = internals.labelMaterial.metalnessMap;
  drainFrames();
  renders.count = 0;
  scene.setLabelOptions({ edgeSoftnessRatio: 0.004 });
  drainFrames();
  expect(internals.labelMaterial.metalnessMap).not.toBe(before);
  expect(internals.labelMaterial.metalnessMap!.image).not.toBe(second.textures.metalness);
  expect(renders.count).toBeGreaterThan(0);
  scene.dispose();
});
