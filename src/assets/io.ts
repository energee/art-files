// assets/io.ts — the editor's asset I/O, split out of App.tsx (#416): reading
// dropped or packed files into slot values (readRaster for the texture/mask
// slots, readCustomImage for an image layer's art), the decode → recolor →
// re-encode pixel pipeline the exports use, and the bytes a Save packs back
// out. Every function is state-free, so an open can decode everything before
// it commits (#81); the React state that holds the results stays in App.tsx.
import type { Fill } from "@/types";
import { bytesPart } from "@/filePickers";
import { EMBEDDABLE_RASTER, mimeFor, rasterKind, tintRgba } from "@/collab";
import { svgAspect } from "@/logo";
import { strToU8 } from "fflate";
import type { LabelAsset, LabelAssets } from "@/labelfile";
import type { CollabImage } from "@/pdf/build";
import type { Rgba } from "@/psd/build";
import { t } from "@/i18n";

/** bytes = full print resolution (exports); previewBytes = downscaled PNG the
 *  assembly effect decodes into a bitmap, so keystroke-driven rebuilds never
 *  churn the print-size image (a burst of those OOMs the tab). `aspect` is
 *  the intrinsic w/h the planner cover-fits the page art by. */
type Loaded = {
  bytes: Uint8Array; previewBytes: Uint8Array; name: string; previewUrl: string; aspect: number;
};

/** A texture or mask slot's value. bytes: what the PDF embeds (PNG or JPEG).
 *  srcBytes: the original upload, under its original name — the bytes Save
 *  writes. */
export type LoadedRaster = Loaded & { kind: "png" | "jpg"; srcBytes: Uint8Array };

/** One loaded per-id image asset: an image layer's art (a collab logo is
 *  one, filling an image layer). `image` is what the renderer needs;
 *  previewUrl is the raw file, so an SVG thumbnails as itself; `aspect` is
 *  the intrinsic w/h the planner sizes the box by before/without a decoded
 *  bitmap. Keyed by the id minted at drop (App.tsx mintCustomAssetId). */
export type CustomFile = { image: CollabImage; name: string; previewUrl: string; aspect: number };

/** Encode a canvas's pixels as PNG bytes — the shared tail of every
 *  decode/recolor/re-encode pipeline in this file. */
async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob(
    (b) => b ? res(b) : rej(new Error(t("Could not encode a {{width}}×{{height}} image as PNG.", { width: canvas.width, height: canvas.height }))),
    "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Decode an image into a fresh 2D canvas at its natural size — the front
 *  half of every pixel pipeline here. The bitmap is always closed. */
async function decodeToCanvas(src: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(src);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0);
    return canvas;
  } finally {
    bmp.close();
  }
}

/** The bytes as a Blob, for decoding (decodeToCanvas, createImageBitmap). */
const blobOf = (bytes: Uint8Array) => new Blob([bytesPart(bytes)]);

/** Repaint a raster image in `fill`, keeping alpha, and re-encode it as PNG
 *  for embedding — the color-overlay path for PNG/JPG art an image layer's
 *  `tintRaster` asks for. Export-only: the preview tints at draw time
 *  (canvas/draw.ts tinted), so a fill drag never re-encodes (#414). */
export async function tintedPng(bytes: Uint8Array, fill: Fill): Promise<Uint8Array> {
  const canvas = await decodeToCanvas(blobOf(bytes));
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  tintRgba(img.data, fill);
  ctx.putImageData(img, 0, 0);
  return canvasToPng(canvas);
}

/** An image's raster bytes as RGBA at NATURAL size — buildPsd resamples
 *  every raster (page texture and mask included) to its placed rect
 *  itself, so nothing is pre-fit here (#88). Export only: a full-res
 *  texture decodes to tens of MB. */
export async function rasterPixelsNatural(bytes: Uint8Array): Promise<Rgba> {
  const canvas = await decodeToCanvas(blobOf(bytes));
  const img = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  return { data: new Uint8Array(img.data.buffer), width: img.width, height: img.height };
}

/** A packed container asset as a typed File — the type matters: FileDrop
 *  thumbnails are createObjectURL(file), and an <img> won't render a
 *  typeless blob as SVG. One spelling for the label-open and master-adopt
 *  paths. */
export function assetToFile(a: LabelAsset): File {
  return new File([bytesPart(a.bytes)], a.name, { type: mimeFor(a.name) });
}

/** A decoder's result: the slot value minus its thumbnail URL. Decoders
 *  mint no URL; the commit does (previewOnce), so a decode that is failed
 *  or discarded leaves nothing to revoke (#85, #432). */
type Decoded<T> = Omit<T, "previewUrl">;

/** A minter for one decoded asset's thumbnail URL (an object URL of `src`,
 *  the file it was read from): returns the value with its previewUrl,
 *  minting on the first call and returning that same value after. Call it
 *  inside the state updater that commits the value: an updater that drops
 *  the value mints nothing, and StrictMode's second run of the updater
 *  reuses the first URL instead of leaking one. React 19 still runs an
 *  updater on an unmounted component, so the caller must not commit once
 *  its tab has closed (DocumentEditor's `alive`). */
export function previewOnce<T extends object>(a: T, src: Blob): () => T & { previewUrl: string } {
  let v: (T & { previewUrl: string }) | undefined;
  return () => v ??= { ...a, previewUrl: URL.createObjectURL(src) };
}

/** Decode a packed container asset with `read` (readRaster or
 *  readCustomImage) into its previewOnce minter: how a label open loads every
 *  asset it carries, and a master's adopt its custom images (its texture and
 *  mask go through onTexture/onMask, the drop path). */
export async function readPacked<T extends object>(
  a: LabelAsset, read: (f: File) => Promise<T>,
): Promise<() => T & { previewUrl: string }> {
  const f = assetToFile(a);
  return previewOnce(await read(f), f);
}

/** Read a dropped image asset. SVG is kept as source text (so it can be
 *  recolored per its layer's style), anything else as raster bytes, plus
 *  the intrinsic aspect (w/h): an SVG's ink box, a raster's bitmap size.
 *  No thumbnail URL: the commit mints it from `f` (previewOnce). */
export async function readCustomImage(f: File): Promise<Decoded<CustomFile>> {
  if (mimeFor(f.name) === "image/svg+xml") {
    const svg = await f.text();
    return { image: { kind: "svg", svg }, name: f.name, aspect: svgAspect(svg) };
  }
  const bytes = new Uint8Array(await f.arrayBuffer());
  const bmp = await createImageBitmap(blobOf(bytes));
  const aspect = bmp.width / bmp.height;
  bmp.close();
  return { image: { kind: rasterKind(f.name), bytes }, name: f.name, aspect };
}

/** Longest preview-texture edge in px. Sized to the 3D label texture
 *  (~2340px) so the mask plate is never upscaled into it. */
const PREVIEW_PX = 2400;

async function previewPng(src: ImageBitmap | HTMLCanvasElement): Promise<Uint8Array> {
  const scale = Math.min(1, PREVIEW_PX / Math.max(src.width, src.height));
  const c = document.createElement("canvas");
  c.width = Math.round(src.width * scale);
  c.height = Math.round(src.height * scale);
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return canvasToPng(c);
}

/** Decode a texture or mask file into its slot value; state-free, like
 *  readCustomImage, so an open can decode before it commits (#81). PNG and
 *  JPEG embed as-is (a mask plate as-authored); anything else the browser
 *  decodes (WebP) gets a PNG copy, because pdf-lib embeds PNG and JPEG only.
 *  Save keeps the original either way. No thumbnail URL, as for
 *  readCustomImage: the commit mints it (previewOnce). */
export async function readRaster(f: File): Promise<Decoded<LoadedRaster>> {
  const passthrough = EMBEDDABLE_RASTER.test(f.name);
  const [srcBytes, decoded] = await Promise.all([
    f.arrayBuffer().then((b) => new Uint8Array(b)),
    passthrough ? createImageBitmap(f) : decodeToCanvas(f),
  ]);
  // Read before the close below: a closed ImageBitmap reports 0×0.
  const aspect = decoded.width / decoded.height;
  let bytes: Uint8Array, previewBytes: Uint8Array;
  try {
    [bytes, previewBytes] = await Promise.all([
      passthrough ? srcBytes : canvasToPng(decoded as HTMLCanvasElement), previewPng(decoded),
    ]);
  } finally {
    if (decoded instanceof ImageBitmap) decoded.close();
  }
  return {
    srcBytes, bytes, previewBytes, aspect, name: f.name,
    kind: passthrough ? rasterKind(f.name) : "png",
  };
}

/** A texture/mask slot as the asset Save packs: the original upload under
 *  its original name. Spelled once for the .label and the .master. */
export const slotAsset = (r: LoadedRaster | null): LabelAsset | undefined =>
  r ? { name: r.name, bytes: r.srcBytes } : undefined;

/** The on-disk bytes for each of `ids` the store holds (an SVG as its source
 *  text), or undefined when none are — what a .label or .master packs as its
 *  customImages. Ids without bytes are skipped. */
export function imageBundle(
  store: Record<string, CustomFile>, ids: Iterable<string>,
): LabelAssets["customImages"] {
  const out: NonNullable<LabelAssets["customImages"]> = {};
  for (const id of ids) {
    const c = store[id];
    if (c) out[id] = { name: c.name, bytes: c.image.kind === "svg" ? strToU8(c.image.svg) : c.image.bytes };
  }
  return Object.keys(out).length ? out : undefined;
}

// Blob snapshots the bytes at construction (no transfer), so no copy needed.
export const blobUrl = (bytes: Uint8Array, type: string) =>
  URL.createObjectURL(new Blob([bytesPart(bytes)], { type }));

/** The plain-download fallback: click a throwaway anchor naming the file. */
export function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}
