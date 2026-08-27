// pdf-build.test.ts — buildMaskPdf's page-level behavior that drawBarcode's
// mocked-page harness (tests/barcode.test.ts) can't reach: buildMaskPdf is
// async and needs real Assets (fonts, logo SVG), so this loads them from
// disk like scripts/generate.ts does and inspects the actual PDF content
// stream pdf-lib emits, rather than mocking PDFPage.
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { buildArtPdf, buildMaskPdf, type CollabImage } from "../src/pdf/build";
import { warningColumnLen, warningMeasure, wrapWarning } from "../src/warning";
import { defaultConfig } from "../src/defaults";
import type { ElementId } from "../src/elements";
import * as L from "../src/layout";
import { assets, contentStreamText } from "./fixtures";

// Counts /Subtype /Image XObjects in a saved PDF's indirect object table —
// the thing a hidden collab logo must NOT contribute, even though planLabel
// already omits its drawn item. Counting XObjects (not grepping raw bytes
// for a JPEG/PNG marker) survives pdf-lib's own re-compression of the
// embedded stream.
async function countImageXObjects(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  let n = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = (obj as { dict?: { get(name: PDFName): unknown } }).dict;
    if (dict?.get(PDFName.of("Subtype"))?.toString() === "/Image") n++;
  }
  return n;
}

// Every text/image ElementId except one, so a test can hide the whole label
// down to a single element and read its operators without the rest of the
// page's ink interfering.
const allBut = (id: ElementId): Set<ElementId> =>
  new Set<ElementId>([
    "name", "styleLine", "abv", "description", "volume", "wordmark", "logo",
    "handleAddress", "warning", "storeCold", "qr", "barcode",
    "collabLead", "collabLeft", "collabCenter",
  ].filter((x) => x !== id) as ElementId[]);

// A minimal embeddable 1x1 PNG, standing in for an uploaded mask — buildMaskPdf
// only needs it to be embeddable, and using it here skips the page-covering
// no-mask flood rect so its "rg" doesn't show up in the isolated element's
// operator sequence below.
const onePxPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

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

// The rotated column's Tr-2 stroke technique (bridge copies + a stroke-color
// fill pass, THEN the true fill on top — see strokedText's doc comment), on
// the LIVE draw path: drawElements' plan-driven drawPlaced, not a
// hand-rolled mocked-page harness. The multi-word maxLen-justification math
// itself (what the old drawJustifiedRotated/drawRotated duo also computed)
// is covered directly at the placement layer by tests/plan.test.ts's
// "justifiedRotatedRuns" describe block (both the multi-word exact-maxLen
// case and the single-word natural-length case) — this block only needs to
// guard the part plan.ts does NOT touch: the actual paint order and the
// mask's per-layer color resolution once pdf-lib draws it.
describe("the rotated column's stroke pass, on the live draw path", () => {
  // Isolate storeCold (a rotated element) by hiding every other element, and
  // supply a maskPng so buildMaskPdf skips its own page-covering flood rect
  // — otherwise that flood's "rg" would land ahead of storeCold's in the
  // stream and confuse the ordering check below. `rgOps` reads every
  // fill-color-setting "r g b rg" operator (NOT "RG", the separate stroke-
  // paint operator) in emission order — exactly the color sequence
  // strokedText's bridge copies + Tr-2 stroke pass + final fill pass draw.
  const rgOps = (stream: string) =>
    [...stream.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) rg\b/g)]
      .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const);

  it.each([
    {
      name: "white stroke around metallic fill",
      style: {
        fill: "#000000", layer: "metallic", stroke: "#000000",
        strokeLayer: "white", strokeWidth: 15,
      } as const,
      stroke: [0, 156 / 255, 215 / 255], // maskColor("white") — L.COLORS.maskBlue
      fill: [1, 1, 1], // maskColor("metallic") — knockout white
    },
    {
      name: "metallic stroke around white fill",
      style: {
        fill: "#000000", layer: "white", stroke: "#000000",
        strokeLayer: "metallic", strokeWidth: 15,
      } as const,
      stroke: [1, 1, 1],
      fill: [0, 156 / 255, 215 / 255],
    },
  ])("paints $name in stroke-then-fill order on the mask", async ({ style, stroke, fill }) => {
    const cfg = defaultConfig();
    cfg.storeCold = { text: "INK", ...style };
    const bytes = await buildMaskPdf(cfg, {
      ...assets, maskPng: onePxPng, hidden: allBut("storeCold"),
    });
    // Drop the first match: buildMaskPdf's page-background rect (always
    // white, unconditionally, before drawElements ever runs) is not part of
    // storeCold's own draw and isn't the ordering this test is about.
    const ops = rgOps(await contentStreamText(bytes)).slice(1);
    expect(ops.length).toBeGreaterThan(1);
    for (const op of ops.slice(0, -1)) for (const c of [0, 1, 2]) expect(op[c]).toBeCloseTo(stroke[c], 10);
    for (const c of [0, 1, 2]) expect(ops.at(-1)![c]).toBeCloseTo(fill[c], 10);
  });

  it("paints the same stroke-then-fill order on the art plate", async () => {
    const cfg = defaultConfig();
    cfg.storeCold = {
      text: "INK", fill: "#111111", layer: "metallic",
      stroke: "#eeeeee", strokeLayer: "white", strokeWidth: 15,
    };
    const bytes = await buildArtPdf(cfg, { ...assets, hidden: allBut("storeCold") });
    // No page-level background paint in art mode (no texture supplied), so
    // every "rg" here belongs to storeCold's own draw — nothing to drop.
    const ops = rgOps(await contentStreamText(bytes));
    expect(ops.length).toBeGreaterThan(1);
    const stroke = [0xee / 255, 0xee / 255, 0xee / 255];
    const fill = [0x11 / 255, 0x11 / 255, 0x11 / 255];
    for (const op of ops.slice(0, -1)) for (const c of [0, 1, 2]) expect(op[c]).toBeCloseTo(stroke[c], 10);
    for (const c of [0, 1, 2]) expect(ops.at(-1)![c]).toBeCloseTo(fill[c], 10);
  });
});

// The real WARNING_TEXT, wrapped through the real wrapper, with a
// deterministic stand-in font — every resulting column here is multi-word,
// so every one must justify out to exactly maxLen. Exercises src/warning.ts
// directly (the same module plan.ts's warning branch calls), independent of
// drawRotated/drawJustifiedRotated — nothing here changed with their removal.
describe("warning wrapping invariants", () => {
  const font = {
    widthOfTextAtSize: (t: string, size: number) => t.length * size * 0.6,
  };

  it("every real wrapped warning column measures exactly maxLen after justification", () => {
    // Marker-aware, as every renderer measures now: WARNING_TEXT carries
    // **bold** runs whose asterisks must not be counted as glyphs. This
    // test's single stand-in measure stands in for both faces.
    const measure = warningMeasure((t) => font.widthOfTextAtSize(t, L.WARNING.size));
    const cols = wrapWarning(measure, L.WARNING.maxLen);
    expect(cols.length).toBeGreaterThan(1);
    for (const line of cols) {
      expect(line.includes(" ")).toBe(true); // guards the exactness claim below
      expect(warningColumnLen(line, L.WARNING.maxLen, measure)).toBeCloseTo(L.WARNING.maxLen, 10);
    }
  });
});

// The layers-panel eye: Assets.hidden skips an element outright — every
// show-text/paint op it would emit, in BOTH modes — without moving anything
// else. Distinct from fill "none", which still paints (knockout white).
describe("Assets.hidden — the layers-panel eye", () => {
  const showOps = (s: string) => (s.match(/\bTj\b/g) ?? []).length;

  it("drops a hidden text element's show-text ops from the art plate", async () => {
    const { buildArtPdf } = await import("../src/pdf/build");
    const cfg = defaultConfig();
    const plain = showOps(await contentStreamText(await buildArtPdf(cfg, assets)));
    const hidden = showOps(await contentStreamText(
      await buildArtPdf(cfg, { ...assets, hidden: new Set(["name", "storeCold"]) }),
    ));
    expect(hidden).toBeLessThan(plain);
  });

  it("drops the hidden element from the mask plate too", async () => {
    const cfg = defaultConfig();
    const plain = showOps(await contentStreamText(await buildMaskPdf(cfg, assets)));
    const hidden = showOps(await contentStreamText(
      await buildMaskPdf(cfg, { ...assets, hidden: new Set(["name", "storeCold"]) }),
    ));
    expect(hidden).toBeLessThan(plain);
  });

  // Regression: a pre-refactor bug gated the whole collab-logo embed on
  // !hide(id), but the refactored planArt embedded the raster bytes BEFORE
  // consulting assets.hidden — so a hidden collab slot drew nothing (plan.ts
  // correctly omitted the item) yet still left its image XObject sitting in
  // the saved PDF. Hidden must mean no ink AND no embedded bytes.
  it("does not embed a hidden collab logo's raster bytes into the saved PDF", async () => {
    const cfg = defaultConfig();
    cfg.collabEnabled = true;
    const collabLeft: CollabImage = { kind: "png", bytes: onePxPng };

    const noCollab = await buildArtPdf(cfg, assets);
    const visible = await buildArtPdf(cfg, { ...assets, collabLeft });
    const hidden = await buildArtPdf(cfg, { ...assets, collabLeft, hidden: new Set(["collabLeft"]) });

    const baseline = await countImageXObjects(noCollab);
    expect(await countImageXObjects(visible)).toBeGreaterThan(baseline);
    expect(await countImageXObjects(hidden)).toBe(baseline);
  });
});

describe("Master-variation custom layers", () => {
  it("a custom text layer draws through the shared display list", async () => {
    const showOps = (s: string) => (s.match(/\bTj\b/g) ?? []).length;
    const cfg = defaultConfig();
    const withLayer = {
      ...cfg,
      customLayers: [{
        id: "custom-t1" as const, name: "Custom", type: "text" as const, size: 12,
        position: { anchor: "left" as const, vAnchor: "top" as const, offsetX: 0, offsetY: 0 },
        line: { text: "HELLO", fill: "#000000" as const, layer: "metallic" as const },
      }],
    };
    const plain = await buildArtPdf(cfg, assets);
    const withLayerBytes = await buildArtPdf(withLayer, assets);
    expect(withLayerBytes.length).not.toBe(plain.length);
    expect(showOps(await contentStreamText(withLayerBytes)))
      .toBeGreaterThan(showOps(await contentStreamText(plain)));
  });

  // Round-1 fix: a custom image layer with a PlanAssets.custom aspect entry
  // (as planLabel emits it) but no actual embedded bytes must not crash
  // buildArtPdf — asset-bytes wiring is deferred, but the plan can still
  // place the item. Guarded to a no-op: byte-identical to the same build
  // without the layer.
  it("a custom image layer with no embedded bytes builds without crashing, and is a no-op", async () => {
    const cfg = defaultConfig();
    const withImageLayer = {
      ...cfg,
      customLayers: [{
        id: "custom-i1" as const, name: "Custom Image", type: "image" as const, w: 100,
        asset: "art1",
        position: { anchor: "left" as const, vAnchor: "top" as const, offsetX: 0, offsetY: 0 },
        style: { fill: "none" as const, layer: "white" as const },
      }],
    };
    const plain = await buildArtPdf(cfg, assets);
    const withLayer = await buildArtPdf(withImageLayer, assets);
    expect(withLayer).toEqual(plain);
    const plainMask = await buildMaskPdf(cfg, assets);
    const withLayerMask = await buildMaskPdf(withImageLayer, assets);
    expect(withLayerMask).toEqual(plainMask);
  });
});
