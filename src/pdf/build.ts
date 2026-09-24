// build.ts — builds the two deliverable PDFs with pdf-lib from a DISPLAY LIST
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
  type Rotation,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { FontFamilyId } from "../fontCatalog";
import type { Fill } from "../types";
import { bridgeOffsets } from "../strokes";
import { type Face, type MeasureFace, type Mode, type PlacedBarcode, type PlacedText } from "../plan";
import type { PlacedLayer, PlacedPage } from "../planLayers";
import * as L from "../layout";

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
  return toRgb(L.parseHexFill(fill));
}

/** Mask-mode paint for an element: knockout (white) or white-ink (blue). */
function maskColor(layer: "metallic" | "white") {
  return layer === "metallic" ? toRgb(L.COLORS.white) : toRgb(L.COLORS.maskBlue);
}

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
 *  (required in rasterWorker, where DOM fonts do not exist) can leave the
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
  // rotation.
  const digits = item.digits.map((d) => ({
    txt: d.text, x: item.rotated ? d.x : d.x - d.w / 2, y: y(d.y), w: d.w,
  }));
  const glyph = item.rotated
    ? { size: item.textSize, font: fonts.regular, rotate: degrees(90) }
    : { size: item.textSize, font: fonts.regular };

  if (mode === "mask") {
    // Stroke and fill have independent mask plates. Paint the expanded stroke
    // footprint first, then the exact fill footprint on top so unlike plate
    // choices leave the outer halo visible and the bars/digits retain their
    // own assignment. When both plates match, one expanded pass is the same
    // flattened result and preserves the compact legacy stream.
    const fillLayer = item.fillLayer;
    const strokeLayer = item.strokeLayer;
    // A non-zero outset draws as a centered border of 2*outset on the BASE
    // footprint instead of a pre-outset rectangle: with the page's round line
    // join (see newDoc) that rounds each corner at radius `outset`, matching
    // the art pass's halo and the PSD's outside-stroke effect. The old outset
    // rectangles were square-cornered, leaving the white-ink plate overhanging
    // the art ink by a corner nib at every bar and digit-pill corner.
    const drawFootprint = (outset: number, color: ReturnType<typeof maskColor>) => {
      for (const r of item.footprint)
        page.drawRectangle({
          x: r.x, y: y(r.yTop + r.h), width: r.w, height: r.h, color,
          ...(outset > 0 ? { borderColor: color, borderWidth: 2 * outset } : {}),
        });
    };
    if (S > 0) drawFootprint(S, maskColor(strokeLayer));
    if (S === 0 || strokeLayer !== fillLayer) drawFootprint(0, maskColor(fillLayer));
    return;
  }

  // Outer stroke, skipped entirely at S = 0 — a zero-width stroke would still
  // paint a hairline. EVERY stroke shape draws before ANY fill one —
  // that ordering is what makes this safe. Interleaving the two (an underlay
  // per bar, then its bar) lets a later stroke bite into an already-drawn
  // neighbour, which distorted the module widths until the code stopped
  // decoding. Between the dense bars the stroke closes into a solid field
  // and around the digits it reads as a pill, matching the reference's
  // white shape without a backing box. Reached only when S > 0, which a
  // "none" stroke never resolves to (see barcodeStrokePt).
  if (S > 0 && item.stroke !== "none") {
    const strokeColor = fillColor(item.stroke);
    // A centered border at 2S extends S beyond the bar and — because the page
    // sets a ROUND line join (see newDoc) — rounds each corner at radius S,
    // which is what Photoshop's outside stroke does and what the PSD's real
    // stroke effect produces. The old outset rectangle was square-cornered,
    // the one place the PDF's barcode halo visibly diverged from the PSD.
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
  const ink = fillColor(item.fill);
  for (const r of bars) page.drawRectangle({ ...r, color: ink });
  for (const d of digits) page.drawText(d.txt, { ...glyph, x: d.x, y: d.y, color: ink });
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

/** Which plate a page item belongs to: the background texture is art-only,
 *  the metallic mask is mask-only. */
const pageDrawsOn = (p: PlacedPage, mode: Mode) =>
  mode === "art" ? p.role === "background" : p.role === "mask";

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
    const color = mode === "art" ? fillColor(r.fill) : maskColor(r.layer);
    const stroke = r.stroke
      ? { color: mode === "art" ? fillColor(r.stroke.fill) : maskColor(r.stroke.layer), w: r.stroke.w }
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
      const color = mode === "art" ? fillColor(r.fill) : maskColor(r.layer);
      const at = { x: r.x, y: y(r.y) };
      // Every stroke path before any fill, so overlapping strokes can't
      // paint over a neighbour's fill (the laurel-branch rule).
      if (r.stroke) {
        const sc = mode === "art" ? fillColor(r.stroke.fill) : maskColor(r.stroke.layer);
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
 *  ink it prints (#86). A run with no family, or one missing from `packs`,
 *  measures in `fallback`'s faces. Shared by the App export and the CLI. */
export async function pdfMeasureFace(
  packs: Partial<Record<FontFamilyId, Assets["fonts"]>>,
  fallback: FontFamilyId,
): Promise<MeasureFace> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const embedded: Partial<Record<FontFamilyId, Record<Face, PDFFont>>> = {};
  for (const [id, pack] of Object.entries(packs) as [FontFamilyId, Assets["fonts"]][])
    embedded[id] = await embedFaces(doc, pack);
  if (!embedded[fallback]) throw new Error(`Missing measure font family: ${fallback}`);
  return (text, size, face, family) =>
    (embedded[family ?? fallback] ?? embedded[fallback]!)[face].widthOfTextAtSize(text, size);
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
  const page = doc.addPage([L.PAGE.w, L.PAGE.h]);
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
