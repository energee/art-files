// multiEdit.ts — which selected layers an inspector change reaches. With
// several layers selected the inspector shows the last-picked one (the
// "edited" layer) and every change it makes also goes to each other selected
// layer that HAS the control the change came from: power to all, lock,
// Position and Style to every layer that shows them, a kind's own settings
// (Typography, Image, Barcode, QR) to layers of that kind. Names and bindings
// belong to one layer and never fan out. Pure, so the rule is tested without
// a DOM (tests/multi-edit.test.ts); App.tsx feeds the result to patchLayers.
import { bindingOf, type Layer } from "./layers";
import { deepEqual, getPath } from "./merge";
import type { LayerPatch } from "./editRecords";

/** Another selected layer. `raster` marks an image layer holding PNG/JPEG
 *  art: it has no plate toggle, and is the only image with Tint raster. */
export interface Peer { layer: Layer; raster?: boolean }

/** The texture and the metallic mask: no Position, Style or lock. */
export const isPage = (l: Layer) => l.kind === "image" && (l.role === "background" || l.role === "mask");
const sideBound = (l: Layer) => {
  const side = bindingOf(l)?.side;
  return side === "left" || side === "right";
};
// The same rules Position uses to show X and Y (LayerInspectorSections.tsx):
// a binding owns one axis, so that axis has no field to type into.
const hasX = ({ layer }: Peer) => !isPage(layer) && !sideBound(layer);
const hasY = ({ layer }: Peer) =>
  !isPage(layer) && typeof layer.y === "number" && (!bindingOf(layer) || sideBound(layer));

/** Patch keys whose control is on every kind's sheet, and whether `other`
 *  shows it. A key not listed here belongs to the edited layer's kind. */
const COMMON: Record<string, (other: Peer) => boolean> = {
  enabled: () => true,
  locked: ({ layer }) => !isPage(layer),
  x: hasX, guideX: hasX, anchor: hasX,
  y: hasY, guideY: hasY, vAnchor: hasY,
  // No backend rotates an image.
  rotation: ({ layer }) => !isPage(layer) && layer.kind !== "image",
  style: ({ layer }) => !isPage(layer),
};
const ONE_LAYER_ONLY = new Set(["name", "binding"]);

/** The part of `patch` (an edit to `primary`) that `other` takes too. */
function sharedPart(primary: Layer, other: Peer, patch: LayerPatch): LayerPatch {
  const { layer } = other;
  const isCode = layer.kind === "barcode" || layer.kind === "qr";
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (ONE_LAYER_ONLY.has(key)) continue;
    // A non-numeric y is a legacy "below" binding, so it is one layer's too.
    if (key === "y" && value !== undefined && typeof value !== "number") continue;
    const shows = COMMON[key] ?? (() =>
      layer.kind === primary.kind && !isPage(layer) && (key !== "tintRaster" || !!other.raster));
    if (!shows(other)) continue;
    if (key !== "style") { out[key] = value; continue; }
    // Raster art has no plate toggle, and a code with no ink cannot scan.
    const style = Object.entries(value as object).filter(([k, v]) =>
      !(k === "layer" && other.raster) && !(k === "fill" && v === "none" && isCode));
    if (style.length) out.style = Object.fromEntries(style);
  }
  return out as LayerPatch;
}

/** One inspector change as patchLayers entries: the whole `patch` for the
 *  edited layer, then each other selected layer's share of it. */
export function sharedPatch(primary: Layer, others: readonly Peer[], patch: LayerPatch): [string, LayerPatch][] {
  return [[primary.id, patch], ...others.flatMap((other): [string, LayerPatch][] => {
    const part = sharedPart(primary, other, patch);
    return Object.keys(part).length ? [[other.layer.id, part]] : [];
  })];
}

/** `layer`'s values at dotted `paths` ("style.fill") as a patch that sets
 *  them. A missing nested value is null and a missing top-level one
 *  undefined: the two spellings of "unset" the label override accepts
 *  (setLabelOverride, applyDiff). */
export function pickPaths(layer: Layer, paths: readonly string[]): LayerPatch {
  const out: Record<string, unknown> = {};
  for (const path of paths) {
    const keys = path.split(".");
    const leaf = keys.pop()!;
    const at = keys.reduce((o, k) => (o[k] ??= {}) as Record<string, unknown>, out);
    at[leaf] = getPath(layer, path) ?? (keys.length ? null : undefined);
  }
  return out as LayerPatch;
}

const hasPath = (obj: unknown, path: string) =>
  path.split(".").every((k) => {
    const found = !!obj && typeof obj === "object" && k in obj;
    obj = found ? (obj as Record<string, unknown>)[k] : undefined;
    return found;
  });

/** Whether the control that writes `path` on `primary` also exists on `other`. */
export const sharesPath = (primary: Layer, other: Peer, path: string): boolean =>
  hasPath(sharedPart(primary, other, pickPaths(primary, [path])), path);

/** True when a selected layer that shares the control writing `paths` holds a
 *  different value there than `primary`, the one the inspector shows. */
export const isMixed = (primary: Layer, others: readonly Peer[], paths: readonly string[]): boolean =>
  others.some((other) => paths.some((path) =>
    sharesPath(primary, other, path) && !deepEqual(getPath(other.layer, path), getPath(primary, path))));
