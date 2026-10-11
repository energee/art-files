// pdf-build.test.ts — buildArtPdf/buildMaskPdf's page-level behavior over a
// display list (planLayers over the Lolev master, real Poppins metrics):
// the no-mask flood, the page items' plate assignment, the stroke pass on
// the live draw path, raster embedding by asset, and timestamp determinism.
// Inspects the actual PDF content stream pdf-lib emits rather than mocking
// PDFPage.
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { readFileSync } from "node:fs";
import { openFont } from "../src/fontkit";
import { buildArtPdf, buildMaskPdf, pdfMeasureFace } from "../src/pdf/build";
import { warningColumnLen, warningMeasure, wrapWarning } from "../src/warning";
import * as L from "./legacy/layout";
import { ART, PAGE, SHIPPED_BLEED_IN, setBleed } from "../src/layout";
import { assets, contentStreamText, fillOps, lolevPlan, onePxPng, pageRectPath } from "./fixtures";

// Counts /Subtype /Image XObjects in a saved PDF's indirect object table —
// the thing an image whose item is not in the list must NOT contribute.
// Counting XObjects (not grepping raw bytes for a PNG marker) survives
// pdf-lib's own re-compression of the embedded stream. A PNG with alpha
// embeds as TWO (the image plus its SMask), so assertions compare counts
// rather than pin one.
async function countImageXObjects(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  let n = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = (obj as { dict?: { get(name: PDFName): unknown } }).dict;
    if (dict?.get(PDFName.of("Subtype"))?.toString() === "/Image") n++;
  }
  return n;
}

const png = { kind: "png" as const, bytes: onePxPng };
const showOps = (s: string) => (s.match(/\bTj\b/g) ?? []).length;

// The exact operator sequence pdf-lib emits for a full-bleed rect filled
// mask blue — what page.drawRectangle({x:0, y:0, width:PAGE.w, height:PAGE.h,
// color: maskBlue}) produces. Matching the whole path (not just the color)
// distinguishes the page-level flood from the barcode's own mask-blue
// footprint, which is a much smaller rect elsewhere in the same stream.
const floodPath =
  "0.611764705882353 0.8431372549019608 rg\n0 w\n[] 0 d\n" +
  "1 0 0 1 0 0 cm\n1 0 0 1 0 0 cm\n1 0 0 1 0 0 cm\n" + pageRectPath();

/** The label with both page assets bound: the texture under id "tex", the
 *  mask under "msk", each a 1x1 PNG (aspect 1). */
const withPages = () => lolevPlan({
  overrides: { background: { asset: "tex" }, mask: { asset: "msk" } },
  custom: { tex: { aspect: 1 }, msk: { aspect: 1 } },
});

describe("page items — the texture and the mask", () => {
  it("floods the whole mask plate mask-blue when no mask page item has bytes", async () => {
    const bytes = await buildMaskPdf(await lolevPlan(), assets);
    expect(await contentStreamText(bytes)).toContain(floodPath);
    // A mask item whose bytes never loaded is the same case.
    const unloaded = await buildMaskPdf(await withPages(), assets);
    expect(await contentStreamText(unloaded)).toContain(floodPath);
  });

  it("draws the mask instead of flooding when its bytes are supplied", async () => {
    const bytes = await buildMaskPdf(await withPages(), { ...assets, images: { msk: png } });
    expect(await contentStreamText(bytes)).not.toContain(floodPath);
    expect(await countImageXObjects(bytes)).toBeGreaterThan(0);
  });

  it("the art plate embeds the background only, the mask plate the mask only", async () => {
    const items = await withPages();
    const both = { ...assets, images: { tex: png, msk: png } };
    const art = await buildArtPdf(items, both);
    const mask = await buildMaskPdf(items, both);
    const one = await countImageXObjects(await buildArtPdf(items, { ...assets, images: { tex: png } }));
    expect(one).toBeGreaterThan(0);
    expect(await countImageXObjects(art)).toBe(one);
    expect(await countImageXObjects(mask)).toBe(one);
    // The background covers the page: a square asset cover-fits to the
    // page's width, centred, overhanging top and bottom.
    const bg = items.find((r) => r.kind === "page" && r.role === "background")!;
    if (bg.kind !== "page") throw new Error("Expected background page");
    expect(bg.x).toBe(0);
    expect(bg.w).toBeCloseTo(L.PAGE.w, 5);
    expect(bg.h).toBeGreaterThanOrEqual(L.PAGE.h);
    expect(bg.y).toBeCloseTo((L.PAGE.h - bg.h) / 2, 5);
  });

  it("art plate with no background bytes is bare stock: no image XObjects at all", async () => {
    expect(await countImageXObjects(await buildArtPdf(await withPages(), assets))).toBe(0);
  });
});

// The rotated column's Tr-2 stroke technique (bridge copies + a stroke-color
// fill pass, THEN the true fill on top — see strokedText's doc comment), on
// the LIVE draw path: drawItems, not a hand-rolled mocked-page harness.
describe("the rotated column's stroke pass, on the live draw path", () => {
  // Isolate storeCold (a rotated element) by planning only its items, and
  // supply a mask so buildMaskPdf skips its own page-covering flood rect —
  // otherwise that flood's "rg" would land ahead of storeCold's in the
  // stream and confuse the ordering check below.
  const only = async (style: object) => (await lolevPlan({
    overrides: { storeCold: { lines: [{ text: "INK", ...style }], style }, mask: { asset: "msk" } },
    custom: { msk: { aspect: 1 } },
  })).filter((r) => r.id === "storeCold" || r.kind === "page");

  it.each([
    {
      name: "white stroke around metallic fill",
      style: { fill: "#000000", layer: "metallic", stroke: "#000000", strokeLayer: "white", strokeWidth: 15 } as const,
      stroke: [0, 156 / 255, 215 / 255], // maskColor("white") — L.COLORS.maskBlue
      fill: [1, 1, 1], // maskColor("metallic") — knockout white
    },
    {
      name: "metallic stroke around white fill",
      style: { fill: "#000000", layer: "white", stroke: "#000000", strokeLayer: "metallic", strokeWidth: 15 } as const,
      stroke: [1, 1, 1],
      fill: [0, 156 / 255, 215 / 255],
    },
  ])("paints $name in stroke-then-fill order on the mask", async ({ style, stroke, fill }) => {
    const bytes = await buildMaskPdf(await only(style), { ...assets, images: { msk: png } });
    // Drop the first match: buildMaskPdf's page-background rect (always
    // white, unconditionally, before the items ever draw) is not part of
    // storeCold's own draw and isn't the ordering this test is about.
    const ops = fillOps(await contentStreamText(bytes)).slice(1);
    expect(ops.length).toBeGreaterThan(1);
    for (const op of ops.slice(0, -1)) for (const c of [0, 1, 2]) expect(op[c]).toBeCloseTo(stroke[c], 10);
    for (const c of [0, 1, 2]) expect(ops.at(-1)![c]).toBeCloseTo(fill[c], 10);
  });

  it("paints the same stroke-then-fill order on the art plate", async () => {
    const style = { fill: "#111111", layer: "metallic", stroke: "#eeeeee", strokeLayer: "white", strokeWidth: 15 } as const;
    const bytes = await buildArtPdf(await only(style), assets);
    // No page-level background paint in art mode (no texture bytes), so
    // every "rg" here belongs to storeCold's own draw — nothing to drop.
    const ops = fillOps(await contentStreamText(bytes));
    expect(ops.length).toBeGreaterThan(1);
    const stroke = [0xee / 255, 0xee / 255, 0xee / 255];
    const fill = [0x11 / 255, 0x11 / 255, 0x11 / 255];
    for (const op of ops.slice(0, -1)) for (const c of [0, 1, 2]) expect(op[c]).toBeCloseTo(stroke[c], 10);
    for (const c of [0, 1, 2]) expect(ops.at(-1)![c]).toBeCloseTo(fill[c], 10);
  });
});

// The real WARNING_TEXT, wrapped through the real wrapper, with a
// deterministic stand-in font — every resulting column here is multi-word,
// so every one must justify out to exactly maxLen.
describe("warning wrapping invariants", () => {
  const font = { widthOfTextAtSize: (t: string, size: number) => t.length * size * 0.6 };

  it("every real wrapped warning column measures exactly maxLen after justification", () => {
    const measure = warningMeasure((t) => font.widthOfTextAtSize(t, L.WARNING.size));
    const cols = wrapWarning(measure, L.WARNING.maxLen);
    expect(cols.length).toBeGreaterThan(1);
    for (const line of cols) {
      expect(line.includes(" ")).toBe(true); // guards the exactness claim below
      expect(warningColumnLen(line, L.WARNING.maxLen, measure)).toBeCloseTo(L.WARNING.maxLen, 10);
    }
  });
});

// Skipping is the caller's (planLayers' skip / a disabled layer): an item
// absent from the list emits nothing — no ink, no stroke, no mask footprint,
// and no embedded bytes either.
describe("an item absent from the list", () => {
  it("drops its show-text ops from both plates", async () => {
    const all = await lolevPlan();
    const some = all.filter((r) => r.id !== "name" && r.id !== "storeCold");
    expect(showOps(await contentStreamText(await buildArtPdf(some, assets))))
      .toBeLessThan(showOps(await contentStreamText(await buildArtPdf(all, assets))));
    expect(showOps(await contentStreamText(await buildMaskPdf(some, assets))))
      .toBeLessThan(showOps(await contentStreamText(await buildMaskPdf(all, assets))));
  });

  it("does not embed a skipped image's raster bytes into the saved PDF", async () => {
    const images = { left: png };
    const collab = await lolevPlan({
      variants: ["collab"], overrides: { collabLeft: { asset: "left" } }, custom: { left: { aspect: 1 } },
    });
    const visible = await buildArtPdf(collab, { ...assets, images });
    const skipped = await buildArtPdf(collab.filter((r) => r.id !== "collabLeft"), { ...assets, images });
    expect(await countImageXObjects(visible)).toBeGreaterThan(0);
    expect(await countImageXObjects(skipped)).toBe(0);
  });
});

describe("PDF timestamp determinism", () => {
  const PDF_EPOCH = new Date("2000-01-01T00:00:00Z");

  it("builds byte-identical output from the same list twice, on both plates", async () => {
    const items = await lolevPlan();
    expect(await buildArtPdf(items, assets)).toEqual(await buildArtPdf(items, assets));
    expect(await buildMaskPdf(items, assets)).toEqual(await buildMaskPdf(items, assets));
  });

  it("creation dates equal the pinned constant", async () => {
    const items = await lolevPlan();
    for (const bytes of [await buildArtPdf(items, assets), await buildMaskPdf(items, assets)])
      expect((await PDFDocument.load(bytes)).getCreationDate()).toEqual(PDF_EPOCH);
  });
});

describe("printer boxes and provenance", () => {
  it("both plates carry TrimBox = the die inside the bleed, BleedBox = the full page", async () => {
    const items = await lolevPlan();
    for (const bytes of [await buildArtPdf(items, assets), await buildMaskPdf(items, assets)]) {
      const page = (await PDFDocument.load(bytes, { updateMetadata: false })).getPage(0);
      expect(page.getBleedBox()).toEqual({ x: 0, y: 0, width: PAGE.w, height: PAGE.h });
      // Exactly the art box: a re-derived (PAGE.w - TRIM.w) / 2 serializes as
      // 4.560000000000002, which a close-to check would let through.
      expect(page.getTrimBox()).toEqual({ x: ART.x, y: ART.y, width: 576, height: 360 });
    }
  });

  it("the boxes follow the bleed knob: the trim stays 8x5in, centred in the bigger page", async () => {
    setBleed(0.125);
    try {
      const page = (await PDFDocument.load(await buildArtPdf(await lolevPlan(), assets), { updateMetadata: false })).getPage(0);
      expect(page.getBleedBox()).toEqual({ x: 0, y: 0, width: 594, height: 378 });
      expect(page.getTrimBox()).toEqual({ x: 9, y: 9, width: 576, height: 360 });
    } finally { setBleed(SHIPPED_BLEED_IN); }
  });

  it("names Label Lab and its version as the Producer, keeping the pinned dates", async () => {
    const items = await lolevPlan();
    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    for (const bytes of [await buildArtPdf(items, assets), await buildMaskPdf(items, assets)]) {
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      expect(doc.getProducer()).toBe(`Label Lab ${version}`);
      expect(doc.getModificationDate()).toEqual(new Date("2000-01-01T00:00:00Z"));
    }
  });
});

describe("added layers", () => {
  it("an added text layer draws through the shared display list", async () => {
    const plain = await lolevPlan();
    const withLayer = await lolevPlan({ extra: [{
      id: "t1", name: "Custom", kind: "text", enabled: true, x: 30, y: 30, anchor: "left", size: 12,
      align: "left", lines: [{ text: "HELLO", fill: "#000000", layer: "metallic" }],
      style: { fill: "#000000", layer: "metallic" },
    }] });
    expect(showOps(await contentStreamText(await buildArtPdf(withLayer, assets))))
      .toBeGreaterThan(showOps(await contentStreamText(await buildArtPdf(plain, assets))));
  });

  it("an image layer whose bytes never loaded is a no-op on both plates", async () => {
    const plain = await lolevPlan();
    const withImage = await lolevPlan({ custom: { art1: { aspect: 1 } }, extra: [{
      id: "i1", name: "Custom Image", kind: "image", enabled: true, x: 30, y: 30, anchor: "left",
      w: 100, asset: "art1", style: { fill: "none", layer: "white" },
    }] });
    expect(withImage.some((r) => r.kind === "image" && r.id === "i1")).toBe(true); // placed…
    expect(await buildArtPdf(withImage, assets)).toEqual(await buildArtPdf(plain, assets)); // …not drawn
    expect(await buildMaskPdf(withImage, assets)).toEqual(await buildMaskPdf(plain, assets));
  });
});

/** Issue #86: pdf-lib's drawText emits no kerning, so every run must be
 *  planned with the advances it will actually be drawn with. Barlow
 *  Condensed carries a kern table (Poppins has none), so its kerned and
 *  drawn widths diverge: "AVATAR" is 2334/1000 kerned but draws 2535. */
describe("pdfMeasureFace — plans with the widths drawText draws (#86)", () => {
  const font = (f: string) => readFileSync(new URL(`../src/assets/fonts/${f}`, import.meta.url));
  const barlow = {
    regular: font("BarlowCondensed-Regular.ttf"),
    semibold: font("BarlowCondensed-SemiBold.ttf"),
    bold: font("BarlowCondensed-Bold.ttf"),
  };
  const kerned = (bytes: Uint8Array, text: string) => {
    const f = openFont(bytes);
    return f.layout(text).positions.reduce((s, p) => s + p.xAdvance, 0) * 1000 / f.unitsPerEm;
  };

  it("measures Barlow Condensed with its unkerned drawn advances, not kerned ones", async () => {
    const m = await pdfMeasureFace({ poppins: assets.fonts, "barlow-condensed": barlow }, "poppins");
    expect(m("AVATAR", 1000, "regular", "barlow-condensed")).toBeCloseTo(2535);
    expect(m("WAVE TOWER", 1000, "regular", "barlow-condensed")).toBeCloseTo(4475);
    // The kerned width (what canvas measureText returns with kerning on)
    // would place the run ~8% short of the ink the PDF actually lays down.
    expect(kerned(barlow.regular, "AVATAR")).toBeCloseTo(2334);
  });

  it("falls back to the default family for runs without their own", async () => {
    const m = await pdfMeasureFace({ poppins: assets.fonts, "barlow-condensed": barlow }, "barlow-condensed");
    expect(m("AVATAR", 1000, "bold")).toBeCloseTo(2873);
    // Poppins has no kern table: its drawn width equals the kerned one.
    expect(m("AVATAR", 1000, "regular", "poppins")).toBeCloseTo(kerned(assets.fonts.regular, "AVATAR"));
  });
});

// #339: the CMYK converter maps DeviceGray to K without recolouring artwork.
it("uses DeviceGray for neutral vector ink and retains RGB for coloured ink", async () => {
  const items = await lolevPlan({ overrides: {
    name: { style: { fill: "#000000", stroke: "#333333" } },
    qr: { style: { fill: "#ff0000", stroke: "#000000" } },
  } });
  const stream = await contentStreamText(await buildArtPdf(items, assets));
  expect(stream).toMatch(/^0 g$/m);
  expect(stream).toMatch(/^0 G$/m);
  expect(stream).toMatch(/^0.2 g$/m);
  expect(stream).toMatch(/^1 0 0 rg$/m);
  expect(stream).not.toMatch(/^0 0 0 [rR][gG]$/m);
});

it("rejects unsupported print glyphs in the actual family and face (#340)", async () => {
  const m = await pdfMeasureFace({ poppins: assets.fonts }, "poppins");
  for (const face of ["regular", "semibold", "bold"] as const) {
    expect(m("Ale™ ½ é", 10, face)).toBeGreaterThan(0);
    expect(() => m("Ale → 🍺 啤酒", 10, face)).toThrow(/Cannot print .*→.*🍺.*啤.*酒.*Poppins/);
  }
});

it("accepts variation selectors the emoji picker appends (™️ ©️ ®️)", async () => {
  const m = await pdfMeasureFace({ poppins: assets.fonts }, "poppins");
  // U+FE0F folds into the base glyph, so it prints exactly like a plain ™.
  expect(m("Blue Agate™️ ©️ ®︎", 10, "bold")).toBe(m("Blue Agate™ © ®", 10, "bold"));
});
