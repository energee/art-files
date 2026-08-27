// build.ts — builds the two deliverable PDFs with pdf-lib. drawElements walks
// the plan (see ../plan) in draw order once per mode: in "art" mode elements
// draw with their fill color over the texture; in "mask" mode metallic
// elements knock out (white) and white-layer elements paint mask blue. Both
// modes share the exact same geometry, so the pair stays registered.
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
import type { Fill, LabelConfig } from "../types";
import type { ElementId } from "../elements";
import { bridgeOffsets } from "../strokes";
import { displayName } from "../defaults";
import {
  planLabel,
  type Face,
  type MeasureFace,
  type Mode,
  type PlacedBarcode,
  type PlacedText,
  type PlanArt,
} from "../plan";
import * as L from "../layout";

/** A collab brewery's logo: vector source (recolored by its slot's style, like
 *  the laurel) or raster bytes (drawn as-is, over white ink). */
export type CollabImage =
  | { kind: "svg"; svg: string }
  | { kind: "png" | "jpg"; bytes: Uint8Array };

export interface Assets {
  fonts: { regular: Uint8Array; semibold: Uint8Array; bold: Uint8Array };
  /** Raw contents of logo2025.svg. */
  logoSvg: string;
  /** Collab logos. A slot with no image draws nothing (and an empty left
   *  slot also suppresses the "A collaborative project with" lead-in).
   *  There is no collab switch to consult: on a non-collab label the Collab
   *  variant is off, so its three layers are in the resolver's disabled set
   *  — which reaches this build as `hidden` — and the app hands over no
   *  collab art for them in the first place. */
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
  /** Custom image layers' intrinsic aspect ratio (w/h) plus, once decoded,
   *  the loaded art's own shape — same PlanAssets.custom shape planLabel
   *  reads (see its own comment): an `art.kind === "svg"` entry switches
   *  planLabel to an ink-tight `paths` fit instead of the rect this raster
   *  path still uses. Feeds the plan's rect/paths math; raster bytes to embed
   *  live in `customImages` below. */
  custom?: Record<string, { aspect: number; art?: PlanArt }>;
  /** Custom image layers' bytes, keyed by CustomImageLayer's `asset`. A key
   *  absent (bytes not loaded, or an SVG source — raster embedding only for
   *  now) leaves that layer's item a no-op on both plates, same contract as
   *  a missing collab slot. */
  customImages?: Record<string, CollabImage>;
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
  const B = L.BARCODE;
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

async function drawElements(
  doc: PDFDocument,
  page: PDFPage,
  fonts: Fonts,
  cfg: LabelConfig,
  assets: Assets,
  mode: Mode,
) {
  const faceFont = (f: Face) =>
    f === "bold" ? fonts.bold : f === "semibold" ? fonts.semibold : fonts.regular;
  const pdfMeasure: MeasureFace = (t, size, f) => faceFont(f).widthOfTextAtSize(t, size);

  // Raster collab logos embed first: the plan places by intrinsic pixel
  // size, and the embedded image is what the art pass draws. Keyed by id so
  // the walk below can find its bytes again.
  const embedded = new Map<ElementId, Awaited<ReturnType<typeof doc.embedPng>>>();
  const planArt = async (id: ElementId, img: CollabImage | null | undefined): Promise<PlanArt | null> => {
    // Hidden means no ink AND no embedded bytes: a layer the UI's eye has
    // hidden must not survive into the saved PDF even as an unreferenced
    // XObject, so this early-return has to check the same skip set planLabel
    // uses to omit the drawn item — bailing here keeps the raster off the
    // page before doc.embedPng/embedJpg ever runs.
    if (!img || assets.hidden?.has(id)) return null;
    if (img.kind === "svg") return img;
    const emb = img.kind === "png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
    embedded.set(id, emb);
    return { kind: "raster", w: emb.width, h: emb.height };
  };

  // Custom-layer images: embed each layer's asset bytes up front, keyed by
  // the layer's own id — same `embedded` map as the collab logos, so the
  // walk below needs no special case. A missing asset (bytes not loaded, or
  // an SVG source — this pipeline only embeds raster) stays a no-op: the
  // plan can place the item from a stored aspect alone, matching the canvas
  // backend's contract and the byte-identity lock.
  for (const layer of cfg.customLayers ?? []) {
    if (layer.type !== "image" || assets.hidden?.has(layer.id)) continue;
    const img = assets.customImages?.[layer.asset];
    if (!img || img.kind === "svg") continue;
    const emb = img.kind === "png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
    embedded.set(layer.id, emb);
  }

  // The complete label, placed once by plan.ts in draw order — the same
  // list hittest groups its text boxes from — measured with the actual
  // embedded PDFFont widths so the built bytes place text exactly as before.
  const plan = planLabel(cfg, pdfMeasure, {
    skip: assets.hidden,
    // Presence, not what planArt returned: a hidden logo yields no art (no
    // embedded bytes) but still holds its slot, so the "A collaborative
    // project with" lead-in stays — exactly what the preview draws.
    collab: { left: !!assets.collabLeft, center: !!assets.collabCenter },
    assets: {
      logoSvg: assets.logoSvg,
      collabLeft: await planArt("collabLeft", assets.collabLeft),
      collabCenter: await planArt("collabCenter", assets.collabCenter),
      custom: assets.custom,
    },
  });

  const drawText = (r: PlacedText) => {
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

  for (const r of plan) {
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
    } else if (r.kind === "image") {
      // The plan can place an image item (collab or custom) whose bytes
      // never made it into `embedded` — a custom layer's rect can come from
      // a stored aspect alone (see plan.ts), with no bytes loaded yet, or
      // ever. Skip the whole item on EITHER plate rather than crash on
      // `embedded.get(r.id)!` or draw a mask footprint for art that was
      // never embedded — matching the plan's own missing-asset -> nothing
      // contract in both modes.
      if (!embedded.has(r.id)) continue;
      const rect = { x: r.x, y: y(r.y + r.h), width: r.w, height: r.h };
      if (mode === "art") page.drawImage(embedded.get(r.id)!, rect);
      // Raster art prints on white ink: the mask paints its footprint blue.
      else page.drawRectangle({ ...rect, color: toRgb(L.COLORS.maskBlue) });
    } else drawBarcode(page, fonts, r, mode);
  }
}

async function newDoc(assets: Assets): Promise<{ doc: PDFDocument; page: PDFPage; fonts: Fonts }> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(PDF_EPOCH);
  doc.setModificationDate(PDF_EPOCH);
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

/** Cover-fit an embedded image over the full bleed page, centered. Delegates
 *  to L.coverFit, the geometry the canvas backend shares. */
function coverPage(page: PDFPage, img: { width: number; height: number }) {
  const r = L.coverFit(img.width, img.height);
  return { x: r.x, y: r.y, width: r.w, height: r.h };
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
