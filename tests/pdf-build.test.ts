// pdf-build.test.ts — buildMaskPdf's page-level behavior that drawBarcode's
// mocked-page harness (tests/barcode.test.ts) can't reach: buildMaskPdf is
// async and needs real Assets (fonts, logo SVG), so this loads them from
// disk like scripts/generate.ts does and inspects the actual PDF content
// stream pdf-lib emits, rather than mocking PDFPage.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PDFFont, PDFPage } from "pdf-lib";
import { PDFDocument, decodePDFRawStream } from "pdf-lib";
import { buildMaskPdf, drawJustifiedRotated, warningColumnLen, wrapWarning, type Assets } from "../src/pdf/build";
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

// Justified warning columns: every column's inter-word spacing stretches to
// fill L.WARNING.maxLen exactly, so there's no ragged final column. This
// exercises drawJustifiedRotated directly with a mocked page (deterministic
// varying word widths, unlike drawBarcode's tests which only need a
// constant), then reconstructs the drawn run's total length from the
// recorded per-word y positions the way the coordinate math in
// drawJustifiedRotated's doc comment describes: the run advances from
// yStart toward smaller yStart, so PDF-space y increases word to word, and
// the whole run's length is (last word's y - first word's y) + last word's
// width.
describe("drawJustifiedRotated", () => {
  const font = {
    widthOfTextAtSize: (t: string, size: number) => t.length * size * 0.6,
  } as unknown as PDFFont;
  const style = { fill: "#000000" as const, layer: "white" as const };

  function drawnWordPositions(text: string, maxLen: number) {
    const texts: { txt: string; y: number }[] = [];
    const page = {
      drawText: (txt: string, o: { y: number }) => texts.push({ txt, y: o.y }),
    } as unknown as PDFPage;
    drawJustifiedRotated(page, font, text, "art", style, {
      x: 100, yStart: 200, size: 6, maxLen,
    });
    return texts;
  }

  it("stretches a multi-word column to exactly maxLen", () => {
    const maxLen = 150;
    const texts = drawnWordPositions("THE QUICK FOX", maxLen);
    expect(texts).toHaveLength(3);
    const lastWidth = font.widthOfTextAtSize("FOX", 6);
    const runLen = texts[texts.length - 1].y - texts[0].y + lastWidth;
    expect(runLen).toBeCloseTo(maxLen, 10);
  });

  it("does not letter-space a single-word column to fill maxLen", () => {
    const maxLen = 150;
    const texts = drawnWordPositions("SUPERCALIFRAGILISTIC", maxLen);
    expect(texts).toHaveLength(1);
    const natural = font.widthOfTextAtSize("SUPERCALIFRAGILISTIC", 6);
    expect(natural).toBeLessThan(maxLen); // otherwise this case proves nothing
    expect(warningColumnLen("SUPERCALIFRAGILISTIC", maxLen, (t) => font.widthOfTextAtSize(t, 6))).toBeCloseTo(natural, 10);
  });

  // The real WARNING_TEXT, wrapped through the real wrapper, with THIS
  // test's font — every resulting column here is multi-word, so every one
  // must justify out to exactly maxLen.
  it("every real wrapped warning column measures exactly maxLen after justification", () => {
    const measure = (t: string) => font.widthOfTextAtSize(t, L.WARNING.size);
    const cols = wrapWarning(measure, L.WARNING.maxLen);
    expect(cols.length).toBeGreaterThan(1);
    for (const line of cols) {
      expect(line.includes(" ")).toBe(true); // guards the exactness claim below
      expect(warningColumnLen(line, L.WARNING.maxLen, measure)).toBeCloseTo(L.WARNING.maxLen, 10);
    }
  });
});
