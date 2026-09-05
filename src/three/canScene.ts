// canScene.ts — vanilla three.js scene for the 3D label preview: a single
// can or a 2x2 4-pack, with a per-pixel metallic-foil effect driven by the
// white-ink mask. Ported (heavily trimmed) from the captiva reference
// implementation's canScene.js — its timeline/export/settings machinery and
// its flat-label view are deliberately absent; only what the two counts
// need survives. Rendering is on-demand: frames are drawn on controls
// change, texture change, or resize, never in a free-running loop.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import type { LabelTextures } from "./labelTextures";
import { DEFAULT_RENDER } from "@/settings";
import {
  ART, LABEL_HEIGHT_RATIO, LABEL_WRAP_RATIO, PAGE, PREVIEW_MAX_W, PREVIEW_OVERSAMPLE, TRIM_UV,
} from "@/layout";

/** How many cans the scene shows: one, or the 2x2 four-pack. */
export type CanSceneMode = "can" | "pack";

// ——— Tuning values, verbatim from captiva (sceneConstants.js + canScene.js) ———
/** Camera azimuth that faces the label front (recomputed per wrap angle). */
const DEFAULT_FRONT_AZIMUTH = 0.867;
const LABEL_BASE_ROTATION = Math.PI * 1.475;
/** Small angular trim to visually center the label seam. */
const LABEL_SEAM_OFFSET = 7 * (Math.PI / 180);
const DEFAULT_ZOOM = 0.275;
/** Reused by cameraBasis and applyDolly so the per-frame pan and dolly paths
 *  allocate nothing. Each is consumed before the method filling it returns. */
const SCRATCH_RIGHT = new THREE.Vector3();
const SCRATCH_UP = new THREE.Vector3();
const SCRATCH_DIR = new THREE.Vector3();
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
/** The Settings knobs' starting values, until CanView pushes the saved ones
 *  in. Read from DEFAULT_RENDER rather than restated here, so the scene, the
 *  inspector and the saved settings cannot ship three different "defaults"; the
 *  /100 is the percent-to-ratio conversion this class works in.
 *
 *  The blur (edgeSoftnessRatio) is a fraction of mask width — it softens the
 *  0->1 metalness step so foil edges don't draw a hard specular outline the
 *  physical print doesn't have. */
const DEFAULTS = {
  cornerRadiusPct: DEFAULT_RENDER.cornerRadius,
  edgeSoftnessRatio: DEFAULT_RENDER.edgeSoftness / 100,
};
/** Per-pixel roughness endpoints: matte white-ink areas vs bare foil. */
const MATTE_ROUGHNESS = 0.8;
const METALLIC_ROUGHNESS = 0.33;
/** Bump height of the foil layer (soft mask as bumpMap). */
const LAYER_DEPTH = 0.02;
// The stage has no scene.background of its own: the renderer clears
// transparent (alpha: true below) and CanView's container paints the flat
// backdrop with the app's own --background token. One definition of the colour
// instead of a copy of the dark hex here, and light/dark/system all follow for
// free — index.css resolves the token with light-dark(), so an OS theme change
// repaints live with no listener and nothing to tell three.js about.
// The HDRI stays lighting-only either way.

/** Ambient fill over the HDRI's image-based light. Low: a cylinder always
 *  turns a band square into the key, and more fill would only flatten it. */
const AMBIENT = 0.4;

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
 * The 3D view of the label — one can, or the 2x2 four-pack. Owns a
 * WebGLRenderer inside `container`;
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
  private cornerRadiusPct = DEFAULTS.cornerRadiusPct;
  private edgeSoftnessRatio = DEFAULTS.edgeSoftnessRatio;
  private shadowMesh: THREE.Mesh | null = null;
  private packGroup: THREE.Group | null = null;

  private canRadius = 0.033;
  private canHeight = SCENE_SCALE;
  /** Azimuth that faces the label front; recomputed per wrap angle. */
  private frontAzimuth = DEFAULT_FRONT_AZIMUTH;
  /** The azimuth the camera was last framed at. The 4-pack lays itself out in
   *  this frame rather than the live frontAzimuth: a width scrub rebuilds the
   *  pack without re-framing, so the fresh angle spun the whole block around a
   *  stationary camera. Only frameCamera moves this. */
  private framedAzimuth = DEFAULT_FRONT_AZIMUTH;
  /** Whether the camera has been aimed at a real (built) label yet. After
   *  that the view belongs to the operator — see frameCamera. */
  private framed = false;

  private mode: CanSceneMode = "can";
  /** Camera distance the current mode frames at — the denominator getZoom
   *  reports against, kept current by setCameraSpherical. */
  private homeRadius = DEFAULT_ZOOM;
  /** How far the label's visible face sits in front of the orbit target — a
   *  can radius, since the label is always wrapped on the can.
   *  Every conversion between camera distance and on-screen label size goes
   *  through it (getZoom, applyDolly, frameSize), because the face is what has
   *  to match the 2D sheet and the target is a radius behind it. Kept current
   *  by setHomeRadius, alongside the distance it belongs to. */
  private surfaceOffset = 0;
  /** Magnification the operator is at, as a multiple of homeRadius. Persisted
   *  rather than derived on the fly because framing redefines homeRadius and
   *  the zoom has to be re-applied against the new one. */
  private zoom = 1;
  /** Pan, as a fraction of the visible frame — persisted for the same reason
   *  as zoom: framing zeroes the target and this has to go back on top. */
  private pan = { x: 0, y: 0 };
  /** True while this class is moving the camera itself — see emitZoom. */
  private syncing = false;
  /** Notified whenever the camera moves, so a host can show the zoom and hand
   *  the view to the 2D pane. Set by CanView; a plain field rather than an
   *  event because there is exactly one listener and it outlives every render.
   *  Pan rides along rather than being read back through getPan(): this fires
   *  once per damped frame, and the listener asking for it again would both
   *  re-measure the camera and read it mid-apply during our own moves — the
   *  thing the syncing guard in emitZoom exists to prevent. */
  onZoomChange?: (zoom: number, pan: { x: number; y: number }) => void;
  /** Textures applied before the async GLTF load finished — replayed after. */
  private pendingTextures: LabelTextures | null = null;
  private disposed = false;

  private renderRequested = false;
  private raf: number | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    this.camera = new THREE.PerspectiveCamera(35, w / h, 0.001, 100);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    // Ratio before size: setPixelRatio re-applies the last setSize, so the
    // other order allocates the framebuffer twice. The floor of 2 supersamples
    // 1x displays (a laptop on an external monitor) where the label's fine type
    // otherwise aliases; the ceiling of 3 keeps a 4x report from allocating a
    // framebuffer well past the point the extra samples show. resize() only
    // calls setSize — three.js keeps the ratio across it.
    this.renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio, 2), 3));
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;
    container.appendChild(this.renderer.domElement);
    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.2;
    // The distance limits are not set here: every framing derives them from
    // the distance it frames at (see setCameraSpherical), and the constructor
    // ends with one — anything put here would be overwritten before first
    // paint, leaving two zoom-range regimes in the file and only one live.
    // On-demand rendering: damping means one input event needs several frames
    // to settle, so each rendered frame re-requests while controls report
    // movement — the chain dies out once update() stops emitting 'change'.
    this.controls.addEventListener("change", () => {
      this.requestRender();
      this.emitZoom();
    });

    this.setupLights();
    this.loadEnvironment();
    void this.loadCan();

    this.camera.position.set(0, 0, DEFAULT_ZOOM);
    // Placeholder framing until the GLTF lands and frameCamera measures the
    // real can; canRadius is still its default here, which is the right offset
    // for the stand-in.
    this.setCameraSpherical(DEFAULT_ZOOM, Math.PI / 2, this.frontAzimuth, this.canRadius);
    this.requestRender();
  }

  // Ambient + warm key + cool fill + white rim, captiva's positions/tints.
  private setupLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, AMBIENT));
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
    // Crop to the trim. The plates are rendered at full page size because
    // that is what goes to the press, but the can wears the label AFTER the
    // die has cut the bleed off — drawing the whole page here wraps 0.127in
    // of artwork around the can that nobody will ever see in their hand.
    // Safe against flipY because the trim is inset equally on all four sides.
    t.offset.set(TRIM_UV.x, TRIM_UV.y);
    t.repeat.set(TRIM_UV.w, TRIM_UV.h);
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
    // Drawn at the TRIM, not the page: the die cuts the trim, and the corners
    // have to land inside the crop createTexture applies or they would be the
    // first thing sliced off, leaving a hard-cornered rectangle. This is also
    // what makes the radius agree with the 2D preview's, which has always
    // measured the knob against the art box.
    const box = {
      x: TRIM_UV.x * alpha.width, y: TRIM_UV.y * alpha.height,
      w: TRIM_UV.w * alpha.width, h: TRIM_UV.h * alpha.height,
    };
    const r = (this.cornerRadiusPct / 100) * Math.min(box.w, box.h);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, r);
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
    cornerRadiusPct?: number;
    edgeSoftnessRatio?: number;
  }) {
    const radius = opts.cornerRadiusPct !== undefined
      && opts.cornerRadiusPct !== this.cornerRadiusPct;
    const softness = opts.edgeSoftnessRatio !== undefined
      && opts.edgeSoftnessRatio !== this.edgeSoftnessRatio;
    if (opts.cornerRadiusPct !== undefined) this.cornerRadiusPct = opts.cornerRadiusPct;
    if (opts.edgeSoftnessRatio !== undefined) this.edgeSoftnessRatio = opts.edgeSoftnessRatio;
    if (!(radius || softness)) return;

    const tex = this.pendingTextures;
    // Both remaining knobs are texture-derived, so there is nothing to redo
    // before the first build — the cylinder's size is no longer a knob.
    if (!tex) return;
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
      this.labelMaterial.alphaMap?.dispose();
      this.labelMaterial.alphaMap = this.createTexture(this.alphaCanvas(tex));
      this.labelMaterial.needsUpdate = true;
    }
    this.requestRender();
  }

  /** The label's height in world units. One accessor rather than the same
   *  product spelled out per reader, because the wrapped cylinder and the
   *  framing distance have to agree on it — that agreement is what keeps
   *  100% meaning the same on-screen label height as the 2D sheet. */
  private labelHeight() {
    return this.canHeight * LABEL_HEIGHT_RATIO;
  }

  /** The wrapped cylinder, sized to the current label height and width.
   *  Separate from applyTextures so a size scrub rebuilds geometry without
   *  touching a single texture — and it needs none, the wrap being an arc of
   *  the circumference rather than something derived from the artwork. */
  private rebuildLabelMesh() {
    const labelRadius = this.canRadius * 1.005;
    // No clamp: the wrap is the trim's width over the can's circumference,
    // which is 97.9% — short of meeting itself by construction, so there is
    // no seam to protect against and nothing for an operator to overshoot.
    const wrapAngle = LABEL_WRAP_RATIO * Math.PI * 2;

    this.disposeLabelMesh();
    this.labelMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(
        labelRadius, labelRadius, this.labelHeight(), 64, 1, true, 0, wrapAngle,
      ),
      this.labelMaterial!,
    );
    this.labelMesh.position.y = this.canHeight * LABEL_OFFSET_RATIO;
    // wrapAngle/2 positions the cylinder's center seam at the back; the
    // camera's front azimuth uses the full wrapAngle to face the label center.
    this.labelMesh.rotation.y = wrapAngle / 2 + LABEL_BASE_ROTATION - LABEL_SEAM_OFFSET;
    this.frontAzimuth = wrapAngle + LABEL_BASE_ROTATION - LABEL_SEAM_OFFSET;
    this.scene.add(this.labelMesh);
    // Caller re-frames: applyTextures does it once, so the 4-pack isn't
    // cloned twice per build.
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

    // The opening view, once. frontAzimuth only becomes real after the first
    // cylinder exists, so the constructor's guess needs correcting — but only
    // that first time: later art changes must not yank a camera the operator
    // has since moved. Ahead of applyMode, which lays the 4-pack out against
    // whatever azimuth the camera ends up framed at.
    if (!this.framed) { this.framed = true; this.frameCamera(); }
    this.applyMode(); // rebuild the pack against the new meshes
  }

  /** Switch between one can and the four-pack. The one gesture that is
   *  allowed to move the camera: asking for a different count IS asking to
   *  be shown it from the front. */
  setMode(mode: CanSceneMode) {
    this.mode = mode;
    // Frame first: applyMode may build the 4-pack, which lays out against the
    // azimuth frameCamera settles on. Zoom and pan survive the switch (framing
    // re-applies both); only the orbit angle goes back to front-on.
    this.frameCamera();
    this.applyMode();
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

    if (mode === "pack") this.buildPackGroup();
    this.requestRender();
  }

  /** Aim the camera at the current mode's subject. Called when the operator
   *  asks for a different view — never on a rebuild, so an orbit survives
   *  every size change and every re-render of the art. */
  private frameCamera() {
    // The whole of framing is our own camera move: the zeroed target and the
    // 1x distance below are scaffolding, not where the operator is, so nothing
    // in here may be read back as their zoom or pan (see emitZoom).
    this.syncing = true;
    this.controls.target.set(0, 0, 0);
    this.framedAzimuth = this.frontAzimuth;
    // Wrapped label: its face is a radius nearer than the axis the camera
    // targets.
    const { radius, offset } = this.homeDistance();
    // The 4-pack is the one view elevated enough to see over its front row;
    // a single can faces the label's own azimuth.
    const phi = this.mode === "pack" ? FOUR_PACK_TILT : Math.PI / 2;
    this.setCameraSpherical(radius, phi, this.frontAzimuth, offset);
    // Framing sets the 1x distance; the operator's zoom is then re-applied on
    // top of it, so switching views keeps the magnification and only the angle
    // goes back to front-on. It also survives the late first framing that
    // happens once the GLTF lands, which is what made a carried-in zoom from
    // the 2D pane snap back to 100%.
    this.applyDolly();
    // …and the pan the same way: frameCamera zeroes the target, so without
    // this a carried-in pan would be wiped by the late first framing.
    this.setPan(this.pan);
    this.syncing = false;
    // Re-framing redefines 1x, so the host's readout has to hear about it even
    // when the camera happened not to move enough for a 'change' event.
    this.emitZoom();
    this.requestRender();
  }

  /** 2x2 block of clones, laid out in the camera's frame (offsets rotated by
   *  framedAzimuth) so one grid axis runs across the screen, one into depth. */
  private buildPackGroup() {
    if (!this.canModel) return;
    const sources = [this.canModel, this.labelMesh, this.shadowMesh]
      .filter((s): s is THREE.Object3D => !!s);
    this.packGroup = new THREE.Group();
    const half = (this.canRadius * FOUR_PACK_SPACING) / 2;
    const a = this.framedAzimuth;
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

  /** Camera distance at which the label reads the same height on screen as the
   *  2D preview's sheet — which is what makes 100% mean one thing across
   *  every view. The 2D sheet is width-driven (it fills the pane up to
   *  PREVIEW_MAX_W and takes its height from the page aspect), so its height is
   *  predictable from the pane this canvas now occupies; the rest is the
   *  perspective camera's own half-angle. The can then runs off the top and
   *  bottom of the frame, which is the point: the label is the subject, the can
   *  is what it happens to be wrapped around.
   *
   *  `surfaceOffset` is how far the label's visible face sits in FRONT of the
   *  camera target — a can radius, since the label is wrapped on the can.
   *  Framing on the axis distance is what a first cut does and it renders the
   *  can's label a few percent tall, since perspective sizes the near face,
   *  not the centre line. */
  private framingDistance(surfaceOffset = 0) {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return DEFAULT_ZOOM; // pre-layout; setMode reframes later
    const sheetHeight = Math.min(w, PREVIEW_MAX_W) * (PAGE.h / PAGE.w);
    const toSurface = this.labelHeight()
      / (2 * (sheetHeight / h) * Math.tan((this.camera.fov * Math.PI) / 360));
    return toSurface + surfaceOffset;
  }

  /** The distance this mode frames at — 1x, what getZoom reports against and
   *  what applyDolly measures from. Depends on the pane's size through
   *  framingDistance, so it is recomputed on every framing AND on every
   *  resize; anything that changes the pane changes what 100% means, and the
   *  two paths read it from here so they cannot answer differently. */
  private homeDistance() {
    // `offset` is how far the label's visible face sits in FRONT of the orbit
    // target, returned alongside the distance because every conversion between
    // camera distance and on-screen label size needs it — not just the initial
    // framing. Measured with it dropped: a pan overshot the 2D pane by 15% at
    // 100% and 35% at 200%, and a 250% zoom landed at 291%. The wrapped
    // label's face is one can-radius nearer than the axis the camera targets.
    // The 4-pack is the one view that can't hold label parity: four cans at
    // that size overflow the frame, so it keeps its composed pull-back off the
    // same base — the label tracks the others, just smaller by a fixed factor.
    const base = this.framingDistance(this.canRadius);
    return {
      radius: this.mode === "pack" ? base * FOUR_PACK_ZOOM : base,
      offset: this.canRadius,
    };
  }

  /** Dolly to a given multiple of the framing distance (see getZoom), keeping
   *  the orbit. Clamped to OrbitControls' distance limits so a typed-in number
   *  can't put the camera somewhere the wheel could never reach. */
  setZoom(zoom: number) {
    this.zoom = zoom;
    this.syncing = true;
    this.applyDolly();
    this.syncing = false;
    this.emitZoom();
    this.requestRender();
  }

  /** Put the camera at the distance this.zoom asks for, along whatever
   *  direction it currently sits. Clamped to OrbitControls' limits so a
   *  typed-in number can't land somewhere the wheel could never reach. */
  private applyDolly() {
    // The exact inverse of getZoom, so a number set here reads back unchanged.
    const o = this.surfaceOffset;
    const radius = Math.min(
      this.controls.maxDistance,
      Math.max(
        this.controls.minDistance,
        o + (this.homeRadius - o) / Math.max(this.zoom, 0.01),
      ),
    );
    const dir = SCRATCH_DIR.copy(this.camera.position)
      .sub(this.controls.target).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, radius);
    this.controls.update();
  }

  /** Zoom as a multiple of the mode's framing distance, so 1 means "as framed"
   *  and 2 means "twice as close" — the same thing the 2D pane's percentage
   *  means, rather than a raw camera distance in scene units. How far it can
   *  travel follows from OrbitControls' min/max distance and so differs per
   *  count: the four-pack frames further back than one can. Internal: the host
   *  hears the number through onZoomChange rather than asking for it, so that
   *  every reader sees the same value from the same moment. */
  private getZoom() {
    // Measured from the label's face, not the orbit target: the face is what
    // has to read the same size as the 2D sheet, and it sits surfaceOffset
    // nearer the camera. Dividing raw distances instead reported 250% for a
    // label drawn at 291%.
    const o = this.surfaceOffset;
    return (this.homeRadius - o) / (this.controls.getDistance() - o);
  }

  /** Pan as a fraction of the visible frame at the target — the 2D pane's own
   *  unit, so the two views can hand it back and forth. x right, y down.
   *  Internal for the reason onZoomChange's comment gives: a host reading it
   *  back would re-measure the camera mid-apply during our own moves. */
  private getPan() {
    const { w, h } = this.frameSize();
    const { right, up } = this.cameraBasis();
    return {
      x: this.controls.target.dot(right) / w,
      y: -this.controls.target.dot(up) / h,
    };
  }

  /** Move the target to that fraction of the frame, carrying the camera with
   *  it so the orbit and the dolly are untouched. */
  setPan(pan: { x: number; y: number }) {
    this.pan = pan;
    // Save/restore rather than clear: frameCamera and resize call this from
    // inside their own syncing window, and hard-clearing here left them
    // relying on this being their last camera move — reorder one line and the
    // guard opens mid-framing, which is exactly what it exists to prevent.
    const wasSyncing = this.syncing;
    this.syncing = true;
    const { w, h } = this.frameSize();
    const { right, up } = this.cameraBasis();
    const delta = right.multiplyScalar(pan.x * w)
      .addScaledVector(up, -pan.y * h)
      .sub(this.controls.target);
    this.controls.target.add(delta);
    this.camera.position.add(delta);
    this.controls.update();
    this.syncing = wasSyncing;
    this.requestRender();
  }

  /** The camera's screen-right and screen-up axes in world space — the basis
   *  getPan measures the target against and setPan moves it along, so the two
   *  can't disagree about which way "right" is. Returns the shared scratch
   *  vectors: this runs once per damped frame, and both callers consume them
   *  before returning. */
  private cameraBasis() {
    return {
      right: SCRATCH_RIGHT.setFromMatrixColumn(this.camera.matrixWorld, 0),
      up: SCRATCH_UP.setFromMatrixColumn(this.camera.matrixWorld, 1),
    };
  }

  /** World-space size of what the camera sees AT THE LABEL'S FACE — the plane
   *  the 2D pane's own frame corresponds to. Measured at the orbit target
   *  instead, the frame comes out surfaceOffset too deep and therefore too
   *  wide, and every pan expressed as a fraction of it overshoots: 15% at
   *  100%, 35% at 200%, in the same direction at every zoom. */
  private frameSize() {
    const d = this.controls.getDistance() - this.surfaceOffset;
    const h = 2 * d * Math.tan((this.camera.fov * Math.PI) / 360);
    return { w: h * this.camera.aspect, h };
  }

  private emitZoom() {
    // Where the fields catch up with the camera, so a wheel or pinch (which
    // moves the camera directly) is recorded the same as a programmatic
    // setZoom — but NOT while we are the ones moving it. Our own moves fire
    // 'change' too, and reading the camera back mid-apply meant a carried-in
    // zoom set against a not-yet-framed camera measured as 1x and overwrote
    // the very intent it was applying: the can looked right and the readout
    // said 100%, and that 100% was what got carried back out.
    // Measured once: this runs per damped frame of every gesture, and the
    // camera cannot move between two reads inside one event.
    const z = this.getZoom();
    if (!this.syncing) {
      this.zoom = z;
      this.pan = this.getPan();
    }
    this.onZoomChange?.(z, this.pan);
  }

  /** Record what "as framed" now means — what getZoom measures from — and move
   *  the distance limits with it. Kept apart from the camera
   *  move below because a resize redefines 1x without touching the orbit. */
  private setHomeRadius(radius: number, offset: number) {
    this.homeRadius = radius;
    this.surfaceOffset = offset;
    // Framing distance is also the floor on zoom: pulling back past it would
    // show under 100%, which the 2D pane doesn't allow either — both views
    // treat "as framed" as fully zoomed out. The near limit matches the pane's
    // ceiling for the same reason, so a zoom carried between them is never
    // silently clipped on the way in. Both go through the same offset the
    // dolly does, or the limit would bite at a different number than it names.
    this.controls.maxDistance = radius;
    this.controls.minDistance = offset + (radius - offset) / PREVIEW_OVERSAMPLE;
  }

  private setCameraSpherical(
    radius: number, phi: number, azimuth: number, offset: number,
  ) {
    this.setHomeRadius(radius, offset);
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
    // A resize redefines 1x: framing is driven by the pane's width (see
    // framingDistance), so leaving homeRadius alone would let 100% drift away
    // from the 2D pane's 100% every time the window or a side panel moves.
    // Only the distance is recomputed — the orbit is the operator's work, so
    // this re-applies their zoom and pan on top rather than re-framing, which
    // would spin the can back to front-on for a drag of the panel divider.
    this.syncing = true;
    const { radius, offset } = this.homeDistance();
    this.setHomeRadius(radius, offset);
    this.applyDolly();
    this.setPan(this.pan);
    this.syncing = false;
    this.emitZoom();
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
