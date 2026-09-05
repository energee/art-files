// fixtures.ts — shared test scaffolding: the real font assets a PDF/PSD build
// needs, the Lolev master planned into the display list every backend takes
// (values filled through resolveLayers, measured with the real Poppins
// metrics via pdf-lib), the content-stream decoder used to assert on emitted
// operators, and the deterministic measure stand-ins the geometry tests use
// instead of real font metrics. Lives here so pdf-build, psd-build, canvas
// and the goldens assert against the SAME fixtures.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, decodePDFRawStream } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Layer as PsdLayer } from "ag-psd";
import type { Assets } from "../src/pdf/build";
import type { PsdAssets } from "../src/psd/build";
import type { MeasureFace, PlanAssets } from "../src/plan";
import { layerBoxes, planLayers, type PlacedLayer } from "../src/planLayers";
import { hitBoxesFromLayout, type LayerBox } from "../src/hittestLayers";
import { lolevMaster } from "../src/model/lolevLayers";
import { resolveLayers } from "../src/model/resolveLayers";
import type { Layer, LayerValue, Master } from "../src/model/layers";
import { convertConfigV1 } from "../src/model/convert";
import type { LabelConfig } from "../src/types";
import type { DeepPartial } from "../src/model/merge";

const asset = (p: string) => join(import.meta.dirname ?? __dirname, "..", "src", "assets", p);

/** Raw contents of logo2025.svg — what planLayers draws `builtin:logo` from. */
export const logoSvg = readFileSync(asset("logo2025.svg"), "utf8");

/** Real fonts, loaded from disk the way scripts/generate.ts does. No image
 *  bytes: a build with no `images` is the bare-stock / white-ink-flood case
 *  the byte-locked goldens pin; a test that needs bytes supplies its own.
 *  `logoSvg` rides along for the plan-side suites that read it from here. */
export const assets: Assets & { logoSvg: string } = {
  fonts: {
    regular: readFileSync(asset("fonts/Poppins-Regular.ttf")),
    semibold: readFileSync(asset("fonts/Poppins-SemiBold.ttf")),
    bold: readFileSync(asset("fonts/Poppins-Bold.ttf")),
  },
  logoSvg,
};

/** The same fonts, in the shape the PSD builder takes. */
export const psdAssets: PsdAssets = { fonts: assets.fonts };

/** A minimal embeddable 1x1 PNG — for any test that needs raster bytes to
 *  exist without caring what they depict. */
export const onePxPng = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
));

let pdfMeasurePromise: Promise<MeasureFace> | null = null;
/** The PDF backend's own metrics: pdf-lib's embedded Poppins widths, the
 *  measure App hands planLayers when it builds for export. Embedded once. */
export function pdfMeasure(): Promise<MeasureFace> {
  return (pdfMeasurePromise ??= (async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const fonts = {
      regular: await doc.embedFont(assets.fonts.regular),
      semibold: await doc.embedFont(assets.fonts.semibold),
      bold: await doc.embedFont(assets.fonts.bold),
    };
    return (t, size, face) => fonts[face].widthOfTextAtSize(t, size);
  })());
}

export interface LolevOpts {
  /** Variants to enable (e.g. ["collab"]). */
  variants?: string[];
  /** Values into fillable layers, by layer id. */
  values?: Record<string, LayerValue>;
  /** Label-level overrides by layer id (also how a test sets the page
   *  assets: `{ background: { asset: "tex" } }`). */
  overrides?: Record<string, DeepPartial<Layer>>;
  /** Extra layers appended after the master's (a variant-added layer stands
   *  in through `variants`; this is for ad-hoc test layers). */
  extra?: Layer[];
  /** Asset descriptors planLayers needs (aspect, decoded SVG art). */
  custom?: PlanAssets["custom"];
  /** A master other than the shipped Lolev one. */
  master?: Master;
}

/** The Lolev master's RESOLVED layers for a label. */
export function lolevLayers(opts: LolevOpts = {}): Layer[] {
  const r = resolveLayers(opts.master ?? lolevMaster(), opts.variants ?? [], opts.values ?? {}, opts.overrides);
  return [...r.layers, ...(opts.extra ?? [])];
}

/** The Lolev label's display list, measured with the real Poppins metrics —
 *  what App / generate.ts hand every backend. */
export async function lolevPlan(opts: LolevOpts = {}): Promise<PlacedLayer[]> {
  return planLayers(lolevLayers(opts), await pdfMeasure(), { logoSvg, custom: opts.custom });
}

/** Every layer in a read PSD, groups flattened, so a test can look one up by
 *  name without walking the group tree itself. */
export const flatLayers = (children: PsdLayer[] = []): PsdLayer[] =>
  children.flatMap((l) => [l, ...flatLayers(l.children)]);

/** Decode a built PDF's page-1 content stream(s) back to their operator
 *  text, so tests can look for the exact operators a builder emits without
 *  re-parsing geometry from pixels. */
export async function contentStreamText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  const refs = (contents as { array?: unknown[] }).array ?? [contents];
  let out = "";
  for (const ref of refs) {
    const stream = doc.context.lookup(ref as never);
    out += new TextDecoder().decode(decodePDFRawStream(stream as never).decode());
  }
  return out;
}

/** Deterministic stand-in for real font metrics. */
export const measure = (text: string, size: number) => text.length * size * 0.55;

/** Bold-sensitive stand-in, for asserting boxes measure with the same weight
 *  the renderer actually paints with (semibold vs regular by bold, which
 *  changes glyph widths in the real font). */
export const measureBW = (text: string, size: number, bold: boolean) =>
  text.length * size * (bold ? 0.7 : 0.55);

/** Plan legacy config regression fixtures through the production converter. */
export function configLayers(cfg: LabelConfig): Layer[] {
  const { label } = convertConfigV1(cfg, false);
  return resolveLayers(lolevMaster(), label.enabledVariants, label.values, label.overrides).layers;
}

export async function configPlan(cfg: LabelConfig): Promise<PlacedLayer[]> {
  return planLayers(configLayers(cfg), await pdfMeasure(), { logoSvg });
}

/** Test-side convenience: the hit box of one layer from a fresh layout. */
export function boxOfLayer(id: string, layers: Layer[], m: MeasureFace, assets: PlanAssets): LayerBox | null {
  return hitBoxesFromLayout(layers, layerBoxes(layers, m, assets)).find((b) => b.id === id) ?? null;
}
