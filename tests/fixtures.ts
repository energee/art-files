// fixtures.ts — shared test scaffolding: the real font/logo assets a PDF
// build needs, the content-stream decoder used to assert on emitted
// operators, and the deterministic measure stand-ins the geometry tests use
// instead of real font metrics. Lives here so pdf-build, hittest and
// tracking assert against the SAME fixtures — three copies of the decoder
// would have to be edited together every time pdf-lib's stream shape moves.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, decodePDFRawStream } from "pdf-lib";
import type { Layer } from "ag-psd";
import type { Assets } from "../src/pdf/build";
import type { PsdAssets } from "../src/psd/build";

const asset = (p: string) => join(__dirname, "..", "src", "assets", p);

/** Real fonts + logo SVG, loaded from disk the way scripts/generate.ts does. */
export const assets: Assets = {
  fonts: {
    regular: readFileSync(asset("fonts/Poppins-Regular.ttf")),
    semibold: readFileSync(asset("fonts/Poppins-SemiBold.ttf")),
    bold: readFileSync(asset("fonts/Poppins-Bold.ttf")),
  },
  logoSvg: readFileSync(asset("logo2025.svg"), "utf8"),
  // Custom image assets for tests: aspect ratios only. Deliberately no
  // `customImages` bytes here — the shared byte-identity-lock tests
  // (pdf-build.test.ts, canvas-draw.test.ts) rely on this fixture having NO
  // bytes for "art1" so a custom image layer with no asset loaded still
  // builds byte-identical output; a test that needs real bytes supplies its
  // own `customImages` entry locally instead of mutating this one.
  custom: {
    art1: { aspect: 1 },
  },
};

/** The same assets, narrowed to what the PSD builder takes (it embeds the
 *  fonts and the logo itself, and has no use for the PDF-only fields). */
export const psdAssets: PsdAssets = { fonts: assets.fonts, logoSvg: assets.logoSvg };

/** Every layer in a read PSD, groups flattened, so a test can look one up by
 *  name without walking the group tree itself. */
export const flatLayers = (children: Layer[] = []): Layer[] =>
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
 *  the renderer actually paints with (plan.ts's lineRuns/rotatedRuns pick
 *  semibold vs regular by bold, which changes glyph widths in the real font). */
export const measureBW = (text: string, size: number, bold: boolean) =>
  text.length * size * (bold ? 0.7 : 0.55);
