// build.ts — builds the combined print PDF and optional art/mask PDF pair.
// (planLayers.ts's PlacedLayer[], which the caller plans from the resolved
// v3 layers — App or scripts/generate.ts). drawItems walks the list in draw
// order once per mode: in "art" mode elements draw with their fill color
// over the background page art; in "mask" mode metallic elements knock out
// (white) and white-layer elements paint mask blue. Both modes share the
// exact same geometry, so the pair stays registered. The `page` items (the
// background texture and the metallic mask) replace the texture/mask
// handling this file used to own: the art plate draws the background
// cover-fit, the mask plate draws the mask — each looked up by `asset`,
// like every raster image.
import {
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  PDFFont,
  PDFPage,
  degrees,
  drawImage,
  drawRectangle,
  drawSvgPath,
  grayscale,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSpacing,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  setTextRenderingMode,
  TextRenderingMode,
  translate,
  type Color,
  type PDFOperator,
  type PDFRef,
  type Rotation,
} from "pdf-lib";
import fontkit, { type Font } from "@pdf-lib/fontkit";
import type { FontFamilyId } from "../fontCatalog";
import type { Fill } from "../types";
import { bridgeOffsets } from "../strokes";
import { digitStartX, type Face, type MeasureFace, type Mode, type PlacedBarcode, type PlacedText } from "../plan";
import { pageDrawsOn, type PlacedLayer, type PlacedPage } from "../planLayers";
import * as L from "../layout";
import { describeCodepoints, VARIATION_SELECTOR } from "../textheight";
import { version } from "../../package.json";
import { openFont } from "../fontkit";
import { outlineText } from "./outline";
import { embedWhiteInkMask, registerWhiteInk, whiteFill, whiteStroke } from "./whiteInk";

/** An image asset's source: vector text (already planned as `paths` items by
 *  planLayers, so this backend never draws it) or raster bytes, embedded
 *  as-is. The name predates the layer model: every raster image — collab
 *  slots, custom art, the page texture and mask — is one of these now. */
export type CollabImage =
  | { kind: "svg"; svg: string }
  | { kind: "png" | "jpg"; bytes: Uint8Array };

export interface Assets {
  fonts: { regular: Uint8Array; semibold: Uint8Array; bold: Uint8Array };
  fontFamilies?: Partial<Record<FontFamilyId, Assets["fonts"]>>;
  /** Raster bytes by asset id — the id every `image` and `page` item carries
   *  in `asset`. A missing key (bytes not loaded, or an SVG source, which
   *  planLayers already turned into paths) leaves that item a no-op on BOTH
   *  plates: no ink, and no mask footprint for art the art plate never
   *  prints. For the two page roles the fallbacks are the old ones — no
   *  background bytes = bare stock, no mask bytes = the white-ink flood. */
  images?: Record<string, CollabImage | null | undefined>;
  /** Decoded uploaded mask for the spot-color image in a combined PDF.
   *  Decoding belongs to the app/CLI boundary, not this DOM-free builder. */
  maskPixels?: { data: Uint8ClampedArray; width: number; height: number };
  /** The label's display name for the PDF's document title. */
  title?: string;
}

interface Fonts {
  regular: PDFFont;
  semibold: PDFFont;
  bold: PDFFont;
  families?: Partial<Record<FontFamilyId, Fonts>>;
}

/** Pinned UTC timestamp for deterministic PDF output — identical input builds byte-identically. */
const PDF_EPOCH = new Date("2000-01-01T00:00:00Z");

const toRgb = (c: { r: number; g: number; b: number }) => rgb(c.r, c.g, c.b);

function fillColor(fill: Fill) {
  const c = L.parseHexFill(fill);
  // DeviceGray keeps neutral type and vectors on the K plate during CMYK
  // conversion; DeviceRGB black otherwise becomes four-colour rich black.
  return c.r === c.g && c.g === c.b ? grayscale(c.r) : toRgb(c);
}

/** One mask decision shared by the RGB plate and the spot-color pass. */
const maskTint = (layer: "metallic" | "white"): 0 | 1 => layer === "white" ? 1 : 0;
function maskColor(layer: "metallic" | "white") {
  return maskTint(layer) ? toRgb(L.COLORS.maskBlue) : toRgb(L.COLORS.white);
}

/** An element's paint for the plate: its fill on the art plate, its plate
 *  layer's knockout/white-ink colour on the mask (psd/build.ts's paint()). */
const ink = (mode: Mode, fill: Fill, layer: "metallic" | "white") =>
  mode === "art" ? fillColor(fill) : maskColor(layer);

/** drawText has no stroke option, but PDF's text rendering mode does the job:
 *  Tr 2 (FillAndOutline) with a 2w line width paints the glyph body plus a
 *  centered outline whose outer half is the w-wide outer stroke; the fill
 *  copy drawn on top covers the inner half. A true stroke, unlike the old
 *  ring-of-offset-copies fake, closes solid around features smaller than the
 *  stroke radius (an i-dot, a diaeresis, the % counters), which the ring left
 *  as white gaps — its copies sat only AT radius w, never inside it. The
 *  page's round join/cap (see newDoc) keeps corners round. Set BEFORE the
 *  draw: drawText wraps itself in q/Q, so outer text state is inherited
 *  inside and survives the pop — same escape hatch as withTracking's Tc.
 *  Single text runs go through strokedText below; only drawBarcode uses this
 *  raw, to batch EVERY digit's stroke before ANY fill (its module-width
 *  invariant), which a per-text helper can't express. */
function withTextStroke(
  page: PDFPage,
  stroke: { color: Color; w: number },
  draw: () => void,
) {
  page.pushOperators(
    setTextRenderingMode(TextRenderingMode.FillAndOutline),
    setLineWidth(2 * stroke.w),
    setStrokingColor(stroke.color),
  );
  draw();
  page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));
}

/** Placement shared by the stroke helpers below — one spelling so an added
 *  option (say, letter-spacing) can't drift between them. */
type TextAt = { x: number; y: number; size: number; font: PDFFont; rotate?: Rotation };

/** Filled glyph copies bridging the interior of the intended outside stroke,
 *  stamped on the shared ring (bridgeOffsets owns the radius and the sampling
 *  rule; the canvas backend stamps the same one). pdf.js's path-font renderer
 *  (Firefox's built-in PDF viewer, for one) can leave the
 *  inner half of a wide text stroke unpainted around tiny glyph features even
 *  though PDF/Poppler renders the true stroke solid; these copies fill only
 *  that interior. The width is the live per-element stroke — no
 *  punctuation-specific size or default. */
function bridgeTextStroke(
  page: PDFPage,
  stroke: { color: Color; w: number },
  txt: string,
  opts: TextAt,
) {
  for (const { dx, dy } of bridgeOffsets(stroke.w)) {
    page.drawText(txt, { ...opts, x: opts.x + dx, y: opts.y + dy, color: stroke.color });
  }
}

/** One text run with its outer stroke: the Tr-2 stroke pass (whose drawText
 *  must carry the STROKE color — Tr 2 fills the glyph body too), then the
 *  fill copy on top. Owning both passes here keeps the order and the stroke
 *  pass's color out of caller hands. A null stroke is just the fill draw. */
function strokedText(
  page: PDFPage,
  stroke: { color: Color; w: number } | null,
  txt: string,
  opts: TextAt & { color: Color },
) {
  if (stroke) {
    bridgeTextStroke(page, stroke, txt, opts);
    withTextStroke(page, stroke, () => page.drawText(txt, { ...opts, color: stroke.color }));
  }
  page.drawText(txt, opts);
}

const y = (topY: number) => L.PAGE.h - topY; // top-left origin -> PDF space

/** Run `draw` with the element's letter-spacing in effect. pdf-lib has no
 *  per-draw option for tracking, so it goes in as PDF's text-state operator
 *  Tc — the same escape hatch newDoc uses for line joins. Set BEFORE the
 *  draw: drawText wraps itself in q/Q, so an outer Tc is inherited inside and
 *  survives the pop. Cleared after, because Tc otherwise stays in force for
 *  every later text draw on the page. */
function withTracking(page: PDFPage, tracking: number | undefined, draw: () => void) {
  if (!tracking) return draw();
  page.pushOperators(setCharacterSpacing(tracking));
  draw();
  page.pushOperators(setCharacterSpacing(0));
}

/** The barcode, in both modes, from its placed item (see PlacedBarcode). The
 *  plan resolved geometry, colors-by-name and digit centring once; this only
 *  paints. */
export function drawBarcode(page: PDFPage, fonts: Fonts, item: PlacedBarcode, mode: Mode) {
  const S = item.S;
  const geo = item.geo;
  // y() of a run's lowest module IS the rect's bottom edge in PDF space, so
  // the top-origin box converts by its far edge.
  const bars = geo.bars.map((b) => ({
    x: b.x, y: y(b.yTop + b.h), width: b.w, height: b.h,
  }));
  // Rotated (the template): rotate(90) turns the glyph body toward -x, so
  // `x` is the baseline and the digits grow back toward the bars from it;
  // the plan already centred `y`. Upright (every custom barcode layer, Task
  // 3): ordinary horizontal drawText, so `x` needs the left edge — the plan
  // hands back the run's CENTER (see PlacedBarcode's own doc) — and no
  // rotation. digitStartX picks between the two.
  const digits = item.digits.map((d) => ({
    txt: d.text, x: digitStartX(d, item.rotated), y: y(d.y), w: d.w,
  }));
  const glyph = item.rotated
    ? { size: item.textSize, font: fonts.regular, rotate: degrees(90) }
    : { size: item.textSize, font: fonts.regular };

  // Both plates paint the same bars and digit glyphs. Mask mode only swaps
  // plate colours: the halo takes the stroke plate, and the bars and glyph
  // bodies take the fill plate. Draw every stroke shape before any fill. A
  // later stroke bites into an already-drawn neighbour and distorts module
  // widths until the code stops decoding. Between dense bars the halo closes
  // into a solid field. A solid background is a separate path the planner
  // emits first, and only when the layer asks for one. The stroke block runs
  // only when S > 0 — a "none" stroke resolves to that in the plan, and a
  // zero-width stroke would still paint a hairline.
  const strokeColor = ink(mode, item.stroke, item.strokeLayer);
  const fillInk = ink(mode, item.fill, item.fillLayer);
  if (S > 0 && item.stroke !== "none") {
    // A centered border at 2S extends S beyond the bar and — because the page
    // sets a ROUND line join (see newDoc) — rounds each corner at radius S,
    // which is what Photoshop's outside stroke does and what the PSD's real
    // stroke effect produces.
    for (const r of bars)
      page.drawRectangle({
        ...r, color: strokeColor, borderColor: strokeColor, borderWidth: 2 * S,
      });
    withTextStroke(page, { color: strokeColor, w: S }, () => {
      for (const d of digits)
        page.drawText(d.txt, { ...glyph, x: d.x, y: d.y, color: strokeColor });
    });
  }

  // The artwork itself, at its exact geometry.
  for (const r of bars) page.drawRectangle({ ...r, color: fillInk });
  for (const d of digits) page.drawText(d.txt, { ...glyph, x: d.x, y: d.y, color: fillInk });
}

/** Embedded raster XObjects by asset id, one embed per asset however many
 *  items share it. Only rasters with bytes in `assets.images` embed — so a
 *  missing asset never leaves an unreferenced XObject in the saved PDF. */
type Embedded = Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>;

async function embedRasters(doc: PDFDocument, items: readonly PlacedLayer[], assets: Assets, mode: Mode): Promise<Embedded> {
  const embedded: Embedded = new Map();
  for (const r of items) {
    if (r.kind !== "image" && r.kind !== "page") continue;
    if (r.kind === "page" && !pageDrawsOn(r, mode)) continue;
    const asset = r.asset;
    const img = asset ? assets.images?.[asset] : null;
    if (!asset || !img || img.kind === "svg" || embedded.has(asset)) continue;
    embedded.set(asset, img.kind === "png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes));
  }
  return embedded;
}

function drawItems(
  page: PDFPage,
  fonts: Fonts,
  items: readonly PlacedLayer[],
  embedded: Embedded,
  mode: Mode,
) {
  const faceFont = (f: Face, family?: FontFamilyId) => {
    const selected = family ? fonts.families?.[family] : fonts;
    if (!selected) throw new Error(`Missing PDF font family: ${family}`);
    return selected[f];
  };

  const drawText = (r: PlacedText) => {
    const color = ink(mode, r.fill, r.layer);
    const stroke = r.stroke
      ? { color: ink(mode, r.stroke.fill, r.stroke.layer), w: r.stroke.w }
      : null;
    withTracking(page, r.tracking || undefined, () =>
      strokedText(page, stroke, r.text, {
        x: r.x, y: y(r.y), size: r.size, font: faceFont(r.face, r.fontFamily), color,
        ...(r.rotated ? { rotate: degrees(90) } : {}),
      }));
  };

  for (const r of items) {
    if (r.kind === "text") drawText(r);
    else if (r.kind === "paths") {
      const color = ink(mode, r.fill, r.layer);
      const at = { x: r.x, y: y(r.y) };
      // Every stroke path before any fill, so overlapping strokes can't
      // paint over a neighbour's fill (the laurel-branch rule).
      if (r.stroke) {
        const sc = ink(mode, r.stroke.fill, r.stroke.layer);
        for (const d of r.paths)
          page.drawSvgPath(d, { ...at, color: sc, borderColor: sc, borderWidth: 2 * r.stroke.w });
      }
      for (const d of r.paths) page.drawSvgPath(d, { ...at, color });
    } else if (r.kind === "page") {
      // Page art covers the PAGE and must not move with the design: it is
      // drawn under the bleed shift the rest of the list sits in (see
      // shiftForBleed), at the cover-fit rect planLayers computed.
      if (!pageDrawsOn(r, mode) || !embedded.has(r.asset)) continue;
      withoutBleedShift(page, () =>
        page.drawImage(embedded.get(r.asset)!, { x: r.x, y: y(r.y + r.h), width: r.w, height: r.h }));
    } else if (r.kind === "image") {
      // An image item whose bytes never made it into `embedded` (planLayers
      // places a rect from a stored aspect alone, before/without bytes) is
      // skipped on EITHER plate: no ink, and no mask footprint for art the
      // art plate never prints.
      const emb = r.asset ? embedded.get(r.asset) : undefined;
      if (!emb) continue;
      const rect = { x: r.x, y: y(r.y + r.h), width: r.w, height: r.h };
      if (mode === "art") page.drawImage(emb, rect);
      // Raster art prints on white ink: the mask paints its footprint blue.
      else page.drawRectangle({ ...rect, color: toRgb(L.COLORS.maskBlue) });
    } else drawBarcode(page, fonts, r, mode);
  }
}

/** A family's three faces embedded into `doc`, in face order (sequential,
 *  so the document's object order stays deterministic). Subsetting changes
 *  only what the file carries, never a glyph's width. */
async function embedFaces(doc: PDFDocument, pack: Assets["fonts"], subset = false): Promise<Record<Face, PDFFont>> {
  return {
    regular: await doc.embedFont(pack.regular, { subset }),
    semibold: await doc.embedFont(pack.semibold, { subset }),
    bold: await doc.embedFont(pack.bold, { subset }),
  };
}

/** The plan measure for a PDF/PSD export: each face's width from the pdf-lib
 *  font drawText draws it with. drawText places glyphs by their raw advances
 *  and emits no kerning, so a kerned measure (canvas measureText's default)
 *  plans a kern-table family like Barlow Condensed up to ~8% short of the
 *  ink it prints (#86). A run with no family measures in `fallback`'s faces.
 *  Unsupported glyphs stop the export before any files are written. Shared by the App export and the CLI. */
export async function pdfMeasureFace(
  packs: Partial<Record<FontFamilyId, Assets["fonts"]>>,
  fallback: FontFamilyId,
): Promise<MeasureFace> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const embedded: Partial<Record<FontFamilyId, Record<Face, PDFFont>>> = {};
  const coverage = new Map<PDFFont, Set<number>>();
  for (const [id, pack] of Object.entries(packs) as [FontFamilyId, Assets["fonts"]][]) {
    embedded[id] = await embedFaces(doc, pack);
    for (const font of Object.values(embedded[id]!)) coverage.set(font, new Set(font.getCharacterSet()));
  }
  if (!embedded[fallback]) throw new Error(`Missing measure font family: ${fallback}`);
  return (text, size, face, family) => {
    const selected = embedded[family ?? fallback];
    if (!selected) throw new Error(`Missing measure font family: ${family}`);
    const font = selected[face];
    const supported = coverage.get(font)!;
    // Variation selectors (the emoji picker's ™️) are folded into the base
    // glyph by fontkit, so they are never missing.
    const missing = [...new Set([...text].filter((ch) =>
      !VARIATION_SELECTOR.test(ch) && !supported.has(ch.codePointAt(0)!)).map((ch) => ch.codePointAt(0)!))];
    if (missing.length) throw new Error(`Cannot print ${describeCodepoints(missing)} in ${font.name}. Replace these characters or choose a font that supports them.`);
    return font.widthOfTextAtSize(text, size);
  };
}

async function newDoc(assets: Assets): Promise<{ doc: PDFDocument; page: PDFPage; fonts: Fonts }> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(PDF_EPOCH);
  doc.setModificationDate(PDF_EPOCH);
  doc.registerFontkit(fontkit);
  const embed = (bytes: Assets["fonts"]): Promise<Fonts> => embedFaces(doc, bytes, true);
  const fonts = await embed(assets.fonts);
  for (const [family, bytes] of Object.entries(assets.fontFamilies ?? {})) {
    (fonts.families ??= {})[family as FontFamilyId] = bytes === assets.fonts ? fonts : await embed(bytes);
  }
  // Provenance for the printer's preflight: the release version, never a
  // build time, so identical input still builds identical bytes.
  doc.setProducer(`Label Lab ${version}`);
  const page = doc.addPage([L.PAGE.w, L.PAGE.h]);
  // Printer boxes: the 8x5in die (ART, the trim inside the bleed) and the
  // whole page as the bleed. Without them, RIPs and preflight tools assume
  // trim = page. ART is inset equally on all sides, so its top-left y is
  // also its bottom-left y.
  page.setBleedBox(0, 0, L.PAGE.w, L.PAGE.h);
  page.setTrimBox(L.ART.x, L.ART.y, L.ART.w, L.ART.h);
  // Round every stroke join and cap for the whole page. pdf-lib has no
  // per-draw option for this, so it goes in as a graphics-state operator up
  // front; PDF's default is a MITER join, which shoots long spikes off any
  // acute corner — very visible on the laurel's leaf tips.
  page.pushOperators(setLineJoin(LineJoinStyle.Round), setLineCap(LineCapStyle.Round));
  return { doc, page, fonts };
}

/** Move the DESIGN by the bleed shift, once, for the whole page.
 *
 *  Layer positions are page-absolute at MEASURED_BLEED (see BLEED_SHIFT), so
 *  a changed bleed slides the page edge out from under them. One `cm` on the
 *  content stream puts them back — the alternative is adding the shift to the
 *  `y()` helper and to the x of every draw call in this file, forty-odd chances
 *  to miss one.
 *
 *  PDF space is y-up, so a downward shift is negative. It goes in BEFORE the
 *  items walk; the page-covering paints (the texture, the mask's coats) step
 *  back out of it through withoutBleedShift, since they cover the page and
 *  must not move with the design.
 *
 *  Emits nothing at the shipped bleed, so the built bytes are unchanged. */
function shiftForBleed(page: PDFPage) {
  if (L.BLEED_SHIFT) page.pushOperators(translate(L.BLEED_SHIFT, -L.BLEED_SHIFT));
}

/** Run `draw` in page space, undoing shiftForBleed for the duration. */
function withoutBleedShift(page: PDFPage, draw: () => void) {
  if (!L.BLEED_SHIFT) return draw();
  page.pushOperators(pushGraphicsState(), translate(-L.BLEED_SHIFT, L.BLEED_SHIFT));
  draw();
  page.pushOperators(popGraphicsState());
}

const hasPage = (items: readonly PlacedLayer[], embedded: Embedded, role: PlacedPage["role"]) =>
  items.some((r) => r.kind === "page" && r.role === role && embedded.has(r.asset));

/** The art plate: the background page item (when its bytes are loaded) under
 *  every element in list order. Without a background the elements sit on
 *  bare stock, which is what the preview shows before a texture is dropped. */
export async function buildArtPdf(items: readonly PlacedLayer[], assets: Assets): Promise<Uint8Array> {
  const { doc, page, fonts } = await newDoc(assets);
  const embedded = await embedRasters(doc, items, assets, "art");
  shiftForBleed(page);
  drawItems(page, fonts, items, embedded, "art");
  doc.setTitle(`${assets.title ?? "Label"} label art`);
  return doc.save();
}

/** The white-ink plate: a white page (knockout by default), then the mask
 *  page item as-authored (the printer accepts these plates unrecolored) — or,
 *  with no mask bytes, a flood of the whole plate with white ink ("no mask"
 *  = "print as a white label") — then the elements knocking out or adding
 *  ink on top. The flood MUST land before the elements so metallic knockouts
 *  still win on top of it. */
export async function buildMaskPdf(items: readonly PlacedLayer[], assets: Assets): Promise<Uint8Array> {
  const { doc, page, fonts } = await newDoc(assets);
  const embedded = await embedRasters(doc, items, assets, "mask");
  page.drawRectangle({ x: 0, y: 0, width: L.PAGE.w, height: L.PAGE.h, color: rgb(1, 1, 1) });
  if (!hasPage(items, embedded, "mask"))
    page.drawRectangle({ x: 0, y: 0, width: L.PAGE.w, height: L.PAGE.h, color: toRgb(L.COLORS.maskBlue) });
  shiftForBleed(page);
  drawItems(page, fonts, items, embedded, "mask");
  doc.setTitle(`${assets.title ?? "Label"} white-ink layer`);
  return doc.save();
}

/** The same mask geometry, painted only in the printer's spot color.
 *  Builders supply the PDF geometry; replace their known placeholder gray
 *  operators before pushing them, never rewriting a serialized content stream. */
function drawWhiteInk(
  page: PDFPage, items: readonly PlacedLayer[], assets: Assets, embedded: Embedded,
  mask: PDFRef | undefined,
) {
  const placeholder = grayscale(0);
  const paint = (ops: PDFOperator[], tint: 0 | 1) => {
    for (const op of ops) {
      const text = op.toString();
      if (text === "0 g") page.pushOperators(...whiteFill(tint));
      else if (text === "0 G") page.pushOperators(...whiteStroke(tint));
      else page.pushOperators(op);
    }
  };
  const rect = (x: number, y: number, w: number, h: number, tint: 0 | 1, stroke = 0) =>
    paint(drawRectangle({
      x, y, width: w, height: h, color: placeholder,
      borderColor: stroke ? placeholder : undefined, borderWidth: 2 * stroke,
      rotate: degrees(0), xSkew: degrees(0), ySkew: degrees(0),
    }), tint);
  const paths = (ds: readonly string[], x: number, y: number, tint: 0 | 1, stroke = 0) => {
    for (const d of ds) paint(drawSvgPath(d, {
      x, y, scale: 1, color: placeholder,
      borderColor: stroke ? placeholder : undefined, borderWidth: 2 * stroke,
    }), tint);
  };
  // Each font face is opened at most once per pass, including custom families.
  const faces = new Map<Uint8Array, Font>();
  const font = (face: Face, family?: FontFamilyId) => {
    const pack = family ? assets.fontFamilies?.[family] : assets.fonts;
    if (!pack) throw new Error(`Missing PDF font family: ${family}`);
    const bytes = pack[face];
    let fk = faces.get(bytes);
    if (!fk) { fk = openFont(bytes); faces.set(bytes, fk); }
    return fk;
  };
  if (!mask) withoutBleedShift(page, () => rect(0, 0, L.PAGE.w, L.PAGE.h, 1));
  for (const r of items) {
    if (r.kind === "text") {
      const ds = outlineText(font(r.face, r.fontFamily), r);
      if (r.stroke) paths(ds, 0, L.PAGE.h, maskTint(r.stroke.layer), r.stroke.w);
      paths(ds, 0, L.PAGE.h, maskTint(r.layer));
    } else if (r.kind === "paths") {
      if (r.stroke) paths(r.paths, r.x, y(r.y), maskTint(r.stroke.layer), r.stroke.w);
      paths(r.paths, r.x, y(r.y), maskTint(r.layer));
    } else if (r.kind === "page") {
      if (!pageDrawsOn(r, "mask") || !mask) continue;
      const name = page.node.newXObject("WhiteMask", mask);
      withoutBleedShift(page, () => page.pushOperators(...drawImage(name, {
        x: r.x, y: y(r.y + r.h), width: r.w, height: r.h,
        rotate: degrees(0), xSkew: degrees(0), ySkew: degrees(0),
      })));
    } else if (r.kind === "image") {
      if (r.asset && embedded.has(r.asset)) rect(r.x, y(r.y + r.h), r.w, r.h, 1);
    } else {
      const digits = r.digits.map((d) => outlineText(font("regular"), {
        kind: "text", id: r.id, text: d.text, face: "regular", size: r.textSize,
        x: digitStartX(d, r.rotated), y: d.y, rotated: r.rotated,
        fill: r.fill, layer: r.fillLayer,
        w: d.w, tracking: 0, stroke: null,
      }));
      if (r.S > 0 && r.stroke !== "none") {
        const tint = maskTint(r.strokeLayer);
        for (const b of r.geo.bars) rect(b.x, y(b.yTop + b.h), b.w, b.h, tint, r.S);
        for (const ds of digits) paths(ds, 0, L.PAGE.h, tint, r.S);
      }
      const tint = maskTint(r.fillLayer);
      for (const b of r.geo.bars) rect(b.x, y(b.yTop + b.h), b.w, b.h, tint);
      for (const ds of digits) paths(ds, 0, L.PAGE.h, tint);
    }
  }
}

/** One print file: unchanged art followed by an outlined, overprinting White Ink OCG. */
export async function buildPrintPdf(items: readonly PlacedLayer[], assets: Assets): Promise<Uint8Array> {
  const { doc, page, fonts } = await newDoc(assets);
  const embedded = await embedRasters(doc, items, assets, "art");
  shiftForBleed(page);
  drawItems(page, fonts, items, embedded, "art");
  const white = registerWhiteInk(doc, page);
  const uploaded = items.some((r) => r.kind === "page" && r.role === "mask" && assets.images?.[r.asset]);
  let mask: PDFRef | undefined;
  if (uploaded) {
    if (!assets.maskPixels) throw new Error("Decoded mask pixels are required for the print PDF.");
    const { data, width, height } = assets.maskPixels;
    mask = embedWhiteInkMask(doc, data, width, height);
  }
  page.pushOperators(...white.begin);
  drawWhiteInk(page, items, assets, embedded, mask);
  page.pushOperators(...white.end);
  doc.setTitle(`${assets.title ?? "Label"} label`);
  return doc.save();
}
