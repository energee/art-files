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
import { DEFAULT_RENDER } from "@/presets";
import { MAX_WRAP_RATIO } from "@/layout";

export type CanSceneMode = "can" | "pack" | "flat";

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
/** The Settings knobs' starting values, until CanView pushes the saved ones
 *  in. Read from DEFAULT_RENDER rather than restated here, so the scene, the
 *  inspector and presets.json cannot ship three different "defaults"; the
 *  /100 is the percent-to-ratio conversion this class works in.
 *
 *  The blur (edgeSoftnessRatio) is a fraction of mask width — it softens the
 *  0->1 metalness step so foil edges don't draw a hard specular outline the
 *  physical print doesn't have. */
const DEFAULTS = {
  heightRatio: DEFAULT_RENDER.labelSize / 100,
  widthRatio: DEFAULT_RENDER.labelWidth / 100,
  cornerRadiusPct: DEFAULT_RENDER.cornerRadius,
  edgeSoftnessRatio: DEFAULT_RENDER.edgeSoftness / 100,
};
/** Per-pixel roughness endpoints: matte white-ink areas vs bare foil. */
const MATTE_ROUGHNESS = 0.8;
const METALLIC_ROUGHNESS = 0.33;
/** Bump height of the foil layer (soft mask as bumpMap). */
const LAYER_DEPTH = 0.02;
/** App's dark theme background — scene background stays this flat color;
 *  the HDRI is lighting-only. */
const BACKGROUND = 0x0e0f11;

/** Same-size copy of a canvas with one CSS filter applied during the blit. */
function filteredCopy(canvas: HTMLCanvasElement, filter: string): HTMLCanvasElement {
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext("2d")!;
  ctx.filter = filter;
  ctx.drawImage(canvas, 0, 0);
  return copy;
}

/** Per-pixel lerp of the soft mask into a roughness map: matte 0.8 where the
 *  mask is black (white ink) down to 0.33 where it's white (foil). */
function roughnessCanvas(softMask: HTMLCanvasElement): HTMLCanvasElement {
  const { width, height } = softMask;
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d")!;
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
  private labelHeightRatio = DEFAULTS.heightRatio;
  /** How far the label wraps, as a share of the can's circumference. */
  private labelWidthRatio = DEFAULTS.widthRatio;
  private cornerRadiusPct = DEFAULTS.cornerRadiusPct;
  private edgeSoftnessRatio = DEFAULTS.edgeSoftnessRatio;
  private flatMesh: THREE.Mesh | null = null;
  /** Opaque backing behind the flat plane so orbiting past 90° shows the
   *  label's blank back (foil or matte stock) instead of mirrored art. */
  private flatBackMesh: THREE.Mesh | null = null;
  private shadowMesh: THREE.Mesh | null = null;
  private packGroup: THREE.Group | null = null;

  private canRadius = 0.033;
  private canHeight = SCENE_SCALE;
  /** Azimuth that faces the label front; recomputed per wrap angle. */
  private frontAzimuth = DEFAULT_FRONT_AZIMUTH;
  /** Whether the camera has been aimed at a real (built) label yet. After
   *  that the view belongs to the operator — see frameCamera. */
  private framed = false;

  private mode: CanSceneMode = "can";
  /** Textures applied before the async GLTF load finished — replayed after. */
  private pendingTextures: LabelTextures | null = null;
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
    if (this.pendingTextures) this.applyTextures(this.pendingTextures);
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
    material.map?.dispose();
    material.metalnessMap?.dispose();
    material.roughnessMap?.dispose();
    material.bumpMap?.dispose();
    material.alphaMap?.dispose();
  }

  private disposeLabelMesh() {
    if (!this.labelMesh) return;
    this.scene.remove(this.labelMesh);
    this.labelMesh.geometry.dispose();
    this.labelMesh = null;
  }

  private disposeFlatMesh() {
    if (this.flatBackMesh) {
      // Geometry and alphaMap are shared with flatMesh / the label material,
      // which own their disposal — only the backing's own material is ours.
      this.scene.remove(this.flatBackMesh);
      (this.flatBackMesh.material as THREE.Material).dispose();
      this.flatBackMesh = null;
    }
    if (!this.flatMesh) return;
    this.scene.remove(this.flatMesh);
    this.flatMesh.geometry.dispose();
    this.flatMesh = null;
  }

  /** Blurred copy of the metalness plate — the source for the metalness,
   *  roughness and bump maps (see DEFAULTS for why the blur exists). */
  private softMask(tex: LabelTextures): HTMLCanvasElement {
    const blur = this.edgeSoftnessRatio * tex.metalness.width;
    return filteredCopy(tex.metalness, blur > 0 ? `blur(${blur}px)` : "none");
  }

  /** The die-cut silhouette as an alphaMap source: a white rounded rect on
   *  black, radius as a share of the artwork's short edge. */
  private alphaCanvas(tex: LabelTextures): HTMLCanvasElement {
    const alpha = document.createElement("canvas");
    alpha.width = tex.art.width;
    alpha.height = tex.art.height;
    const ctx = alpha.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, alpha.width, alpha.height);
    const r = (this.cornerRadiusPct / 100) * Math.min(alpha.width, alpha.height);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.roundRect(0, 0, alpha.width, alpha.height, r);
    ctx.fill();
    return alpha;
  }

  /** Adjust the die-cut corner radius (% of the label's short edge), the
   *  label height (% of can height) and the foil-edge blur.
   *
   *  Each knob is a scrub field emitting a change per dragged pixel, so this
   *  redoes only what that knob feeds: the radius is one canvas redraw, the
   *  height is one cylinder, and only the blur touches the three mask-derived
   *  maps. A full applyTextures would re-blur, re-lerp and re-upload five
   *  full-resolution textures per pixel of drag. */
  setLabelOptions(opts: {
    cornerRadiusPct?: number; heightRatio?: number; widthRatio?: number;
    edgeSoftnessRatio?: number;
  }) {
    const radius = opts.cornerRadiusPct !== undefined
      && opts.cornerRadiusPct !== this.cornerRadiusPct;
    // Height and width are one flag: both size the same cylinder.
    const geometry = (opts.heightRatio !== undefined
      && opts.heightRatio !== this.labelHeightRatio)
      || (opts.widthRatio !== undefined && opts.widthRatio !== this.labelWidthRatio);
    const softness = opts.edgeSoftnessRatio !== undefined
      && opts.edgeSoftnessRatio !== this.edgeSoftnessRatio;
    if (opts.cornerRadiusPct !== undefined) this.cornerRadiusPct = opts.cornerRadiusPct;
    if (opts.heightRatio !== undefined) this.labelHeightRatio = opts.heightRatio;
    if (opts.widthRatio !== undefined) this.labelWidthRatio = opts.widthRatio;
    if (opts.edgeSoftnessRatio !== undefined) this.edgeSoftnessRatio = opts.edgeSoftnessRatio;
    if (!(radius || geometry || softness)) return;

    const tex = this.pendingTextures;
    // Only the two texture-derived knobs need artwork; the cylinder no longer
    // does, so a size change before the first build still takes effect.
    if (!tex) { if (geometry && this.labelMesh) { this.rebuildLabelMesh(); this.applyMode(); } return; }
    // No material yet (textures arrived before the can model): the full build
    // is the only thing that can produce one.
    if (!this.labelMaterial) { this.applyTextures(tex); return; }

    if (softness) {
      const soft = this.softMask(tex);
      const m = this.labelMaterial;
      m.metalnessMap?.dispose();
      m.roughnessMap?.dispose();
      m.bumpMap?.dispose();
      m.metalnessMap = this.createTexture(soft);
      m.roughnessMap = this.createTexture(roughnessCanvas(soft));
      m.bumpMap = this.createTexture(soft);
      m.needsUpdate = true;
    }
    if (radius) {
      const map = this.createTexture(this.alphaCanvas(tex));
      const back = this.flatBackMesh?.material as THREE.MeshStandardMaterial | undefined;
      this.labelMaterial.alphaMap?.dispose();
      this.labelMaterial.alphaMap = map;
      this.labelMaterial.needsUpdate = true;
      // The flat view's backing shares the front's die-cut silhouette.
      if (back) { back.alphaMap = map; back.needsUpdate = true; }
    }
    if (geometry) { this.rebuildLabelMesh(); this.applyMode(); }
    this.requestRender();
  }

  /** The wrapped cylinder, sized to the current label height and width.
   *  Separate from applyTextures so a size scrub rebuilds geometry without
   *  touching a single texture — and it needs none, the wrap being an arc of
   *  the circumference rather than something derived from the artwork. */
  private rebuildLabelMesh() {
    const labelHeight = this.canHeight * this.labelHeightRatio;
    const labelRadius = this.canRadius * 1.005;
    // Clamped at MAX_WRAP_RATIO, which the width knob also uses as its
    // maximum — so the field can't offer travel that changes nothing here.
    const wrapAngle = Math.min(this.labelWidthRatio, MAX_WRAP_RATIO) * Math.PI * 2;

    this.disposeLabelMesh();
    this.labelMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(labelRadius, labelRadius, labelHeight, 64, 1, true, 0, wrapAngle),
      this.labelMaterial!,
    );
    this.labelMesh.position.y = this.canHeight * LABEL_OFFSET_RATIO;
    // wrapAngle/2 positions the cylinder's center seam at the back; the
    // camera's front azimuth uses the full wrapAngle to face the label center.
    this.labelMesh.rotation.y = wrapAngle / 2 + LABEL_BASE_ROTATION - LABEL_SEAM_OFFSET;
    this.frontAzimuth = wrapAngle + LABEL_BASE_ROTATION - LABEL_SEAM_OFFSET;
    this.scene.add(this.labelMesh);
    // Caller re-frames: applyTextures does it once after the flat meshes are
    // up, so the 4-pack isn't cloned twice per build.
  }

  applyTextures(tex: LabelTextures) {
    this.pendingTextures = tex;
    if (!this.canModel) return; // replayed by loadCan on arrival

    const soft = this.softMask(tex);
    const oldMaterial = this.labelMaterial;
    this.labelMaterial = new THREE.MeshStandardMaterial({
      transparent: true, side: THREE.DoubleSide, metalness: 1.0, roughness: 1.0,
      map: this.createTexture(tex.art, true),
      metalnessMap: this.createTexture(soft),
      roughnessMap: this.createTexture(roughnessCanvas(soft)),
      bumpMap: this.createTexture(soft),
      bumpScale: LAYER_DEPTH,
      alphaMap: this.createTexture(this.alphaCanvas(tex)),
      alphaTest: 0.5,
    });
    if (oldMaterial) { this.disposeMaterialMaps(oldMaterial); oldMaterial.dispose(); }

    this.rebuildLabelMesh();

    // Flat plane shares the label material; its geometry tracks the aspect.
    this.disposeFlatMesh();
    const flatGeometry = new THREE.PlaneGeometry(
      FLAT_LABEL_HEIGHT * tex.aspect, FLAT_LABEL_HEIGHT,
    );
    this.flatMesh = new THREE.Mesh(flatGeometry, this.labelMaterial);
    this.scene.add(this.flatMesh);

    // Blank back of the stock, facing -z: metallic foil if the label uses any
    // white-ink/metallic mask, otherwise plain white matte. Opaque, so it hides
    // the shared DoubleSide art when the user orbits behind the plane. Shares
    // the front's geometry and die-cut alphaMap; only the material differs.
    const foil = tex.hasFoil;
    this.flatBackMesh = new THREE.Mesh(
      flatGeometry,
      new THREE.MeshStandardMaterial({
        color: foil ? 0xf7f9fb : 0xffffff,
        metalness: foil ? 1.0 : 0.0,
        roughness: foil ? 0.03 : 0.9,
        envMapIntensity: foil ? 3.0 : 1.0,
        transparent: true, alphaTest: 0.5,
        alphaMap: this.labelMaterial.alphaMap,
      }),
    );
    this.flatBackMesh.rotation.y = Math.PI;
    this.flatBackMesh.position.z = -0.0005;
    this.scene.add(this.flatBackMesh);

    this.applyMode(); // rebuild the pack against the new meshes
    // The opening view, once. frontAzimuth only becomes real after the first
    // cylinder exists, so the constructor's guess needs correcting — but only
    // that first time: later art changes must not yank a camera the operator
    // has since moved.
    if (!this.framed) { this.framed = true; this.frameCamera(); }
  }

  /** Switch view. The one gesture that is allowed to move the camera: asking
   *  for a different view IS asking to be shown it from the front. */
  setMode(mode: CanSceneMode) {
    this.mode = mode;
    this.applyMode();
    this.frameCamera();
  }

  /** Show the meshes this mode uses, and rebuild the 4-pack (its clones hold
   *  the label mesh by reference, so a rebuilt cylinder needs new ones).
   *
   *  Deliberately does NOT move the camera. This runs on every geometry
   *  rebuild — each pixel of a size scrub, and every debounced preview
   *  render — and re-aiming there dragged the view back to front-on while
   *  the operator was mid-orbit. Framing is frameCamera's job. */
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
    if (this.flatBackMesh) this.flatBackMesh.visible = mode === "flat";

    if (mode === "pack") this.buildPackGroup();
    this.requestRender();
  }

  /** Aim the camera at the current mode's subject. Called when the operator
   *  asks for a different view — never on a rebuild, so an orbit survives
   *  every size change and every re-render of the art. */
  private frameCamera() {
    this.controls.target.set(0, 0, 0);
    if (this.mode === "pack") {
      this.setCameraSpherical(DEFAULT_ZOOM * FOUR_PACK_ZOOM, FOUR_PACK_TILT, this.frontAzimuth);
    } else if (this.mode === "flat") {
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
    this.disposeLabelMesh();
    this.disposeFlatMesh();
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
