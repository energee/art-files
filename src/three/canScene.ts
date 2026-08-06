// canScene.ts — vanilla three.js scene for the 3D label previews: a single
// can, a 2x2 4-pack, and the flat label, with a per-pixel metallic-foil
// effect driven by the white-ink mask. Ported (heavily trimmed) from the
// captiva reference implementation's canScene.js — its timeline/export/
// settings machinery is deliberately absent; only what the three view modes
// need survives. Rendering is on-demand: frames are drawn on controls
// change, texture change, or resize, never in a free-running loop.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import type { LabelTextures } from "./labelTextures";
import { DEFAULT_LABEL_VIEW_SETTINGS, type LabelViewSettings } from "./labelSettings";
import type { CanSceneMode } from "./viewMode";

export type { CanSceneMode, ViewMode } from "./viewMode";


// ——— Tuning values, verbatim from captiva (sceneConstants.js + canScene.js) ———
/** Camera azimuth that faces the label front (recomputed per wrap angle). */
const DEFAULT_FRONT_AZIMUTH = 0.867;
const LABEL_BASE_ROTATION = Math.PI * 1.475;
/** Small angular trim to visually center the label seam. */
const LABEL_SEAM_OFFSET = 7 * (Math.PI / 180);
const DEFAULT_ZOOM = 0.275;
const MIN_ZOOM = 0.132;
const MAX_ZOOM = 0.66;
/** Normalized can height in world units. */
const SCENE_SCALE = 0.12;
const LABEL_OFFSET_RATIO = -0.020;
/** Center-to-center 4-pack spacing as a multiple of can radius: 2x = touching,
 *  the extra 0.02 leaves a hairline gap so adjacent walls don't z-fight. */
const FOUR_PACK_SPACING = 2.02;
/** Zoom multiplier framing the ~2x-wider 2x2 block. */
const FOUR_PACK_ZOOM = 2.1;
/** 4-pack polar tilt: elevated enough to see over the front row. */
const FOUR_PACK_TILT = Math.PI * 0.34;
const FLAT_LABEL_HEIGHT = 0.08;
/** The soft-mask blur (settings.edgeSoftnessPct, as a fraction of mask width)
 *  softens the 0->1 metalness step so foil edges don't draw a hard specular
 *  outline the physical print doesn't have. */
/** Longest edge of the die-cut alpha map. It is a flat rounded rect, so mip
 *  filtering makes this indistinguishable from an artwork-resolution copy —
 *  at ~1/16 the memory and upload cost, which matters because the corner
 *  radius is a draggable knob. */
const ALPHA_LONG_EDGE = 512;
/** Per-pixel roughness endpoints: matte white-ink areas vs bare foil. */
const MATTE_ROUGHNESS = 0.8;
const METALLIC_ROUGHNESS = 0.33;
/** Bump height of the foil layer (soft mask as bumpMap). */
const LAYER_DEPTH = 0.02;
/** App's dark theme background — scene background stays this flat color;
 *  the HDRI is lighting-only. */
const BACKGROUND = 0x0e0f11;

/** A sized canvas and its 2D context — the preamble every helper below
 *  would otherwise repeat. */
function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return [canvas, canvas.getContext("2d")!];
}

/** Same-size copy of a canvas with one CSS filter applied during the blit. */
function filteredCopy(canvas: HTMLCanvasElement, filter: string): HTMLCanvasElement {
  const [copy, ctx] = makeCanvas(canvas.width, canvas.height);
  ctx.filter = filter;
  ctx.drawImage(canvas, 0, 0);
  return copy;
}

/** Per-pixel lerp of the soft mask into a roughness map: matte 0.8 where the
 *  mask is black (white ink) down to 0.33 where it's white (foil). */
function roughnessCanvas(softMask: HTMLCanvasElement): HTMLCanvasElement {
  const { width, height } = softMask;
  const [out, ctx] = makeCanvas(width, height);
  const src = softMask.getContext("2d")!.getImageData(0, 0, width, height);
  const dst = ctx.createImageData(width, height);
  const matte = Math.round(MATTE_ROUGHNESS * 255);
  const metallic = Math.round(METALLIC_ROUGHNESS * 255);
  for (let i = 0; i < src.data.length; i += 4) {
    const m = src.data[i] / 255;
    const r = Math.round(matte + (metallic - matte) * m);
    dst.data[i] = dst.data[i + 1] = dst.data[i + 2] = r;
    dst.data[i + 3] = 255;
  }
  ctx.putImageData(dst, 0, 0);
  return out;
}

/**
 * The three 3D views of the label. Owns a WebGLRenderer inside `container`;
 * call resize() when the container changes size, applyTextures() when the
 * label art changes, setMode() to switch views, dispose() on unmount.
 */
export class CanScene {
  private container: HTMLElement;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private maxAnisotropy: number;

  private canModel: THREE.Object3D | null = null;
  private canMaterial: THREE.MeshPhysicalMaterial | null = null;
  private labelMesh: THREE.Mesh | null = null;
  private labelMaterial: THREE.MeshStandardMaterial | null = null;
  private settings: LabelViewSettings = { ...DEFAULT_LABEL_VIEW_SETTINGS };
  /** The die-cut mask, kept so the corner-radius knob repaints it in place
   *  instead of reallocating a canvas and a GPU texture per drag tick. */
  private alphaCanvas: HTMLCanvasElement | null = null;
  private flatMesh: THREE.Mesh | null = null;
  private shadowMesh: THREE.Mesh | null = null;
  private packGroup: THREE.Group | null = null;

  private canRadius = 0.033;
  private canHeight = SCENE_SCALE;
  /** Azimuth that faces the label front; recomputed per wrap angle. */
  private frontAzimuth = DEFAULT_FRONT_AZIMUTH;

  private mode: CanSceneMode = "can";
  /** The label art currently applied. Held both to replay a set that arrived
   *  before the async GLTF load finished, and so a settings change can
   *  rebuild the affected map or mesh without re-rasterizing the PDFs. */
  private labelTextures: LabelTextures | null = null;
  private disposed = false;
  private renderRequested = false;
  private raf: number | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene.background = new THREE.Color(BACKGROUND);

    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    this.camera = new THREE.PerspectiveCamera(35, w / h, 0.001, 100);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;
    container.appendChild(this.renderer.domElement);
    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.2;
    this.controls.minDistance = MIN_ZOOM;
    this.controls.maxDistance = MAX_ZOOM;
    // On-demand rendering: damping means one input event needs several frames
    // to settle, so each rendered frame re-requests while controls report
    // movement — the chain dies out once update() stops emitting 'change'.
    this.controls.addEventListener("change", () => this.requestRender());

    this.setupLights();
    this.loadEnvironment();
    void this.loadCan();

    this.camera.position.set(0, 0, DEFAULT_ZOOM);
    this.setCameraSpherical(DEFAULT_ZOOM, Math.PI / 2, this.frontAzimuth);
    this.requestRender();
  }

  // Ambient + warm key + cool fill + white rim, captiva's positions/tints.
  private setupLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.15));
    const key = new THREE.DirectionalLight(0xfff8f0, 3.5);
    key.position.set(1.9, 1.8, 1.5);
    const fill = new THREE.DirectionalLight(0xf0f4ff, 0.8);
    fill.position.set(-1.6, 0.8, -1.2);
    const rim = new THREE.DirectionalLight(0xffffff, 2.0);
    rim.position.set(0.4, 1.0, -1.7);
    this.scene.add(key, fill, rim);
  }

  /** studio.hdr as scene.environment only — background stays the flat theme
   *  color; the HDRI exists for the metal's reflections. */
  private loadEnvironment() {
    new RGBELoader().load(
      `${import.meta.env.BASE_URL}studio.hdr`,
      (texture) => {
        if (this.disposed) { texture.dispose(); return; }
        texture.mapping = THREE.EquirectangularReflectionMapping;
        this.scene.environment = texture;
        this.requestRender();
      },
      undefined,
      (err) => console.warn("Failed to load HDR environment:", err),
    );
  }

  /** Load /Can.gltf, orient upright, normalize to SCENE_SCALE height,
   *  center at origin, and give every mesh the brushed-aluminum material. */
  private async loadCan() {
    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
      new GLTFLoader().load(`${import.meta.env.BASE_URL}Can.gltf`, resolve, undefined, reject);
    }).catch((err) => { console.warn("Failed to load can model:", err); return null; });
    if (!gltf || this.disposed) return;

    const model = gltf.scene;
    this.canMaterial = new THREE.MeshPhysicalMaterial({
      color: "#999999", metalness: 1.0, roughness: 0.24,
      clearcoat: 1.0, clearcoatRoughness: 0.1, side: THREE.DoubleSide,
    });
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).material = this.canMaterial!;
    });

    // Auto-orient: if the model is wider than tall, stand it upright.
    const preSize = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    if (preSize.y < Math.max(preSize.x, preSize.z)) {
      model.rotation.x = -Math.PI / 2;
      model.updateMatrixWorld(true);
    }
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const scale = SCENE_SCALE / size.y;
    model.scale.setScalar(scale);
    model.position.copy(center.negate().multiplyScalar(scale));
    this.scene.add(model);
    this.canModel = model;
    this.canRadius = (Math.max(size.x, size.z) / 2) * scale;
    this.canHeight = size.y * scale;

    this.createDropShadow();
    // A label applied while the model was still loading sized its cylinder
    // off the placeholder radius — rebuild it against the real one.
    if (this.labelTextures) this.applyTextures(this.labelTextures);
    else this.applyMode();
    this.requestRender();
  }

  /** No shadow mapping — a radial-gradient plane under the can, per captiva. */
  private createDropShadow() {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const cx = size / 2;
    const paint = (radius: number, stops: [number, string][]) => {
      const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, radius);
      for (const [o, c] of stops) g.addColorStop(o, c);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    };
    paint(size * 0.18, [[0, "rgba(0,0,0,1)"], [0.5, "rgba(0,0,0,0.7)"], [1, "rgba(0,0,0,0)"]]);
    paint(cx, [
      [0, "rgba(0,0,0,0.5)"], [0.25, "rgba(0,0,0,0.3)"], [0.5, "rgba(0,0,0,0.15)"],
      [0.75, "rgba(0,0,0,0.04)"], [1, "rgba(0,0,0,0)"],
    ]);
    const shadowSize = this.canRadius * 4;
    this.shadowMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(shadowSize, shadowSize),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false,
      }),
    );
    this.shadowMesh.rotation.x = -Math.PI / 2;
    this.shadowMesh.position.y = -this.canHeight / 2 - 0.0005;
    this.scene.add(this.shadowMesh);
  }

  private createTexture(canvas: HTMLCanvasElement, srgb = false): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(canvas);
    t.flipY = true;
    t.anisotropy = this.maxAnisotropy;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private disposeMaterialMaps(material: THREE.MeshStandardMaterial) {
    // metalnessMap and bumpMap are deliberately the same texture (the soft
    // mask, uploaded once), so de-dupe before disposing.
    const maps = new Set([
      material.map, material.metalnessMap, material.roughnessMap,
      material.bumpMap, material.alphaMap,
    ]);
    for (const map of maps) map?.dispose();
  }

  /** Detach a mesh and free its geometry; the material is shared and outlives
   *  it. Returns null so callers read `this.x = this.removeMesh(this.x)`. */
  private removeMesh(mesh: THREE.Mesh | null): null {
    if (mesh) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    return null;
  }

  /**
   * (Re)build the label from fresh art + metalness canvases: one material
   * carrying every per-pixel map, plus the cylinder and flat-plane meshes
   * sized to the artwork's aspect.
   */
  applyTextures(tex: LabelTextures) {
    this.labelTextures = tex;
    if (!this.canModel) return; // replayed by loadCan on arrival
    this.rebuildMaterial();
    this.rebuildGeometry();
    this.applyMode(); // re-frame + rebuild the pack against the new meshes
  }

  /**
   * Apply the Document > Settings knobs. Each one rebuilds only what it
   * actually affects, because these are draggable: the corner radius
   * repaints a small canvas in place, the height swaps geometry, and only
   * edge softness pays for the blur and the derived maps. Nothing here
   * re-rasterizes the PDFs.
   */
  setLabelOptions(next: LabelViewSettings) {
    const prev = this.settings;
    this.settings = { ...next };
    if (!this.labelTextures || !this.canModel) return;
    if (next.edgeSoftnessPct !== prev.edgeSoftnessPct) this.rebuildSoftMaps();
    if (next.cornerRadiusPct !== prev.cornerRadiusPct) this.drawAlphaMask();
    if (next.labelHeightPct !== prev.labelHeightPct) {
      this.rebuildGeometry();
      this.applyMode(); // the wrap angle moved: re-frame, and re-clone the pack
    }
    this.requestRender();
  }

  /** The material and the maps that depend only on the artwork. */
  private rebuildMaterial() {
    const tex = this.labelTextures;
    if (!tex) return;
    const old = this.labelMaterial;
    this.labelMaterial = new THREE.MeshStandardMaterial({
      transparent: true, side: THREE.DoubleSide, metalness: 1.0, roughness: 1.0,
      map: this.createTexture(tex.art, true),
      bumpScale: LAYER_DEPTH,
      alphaTest: 0.5,
    });
    if (old) { this.disposeMaterialMaps(old); old.dispose(); }
    this.rebuildSoftMaps();
    this.rebuildAlphaMap();
  }

  /** The blurred foil mask and everything derived from it. One CanvasTexture
   *  serves both metalness and bump — same canvas, one GPU upload. */
  private rebuildSoftMaps() {
    const tex = this.labelTextures;
    const material = this.labelMaterial;
    if (!tex || !material) return;
    const blur = (this.settings.edgeSoftnessPct / 100) * tex.metalness.width;
    const soft = filteredCopy(tex.metalness, blur > 0 ? `blur(${blur}px)` : "none");
    const stale = new Set([material.metalnessMap, material.roughnessMap, material.bumpMap]);
    const softTexture = this.createTexture(soft);
    material.metalnessMap = softTexture;
    material.bumpMap = softTexture;
    material.roughnessMap = this.createTexture(roughnessCanvas(soft));
    for (const map of stale) map?.dispose();
    material.needsUpdate = true;
  }

  /** Allocate the die-cut alpha mask at ALPHA_LONG_EDGE, preserving aspect so
   *  the corner radius stays the same share of the short edge. */
  private rebuildAlphaMap() {
    const tex = this.labelTextures;
    const material = this.labelMaterial;
    if (!tex || !material) return;
    const [w, h] = tex.aspect >= 1
      ? [ALPHA_LONG_EDGE, Math.round(ALPHA_LONG_EDGE / tex.aspect)]
      : [Math.round(ALPHA_LONG_EDGE * tex.aspect), ALPHA_LONG_EDGE];
    [this.alphaCanvas] = makeCanvas(w, h);
    this.drawAlphaMask();
    material.alphaMap?.dispose();
    material.alphaMap = this.createTexture(this.alphaCanvas);
    material.needsUpdate = true;
  }

  /** Paint the die cut: a white rounded rect on black, corner radius as a
   *  share of the short edge (the physical label is cut, not printed square).
   *  In place — this is the whole cost of dragging the corner-radius knob. */
  private drawAlphaMask() {
    const canvas = this.alphaCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height,
      (this.settings.cornerRadiusPct / 100) * Math.min(canvas.width, canvas.height));
    ctx.fill();
    const alphaMap = this.labelMaterial?.alphaMap;
    if (alphaMap) alphaMap.needsUpdate = true;
  }

  /** The cylinder and flat plane. Depends on the can's measured size, the
   *  label height knob and the artwork aspect — not on any map. */
  private rebuildGeometry() {
    const tex = this.labelTextures;
    const material = this.labelMaterial;
    if (!tex || !material) return;
    const labelHeight = this.canHeight * (this.settings.labelHeightPct / 100);
    const labelRadius = this.canRadius * 1.005;
    const wrapAngle = Math.min((labelHeight * tex.aspect) / labelRadius, Math.PI * 1.95);

    this.labelMesh = this.removeMesh(this.labelMesh);
    this.labelMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(labelRadius, labelRadius, labelHeight, 64, 1, true, 0, wrapAngle),
      material,
    );
    this.labelMesh.position.y = this.canHeight * LABEL_OFFSET_RATIO;
    // wrapAngle/2 positions the cylinder's center seam at the back; the
    // camera's front azimuth uses the full wrapAngle to face the label center.
    this.labelMesh.rotation.y = wrapAngle / 2 + LABEL_BASE_ROTATION - LABEL_SEAM_OFFSET;
    this.frontAzimuth = wrapAngle + LABEL_BASE_ROTATION - LABEL_SEAM_OFFSET;
    this.scene.add(this.labelMesh);

    // Flat plane shares the label material; its geometry tracks the aspect.
    this.flatMesh = this.removeMesh(this.flatMesh);
    this.flatMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(FLAT_LABEL_HEIGHT * tex.aspect, FLAT_LABEL_HEIGHT),
      material,
    );
    this.scene.add(this.flatMesh);
  }

  /** Switch view. Also called internally to re-apply visibility/camera after
   *  a texture or model change. */
  setMode(mode: CanSceneMode) {
    this.mode = mode;
    this.applyMode();
  }

  private applyMode() {
    const mode = this.mode;
    // Tear down the previous pack; clones share geometry/materials with the
    // sources (Object3D.clone copies by reference), so removal is enough.
    if (this.packGroup) { this.scene.remove(this.packGroup); this.packGroup = null; }

    const canVisible = mode === "can";
    if (this.canModel) this.canModel.visible = canVisible;
    if (this.labelMesh) this.labelMesh.visible = canVisible;
    if (this.shadowMesh) this.shadowMesh.visible = canVisible;
    if (this.flatMesh) this.flatMesh.visible = mode === "flat";

    this.controls.target.set(0, 0, 0);
    if (mode === "pack") {
      this.buildPackGroup();
      this.setCameraSpherical(DEFAULT_ZOOM * FOUR_PACK_ZOOM, FOUR_PACK_TILT, this.frontAzimuth);
    } else if (mode === "flat") {
      // Front-on: straight down +z at the plane, orbit still available.
      this.setCameraSpherical(0.2, Math.PI / 2, 0);
    } else {
      this.setCameraSpherical(DEFAULT_ZOOM, Math.PI / 2, this.frontAzimuth);
    }
    this.requestRender();
  }

  /** 2x2 block of clones, laid out in the camera's frame (offsets rotated by
   *  frontAzimuth) so one grid axis runs across the screen, one into depth. */
  private buildPackGroup() {
    if (!this.canModel) return;
    const sources = [this.canModel, this.labelMesh, this.shadowMesh]
      .filter((s): s is THREE.Object3D => !!s);
    this.packGroup = new THREE.Group();
    const half = (this.canRadius * FOUR_PACK_SPACING) / 2;
    const a = this.frontAzimuth;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (const [ix, iz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const unit = new THREE.Group();
      for (const source of sources) {
        const clone = source.clone();
        clone.visible = true; // sources are hidden in pack mode; clones aren't
        unit.add(clone);
      }
      const x = ix * half, z = iz * half;
      unit.position.set(x * ca + z * sa, 0, -x * sa + z * ca);
      this.packGroup.add(unit);
    }
    this.scene.add(this.packGroup);
    for (const source of sources) source.visible = false;
  }

  private setCameraSpherical(radius: number, phi: number, azimuth: number) {
    this.camera.position.set(
      radius * Math.sin(phi) * Math.sin(azimuth),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(azimuth),
    );
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.requestRender();
  }

  /** Coalesce renders to one per animation frame (on-demand rendering). */
  private requestRender() {
    if (this.renderRequested || this.disposed) return;
    this.renderRequested = true;
    this.raf = requestAnimationFrame(() => {
      this.renderRequested = false;
      this.raf = null;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  dispose() {
    this.disposed = true;
    if (this.raf != null) cancelAnimationFrame(this.raf);
    if (this.labelMaterial) {
      this.disposeMaterialMaps(this.labelMaterial);
      this.labelMaterial.dispose();
    }
    this.labelMesh = this.removeMesh(this.labelMesh);
    this.flatMesh = this.removeMesh(this.flatMesh);
    // Drop the cached artwork canvases (tens of MB of backing store).
    this.labelTextures = null;
    this.alphaCanvas = null;
    if (this.shadowMesh) {
      this.shadowMesh.geometry.dispose();
      const m = this.shadowMesh.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
    }
    this.canModel?.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).geometry.dispose();
    });
    this.canMaterial?.dispose();
    this.scene.environment?.dispose();
    this.controls.dispose();
    // Detach the canvas so a scene recreated against the same container
    // (React StrictMode double-invoke, HMR) doesn't stack behind this one.
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }
}
