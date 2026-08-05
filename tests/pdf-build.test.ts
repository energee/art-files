// pdf-build.test.ts — buildMaskPdf's page-level behavior that drawBarcode's
// mocked-page harness (tests/barcode.test.ts) can't reach: buildMaskPdf is
// async and needs real Assets (fonts, logo SVG), so this loads them from
// disk like scripts/generate.ts does and inspects the actual PDF content
// stream pdf-lib emits, rather than mocking PDFPage.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, decodePDFRawStream } from "pdf-lib";
import { buildMaskPdf, type Assets } from "../src/pdf/build";
import { defaultConfig } from "../src/defaults";
import * as L from "../src/layout";

const asset = (p: string) => join(__dirname, "..", "src", "assets", p);
const assets: Assets = {
  fonts: {
    regular: readFileSync(asset("fonts/Poppins-Regular.ttf")),
    semibold: readFileSync(asset("fonts/Poppins-SemiBold.ttf")),
    bold: readFileSync(asset("fonts/Poppins-Bold.ttf")),
  },
  logoSvg: readFileSync(asset("logo2025.svg"), "utf8"),
};

/** Decode a built PDF's page-1 content stream(s) back to their operator
 *  text, so tests can look for the exact fill operators buildMaskPdf emits
 *  without re-parsing geometry from pixels. */
async function contentStreamText(bytes: Uint8Array): Promise<string> {
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

// The exact operator sequence pdf-lib emits for a full-bleed rect filled
// mask blue — what page.drawRectangle({x:0, y:0, width:PAGE.w, height:PAGE.h,
// color: maskBlue}) produces. Matching the whole path (not just the color)
// distinguishes the page-level flood from the barcode's own mask-blue
// footprint, which is a much smaller rect elsewhere in the same stream.
const floodPath =
  "0.611764705882353 0.8431372549019608 rg\n0 w\n[] 0 d\n" +
  "1 0 0 1 0 0 cm\n1 0 0 1 0 0 cm\n1 0 0 1 0 0 cm\n" +
  `0 0 m\n0 ${L.PAGE.h} l\n${L.PAGE.w} ${L.PAGE.h} l\n${L.PAGE.w} 0 l\nh\nf`;

describe("buildMaskPdf — no-mask flood", () => {
  it("floods the whole plate mask-blue when no maskPng is supplied", async () => {
    const bytes = await buildMaskPdf(defaultConfig(), assets);
    expect(await contentStreamText(bytes)).toContain(floodPath);
  });

  it("does not flood when a maskPng is supplied", async () => {
    // Minimal 1x1 PNG — buildMaskPdf only needs it to be embeddable.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const bytes = await buildMaskPdf(defaultConfig(), { ...assets, maskPng: png });
    expect(await contentStreamText(bytes)).not.toContain(floodPath);
  });
});
