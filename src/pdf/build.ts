// build.ts — builds the two deliverable PDFs with pdf-lib. One element walk
// (drawElements) serves both: in "art" mode elements draw with their fill
// color over the texture; in "mask" mode metallic elements knock out (white)
// and white-layer elements paint mask blue. Both modes share the exact same
// geometry, so the pair stays registered.
import {
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  PDFFont,
  PDFPage,
  degrees,
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
import type { CollabSlot, Fill, LabelConfig, Style } from "../types";
import { logoNudge, type ElementId } from "../elements";
import { parseLogo } from "../logo";
import { WARNING_TEXT, displayAbv, displayName, displayStyle } from "../defaults";
import { planLabel, type Face, type MeasureFace, type PlacedText } from "../plan";
import * as L from "../layout";
import { barcodeFootprint, barcodeGeometry, barcodeStrokePt } from "../barcode";
import { qrPath, qrShapes, qrUrl } from "../qr";
import { parseDescription } from "../description";
import { strokeLayerOf } from "../strokes";

/** A collab brewery's logo: vector source (recolored by its slot's style, like
 *  the laurel) or raster bytes (drawn as-is, over white ink). */
export type CollabImage =
  | { kind: "svg"; svg: string }
  | { kind: "png" | "jpg"; bytes: Uint8Array };

export interface Assets {
  fonts: { regular: Uint8Array; semibold: Uint8Array; bold: Uint8Array };
  /** Raw contents of logo2025.svg. */
  logoSvg: string;
  /** Collab logos. Ignored entirely unless cfg.collabEnabled; with the switch
   *  on, a slot with no image draws nothing (and an empty left slot also
   *  suppresses the "A collaborative project with" lead-in). */
  collabLeft?: CollabImage | null;
  collabCenter?: CollabImage | null;
  /** Optional: without it the art PDF is just the elements on bare stock,
   *  which is what the preview shows before a texture is dropped. */
  texture?: { bytes: Uint8Array; kind: "png" | "jpg" };
  /** Uploaded mask PNG, embedded as-authored (the printer accepts these
   *  plates unrecolored). Optional: without it buildMaskPdf floods the whole page white-ink
   *  blue instead ("no mask" = "print as a white label"), and the per-element
   *  assignments (metallic knockouts, white-layer ink) draw on top of that. */
  maskPng?: Uint8Array;
  /** Elements the UI's layers-panel eye has hidden: skipped entirely — ink,
   *  stroke AND mask footprint. Distinct from fill "none", which is a live
   *  style meaning "no ink / knockout white". Session state, not config: a
   *  saved label file never records a hidden layer. */
  // Structural (`has` only), not ReadonlySet<ElementId>: the UI's hidden set
  // also carries the texture/mask layer ids, which this build never asks
  // about — App handles those by omitting the asset itself.
  hidden?: { has(id: ElementId): boolean };
}

interface Fonts {
  regular: PDFFont;
  semibold: PDFFont;
  bold: PDFFont;
}

type Mode = "art" | "mask";

const toRgb = (c: { r: number; g: number; b: number }) => rgb(c.r, c.g, c.b);

function fillColor(fill: Fill) {
  return toRgb(L.parseHexFill(fill));
}

/** Mask-mode paint for an element: knockout (white) or white-ink (blue). */
function maskColor(layer: "metallic" | "white") {
  return layer === "metallic" ? toRgb(L.COLORS.white) : toRgb(L.COLORS.maskBlue);
}

/** Outer-stroke params for an element, or null when off. Art uses the stroke
 *  color; mask output independently resolves the stroke's white/metallic
 *  plate. Widths are authored in px at the 600dpi deliverable. */
function strokeOf(style: Style, mode: Mode) {
  if (!style.stroke || style.stroke === "none") return null;
  const px = style.strokeWidth ?? L.DEFAULT_STROKE_PX;
  // Width 0 means no stroke, not PDF's "thinnest device line" hairline.
  if (px <= 0) return null;
  return {
    color: mode === "art" ? fillColor(style.stroke) : maskColor(strokeLayerOf(style)),
    w: px * L.PX,
  };
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

/** Filled glyph copies halfway through the intended outside stroke. pdf.js's
 *  path-font renderer (required in rasterWorker, where DOM fonts do not exist)
 *  can leave the inner half of a wide text stroke unpainted around tiny glyph
 *  features even though PDF/Poppler renders the true stroke solid. These
 *  copies bridge only that interior: at radius w/2 their outermost ink stays
 *  inside the real w-wide stroke envelope, so the true PDF stroke below still
 *  owns the smooth outer edge and print geometry. The radius comes from the
 *  live per-element width — no punctuation-specific size or default. */
/** Placement shared by the stroke helpers below — one spelling so an added
 *  option (say, letter-spacing) can't drift between them. */
type TextAt = { x: number; y: number; size: number; font: PDFFont; rotate?: Rotation };

function bridgeTextStroke(
  page: PDFPage,
  stroke: { color: Color; w: number },
  txt: string,
  opts: TextAt,
) {
  const radius = stroke.w / 2;
  // Keep adjacent samples within about 0.4pt, the same printer-scale bound
  // used by the former perimeter-only stroke approximation. This ring is
  // interior-only and the true stroke still supplies the perimeter.
  // The UI's 60px maximum asks for 57 samples. The ceiling is only a
  // backstop for hand-edited project files so one extreme width cannot turn
  // every text run into an unbounded number of PDF operators.
  const count = Math.min(64, Math.max(8, Math.ceil((2 * Math.PI * radius) / 0.4)));
  for (let i = 0; i < count; i++) {
    const angle = (i * 2 * Math.PI) / count;
    page.drawText(txt, {
      ...opts,
      x: opts.x + radius * Math.cos(angle),
      y: opts.y + radius * Math.sin(angle),
      color: stroke.color,
    });
  }
}

/** One text run with its outer stroke: the Tr-2 stroke pass (whose drawText
 *  must carry the STROKE color — Tr 2 fills the glyph body too), then the
 *  fill copy on top. Owning both passes here keeps the order and the stroke
 *  pass's color out of caller hands. A null stroke is just the fill draw. */
function strokedText(
  page: PDFPage,
  stroke: ReturnType<typeof strokeOf>,
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

/** Draw a collab logo fitted into `box` (scaled by the slot's `scale` knob),
 *  anchored at `top` and either left-aligned at `x` or centered on `cx`.
 *  Vector art is recolored and stroked per the slot's style, exactly like the
 *  laurel. Raster art draws as-is in the art PDF; the mask paints its footprint
 *  blue so a full-color logo prints on white ink rather than on the metallic
 *  texture. Async only because embedding a raster needs the document. */
async function drawCollab(
  doc: PDFDocument,
  page: PDFPage,
  img: CollabImage,
  slot: CollabSlot,
  mode: Mode,
  box: { x?: number; cx?: number; top: number; maxW: number; maxH: number },
): Promise<void> {
  const maxW = box.maxW * slot.scale;
  const maxH = box.maxH * slot.scale;
  // offsetY nudges the laid-out position (flowed, for the left slot) rather
  // than replacing it — see Positioned.
  const top = box.top + (slot.offsetY ?? 0);
  const place = (w: number) => (box.cx !== undefined ? box.cx - w / 2 : box.x!);
  if (img.kind === "svg") {
    const art = parseLogo(img.svg, maxW, maxH);
    const at = { x: place(art.w), y: y(top) };
    const color = mode === "art" ? fillColor(slot.fill) : maskColor(slot.layer);
    // Same two-pass order as the laurel: every stroke path before any fill, so
    // overlapping strokes can't paint over a neighbour's fill.
    const stroke = strokeOf(slot, mode);
    if (stroke)
      for (const d of art.paths)
        page.drawSvgPath(d, {
          ...at, color: stroke.color, borderColor: stroke.color, borderWidth: 2 * stroke.w,
        });
    for (const d of art.paths) page.drawSvgPath(d, { ...at, color });
    return;
  }
  const emb =
    img.kind === "png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
  const s = Math.min(maxW / emb.width, maxH / emb.height);
  const w = emb.width * s;
  const h = emb.height * s;
  const rect = { x: place(w), y: y(top + h), width: w, height: h };
  if (mode === "art") page.drawImage(emb, rect);
  else page.drawRectangle({ ...rect, color: toRgb(L.COLORS.maskBlue) });
}

/** The barcode, in both modes. `cfg` (not just the UPC digits) because both
 *  branches below resolve their geometry from the same barcode* style fields
 *  — see S. */
export function drawBarcode(page: PDFPage, fonts: Fonts, cfg: LabelConfig, mode: Mode) {
  const B = L.BARCODE;
  // Resolved outer-stroke width, in points — from the shared resolver in
  // ../barcode, which the PSD builder reads too. BOTH branches below read
  // this one value: if the mask's footprint stopped matching the art's ink
  // extent, the white-ink plate would fringe against the printed artwork.
  const S = barcodeStrokePt(cfg);
  // Rotated layout: bars run horizontally, the code advances bottom-to-top,
  // and the digits column sits to the RIGHT of the bars — the same
  // arrangement JsBarcode renders, turned a quarter turn. The geometry
  // itself is shared with the PSD builder (see ../barcode), and BOTH modes
  // below read the same bars/digits so the mask's footprint can't drift
  // from what the art pass actually inks.
  const geo = barcodeGeometry(cfg.upc, (t) => fonts.regular.widthOfTextAtSize(t, B.textSize));
  // y() of a run's lowest module IS the rect's bottom edge in PDF space, so
  // the top-origin box converts by its far edge.
  const bars = geo.bars.map((b) => ({
    x: b.x, y: y(b.yTop + b.h), width: b.w, height: b.h,
  }));
  // rotate(90) turns the glyph body toward -x, so `x` is the baseline and the
  // digits grow back toward the bars from it. `w` (the glyph run's length)
  // is kept alongside for the mask's digit pills below.
  const digits = geo.digits.map((d) => {
    const w = fonts.regular.widthOfTextAtSize(d.text, B.textSize);
    return { txt: d.text, x: d.x, y: y(geo.bottom - d.center * geo.mod) - w / 2, w };
  });
  const glyph = { size: B.textSize, font: fonts.regular, rotate: degrees(90) };

  if (mode === "mask") {
    // Stroke and fill have independent mask plates. Paint the expanded stroke
    // footprint first, then the exact fill footprint on top so unlike plate
    // choices leave the outer halo visible and the bars/digits retain their
    // own assignment. When both plates match, one expanded pass is the same
    // flattened result and preserves the compact legacy stream.
    const measure = (t: string) => fonts.regular.widthOfTextAtSize(t, B.textSize);
    const fillLayer = cfg.barcodeLayer;
    const strokeLayer = cfg.barcodeStrokeLayer;
    // A non-zero outset draws as a centered border of 2*outset on the BASE
    // footprint instead of a pre-outset rectangle: with the page's round line
    // join (see newDoc) that rounds each corner at radius `outset`, matching
    // the art pass's halo and the PSD's outside-stroke effect. The old outset
    // rectangles were square-cornered, leaving the white-ink plate overhanging
    // the art ink by a corner nib at every bar and digit-pill corner.
    const drawFootprint = (outset: number, color: ReturnType<typeof maskColor>) => {
      for (const r of barcodeFootprint(geo, 0, measure))
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
  // white shape without a backing box.
  if (S > 0) {
    const strokeColor = fillColor(cfg.barcodeStroke);
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
  const ink = fillColor(cfg.barcodeFill);
  for (const r of bars) page.drawRectangle({ ...r, color: ink });
  for (const d of digits) page.drawText(d.txt, { ...glyph, x: d.x, y: d.y, color: ink });
}

async function drawElements(
  doc: PDFDocument,
  page: PDFPage,
  fonts: Fonts,
  cfg: LabelConfig,
  assets: Assets,
  mode: Mode,
) {
  // Hidden layers skip BOTH modes — no ink, no stroke, no mask footprint.
  // Layout is untouched: everything else stays exactly where it was, so
  // toggling a layer's eye never reflows its neighbours.
  const hide = (id: ElementId) => !!assets.hidden?.has(id);

  // Every text run on the label, placed once by plan.ts — the same
  // computation hittest.ts uses — measured here with the actual embedded
  // PDFFont widths so the built bytes place text exactly as before.
  const faceFont = (f: Face) =>
    f === "bold" ? fonts.bold : f === "semibold" ? fonts.semibold : fonts.regular;
  const pdfMeasure: MeasureFace = (t, size, f) => faceFont(f).widthOfTextAtSize(t, size);
  const plan = planLabel(cfg, pdfMeasure, {
    skip: assets.hidden,
    collab: { left: !!assets.collabLeft, center: !!assets.collabCenter },
  });
  const drawPlaced = (r: PlacedText) => {
    const color = mode === "art" ? fillColor(r.fill) : maskColor(r.layer);
    const stroke = r.stroke
      ? { color: mode === "art" ? fillColor(r.stroke.fill) : maskColor(r.stroke.layer), w: r.stroke.w }
      : null;
    withTracking(page, r.tracking || undefined, () =>
      strokedText(page, stroke, r.text, {
        x: r.x, y: y(r.y), size: r.size, font: faceFont(r.face), color,
        ...(r.rotated ? { rotate: degrees(90) } : {}),
      }));
  };
  // The ids drawn OUTSIDE the single "everything else" pass below — each
  // has its own fixed slot in drawElements' order because a non-text
  // element (the collab image, the laurel) is interleaved between it and
  // its neighbours. Keep this in sync with plan.ts's element walk: a new
  // left-column or early-drawn text element that isn't added here silently
  // falls into the "rest" pass at the bottom instead.
  const LEFT: ReadonlySet<ElementId> = new Set(["volume", "abv", "description", "collabLead"]);

  // Left column: volume, abv, description, and the collab lead-in text.
  plan.filter((r) => LEFT.has(r.id)).forEach(drawPlaced);

  // Left collab logo, flowed under the description. The lead-in text above
  // already carries its own gate (cfg.collabEnabled && a left logo present);
  // this block draws only the image.
  const desc = parseDescription(cfg.description, cfg.descStyle);
  if (cfg.collabEnabled && assets.collabLeft && !hide("collabLeft")) {
    const flow = L.collabLeftFlow(desc.lines.length);
    await drawCollab(doc, page, assets.collabLeft, cfg.collabLeft, mode, {
      x: L.COLLAB_LEFT.x, top: flow.logoTop,
      maxW: L.COLLAB_LEFT.maxW, maxH: L.COLLAB_LEFT.maxH,
    });
  }

  // Center column. Wordmark draws in its own pre-laurel slot, matching the
  // original draw order exactly: the laurel's stack nudge (logoNudge,
  // cfg.logo.offsetY — see below) is user-controlled and unbounded, so a
  // large nudge CAN drag the laurel up into the wordmark's ink. Drawing the
  // wordmark after the laurel would let that nudge silently flip which one
  // paints on top; keeping this slot preserves the shipped z-order (wordmark
  // over laurel) regardless of the nudge.
  plan.filter((r) => r.id === "wordmark").forEach(drawPlaced);
  // The laurel's geometry is computed even when hidden: the centre collab
  // mark hangs off logoCy below, and hiding the laurel must not move it.
  const logo = parseLogo(assets.logoSvg, L.LOGO.w);
  const logoColor = mode === "art" ? fillColor(cfg.logo.fill) : maskColor(cfg.logo.layer);
  const logoCy = L.LOGO.cy + logoNudge(cfg);
  const logoAt = { x: L.LOGO.cx - logo.w / 2, y: y(logoCy - logo.h / 2) };
  // Outer stroke: a centered border at 2w extends w beyond the shape; the
  // fill pass on top then covers the inner half. All stroke paths draw
  // before any fill so overlapping laurel branches keep clean edges.
  const logoStroke = hide("logo") ? null : strokeOf(cfg.logo, mode);
  if (logoStroke)
    for (const d of logo.paths)
      page.drawSvgPath(d, {
        ...logoAt,
        color: logoStroke.color,
        borderColor: logoStroke.color,
        borderWidth: 2 * logoStroke.w,
      });
  if (!hide("logo"))
    for (const d of logo.paths) page.drawSvgPath(d, { ...logoAt, color: logoColor });
  // Center collab logo hangs under the laurel.
  if (cfg.collabEnabled && assets.collabCenter && !hide("collabCenter"))
    await drawCollab(doc, page, assets.collabCenter, cfg.collabCenter, mode, {
      cx: L.COLLAB_CENTER.cx,
      // Hangs off the laurel's nudged bottom, so moving the laurel carries
      // the collab mark with it and the pair keeps its gap — the centre stack
      // moves as one. This slot has no nudge of its own (see types.ts).
      top: logoCy + logo.h / 2 + L.COLLAB_CENTER.gapAbove,
      maxW: L.COLLAB_CENTER.maxW, maxH: L.COLLAB_CENTER.maxH,
    });

  // Remaining text: beer name, style line, the rotated handle / address,
  // warning, and store-cold — in that order (plan.ts's order, matching
  // drawElements' historical draw order for these five; wordmark was
  // already drawn above, in its own pre-laurel slot).
  //
  // One deliberate paint-order move versus the pre-plan build, between
  // non-overlapping elements: the QR below now draws after storeCold
  // instead of before handleAddress — the QR touches nothing in the rotated
  // column.
  plan.filter((r) => !LEFT.has(r.id) && r.id !== "wordmark").forEach(drawPlaced);

  // QR — payload derived from the beer name; optional stroked underlay.
  if (!hide("qr")) {
    const shapes = qrShapes(qrUrl(displayName(cfg)));
    const qrAt = { x: L.QR.x, y: y(L.QR.yTop) };
    if (cfg.qrStroke !== "none")
      page.drawSvgPath(
        qrPath(shapes, L.QR.size, (cfg.qrStrokeWidth ?? L.DEFAULT_STROKE_PX) * L.PX),
        {
          ...qrAt,
          color: mode === "art"
            ? fillColor(cfg.qrStroke)
            : maskColor(cfg.qrStrokeLayer),
        },
      );
    const qrColor = mode === "art" ? fillColor(cfg.qrFill) : maskColor(cfg.qrLayer);
    page.drawSvgPath(qrPath(shapes, L.QR.size), { ...qrAt, color: qrColor });
  }

  // Barcode
  if (!hide("barcode")) drawBarcode(page, fonts, cfg, mode);
}

async function newDoc(assets: Assets): Promise<{ doc: PDFDocument; page: PDFPage; fonts: Fonts }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts: Fonts = {
    regular: await doc.embedFont(assets.fonts.regular, { subset: true }),
    semibold: await doc.embedFont(assets.fonts.semibold, { subset: true }),
    bold: await doc.embedFont(assets.fonts.bold, { subset: true }),
  };
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
 *  layout.ts's positions are page-absolute at MEASURED_BLEED (see BLEED_SHIFT),
 *  so a changed bleed slides the page edge out from under them. One `cm` on the
 *  content stream puts them back — the alternative is adding the shift to the
 *  `y()` helper and to the x of every draw call in this file, forty-odd chances
 *  to miss one.
 *
 *  PDF space is y-up, so a downward shift is negative. It goes in AFTER the
 *  page-covering paints (the texture, the mask's flood coats) and BEFORE
 *  drawElements: those cover the page and must not move with the design.
 *
 *  Emits nothing at the shipped bleed, so the built bytes are unchanged. */
function shiftForBleed(page: PDFPage) {
  if (L.BLEED_SHIFT) page.pushOperators(translate(L.BLEED_SHIFT, -L.BLEED_SHIFT));
}

/** Cover-fit an embedded image over the full bleed page, centered. */
function coverPage(page: PDFPage, img: { width: number; height: number }) {
  const s = Math.max(L.PAGE.w / img.width, L.PAGE.h / img.height);
  const w = img.width * s;
  const h = img.height * s;
  return { x: (L.PAGE.w - w) / 2, y: (L.PAGE.h - h) / 2, width: w, height: h };
}

export async function buildArtPdf(cfg: LabelConfig, assets: Assets): Promise<Uint8Array> {
  const { doc, page, fonts } = await newDoc(assets);
  if (assets.texture) {
    const img =
      assets.texture.kind === "png"
        ? await doc.embedPng(assets.texture.bytes)
        : await doc.embedJpg(assets.texture.bytes);
    page.drawImage(img, coverPage(page, img));
  }
  shiftForBleed(page);
  await drawElements(doc, page, fonts, cfg, assets, "art");
  doc.setTitle(`${displayName(cfg)} label art`);
  return doc.save();
}

export async function buildMaskPdf(cfg: LabelConfig, assets: Assets): Promise<Uint8Array> {
  const { doc, page, fonts } = await newDoc(assets);
  // White page = knockout by default; the recolored mask paints the blue
  // (white ink) regions, then elements knock out or add ink on top.
  page.drawRectangle({ x: 0, y: 0, width: L.PAGE.w, height: L.PAGE.h, color: rgb(1, 1, 1) });
  if (assets.maskPng) {
    const img = await doc.embedPng(assets.maskPng);
    page.drawImage(img, coverPage(page, img));
  } else {
    // No mask uploaded yet: flood the whole plate with white ink rather than
    // leaving it knocked out. "No mask" means "print as a white label" —
    // white ink everywhere, with only the metallic elements (drawn next, in
    // drawElements) knocking back out to bare stock. This MUST land before
    // drawElements so metallic knockouts still win on top of the flood.
    page.drawRectangle({ x: 0, y: 0, width: L.PAGE.w, height: L.PAGE.h, color: toRgb(L.COLORS.maskBlue) });
  }
  shiftForBleed(page);
  await drawElements(doc, page, fonts, cfg, assets, "mask");
  doc.setTitle(`${displayName(cfg)} white-ink layer`);
  return doc.save();
}
