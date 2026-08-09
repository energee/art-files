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
  translate,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { CollabSlot, Fill, LabelConfig, Style, StyledLine } from "../types";
import type { ElementId } from "../elements";
import { parseLogo } from "../logo";
import { WARNING_TEXT, displayAbv, displayName, displayStyle } from "../defaults";
import * as L from "../layout";
import { barcodeFootprint, barcodeGeometry, barcodeStrokePt } from "../barcode";
import { qrPath, qrShapes, qrUrl } from "../qr";
import { parseDescription, parseInfoLine, parseRuns } from "../description";
import { warningColumnLen, wrapWarning } from "../warning";

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
  /** Mask recolored to blue/transparent (see maskimage.ts), re-encoded as
   *  PNG. Optional: without it buildMaskPdf floods the whole page white-ink
   *  blue instead ("no mask" = "print as a white label"), and the per-element
   *  assignments (metallic knockouts, white-layer ink) draw on top of that. */
  maskPng?: Uint8Array;
  /** Elements the UI's layers-panel eye has hidden: skipped entirely — ink,
   *  stroke AND mask footprint. Distinct from fill "none", which is a live
   *  style meaning "no ink / knockout white". Session state, not config: a
   *  saved label file never records a hidden layer. */
  hidden?: ReadonlySet<ElementId>;
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

/** Outer-stroke params for an element (art mode only), or null when off.
 *  Widths are authored in px at the 600dpi deliverable.
 *
 *  Strokes never draw on the MASK plate (Ted's ask, 2026-08-05), on any
 *  layer: the mask keeps whatever its flood and the element's own
 *  glyphs/paths put there, so a keyline neither knocks out white ink nor
 *  adds any. */
function strokeOf(style: Style, mode: Mode) {
  if (mode !== "art" || !style.stroke || style.stroke === "none") return null;
  return {
    color: fillColor(style.stroke),
    w: (style.strokeWidth ?? L.DEFAULT_STROKE_PX) * L.PX,
  };
}

/** pdf-lib can't stroke text, so an outer stroke is faked as a ring of
 *  offset copies drawn under the fill. The sample count scales with the
 *  radius — a fixed count leaves adjacent copies 2w*sin(pi/n) apart, which
 *  at a wide stroke reads as stair-steps down the outer edge. One sample
 *  per ~0.4pt of circumference keeps that step below a printer's dot. */
// Memoized: every element in a config shares one stroke width, so this table
// is built once per build instead of once per line. Keyed by width, which is
// the only input.
const RINGS = new Map<number, [number, number][]>();

function ring(w: number): [number, number][] {
  const hit = RINGS.get(w);
  if (hit) return hit;
  const built = buildRing(w);
  RINGS.set(w, built);
  return built;
}

function buildRing(w: number): [number, number][] {
  // Capped only as a backstop: each sample is its own drawText, so an
  // uncapped count would let a stroke width become a build-time amplifier
  // (600px measured at ~18k calls / 700ms, outlasting the 600ms debounce).
  // The UI now clamps width at 60px (StyleProperties' stroke-width input),
  // i.e. 7.2pt, where the 0.4pt rule asks for n = 114 — so the ceiling sits
  // at 128 and never binds in practice. The old cap of 64 DID bind above
  // ~34px and broke the spacing guarantee: at 60px it left adjacent copies
  // 2w*sin(pi/64) ~ 0.71pt apart, ~6 device dots at 600dpi, which prints as
  // a visibly scalloped outer edge.
  const n = Math.min(128, Math.max(16, Math.ceil((2 * Math.PI * w) / 0.4)));
  return Array.from({ length: n }, (_, i) => {
    const a = (i * 2 * Math.PI) / n;
    return [w * Math.cos(a), w * Math.sin(a)];
  });
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

function drawLine(
  page: PDFPage,
  fonts: Fonts,
  line: StyledLine,
  mode: Mode,
  opts: { x?: number; cx?: number; baseline: number; size: number; font?: PDFFont },
) {
  // Inline runs: a marker-free line yields one run identical to the line, so
  // this is the old single drawText path with an extra loop around it.
  // opts.font (the wordmark/name's forced Bold face) still wins outright —
  // those slots are one face by design, markers or not.
  const runs = parseRuns(line);
  const faceOf = (r: StyledLine) => opts.font ?? (r.bold ? fonts.semibold : fonts.regular);
  const tracking = line.letterSpacing;
  // Measured once and reused as the per-run advance below, rather than
  // measuring each run again while walking it.
  const advances = L.runAdvances(
    runs, (r) => faceOf(r).widthOfTextAtSize(r.text, opts.size), tracking,
  );
  // Centring measures the TRACKED width, not the font's — at 0 tracking the
  // two are identical, so this is the same math as before for untracked text.
  const total = advances.reduce((a, b) => a + b, 0) - (tracking ?? 0);
  let x = opts.cx !== undefined ? opts.cx - total / 2 : opts.x!;
  const yBase = y(opts.baseline);
  const stroke = strokeOf(line, mode);
  withTracking(page, tracking, () => {
    runs.forEach((run, i) => {
      const font = faceOf(run);
      // Colour is per RUN: `_white ink_` moves that span to the mask plate,
      // which in art mode means it must not paint at all (fillColor("none")
      // handles a none-fill; the mask pass paints it instead).
      const color = mode === "art" ? fillColor(run.fill) : maskColor(run.layer);
      const at = { y: yBase, size: opts.size, font };
      if (stroke)
        for (const [dx, dy] of ring(stroke.w))
          page.drawText(run.text, { ...at, x: x + dx, y: yBase + dy, color: stroke.color });
      page.drawText(run.text, { ...at, x, color });
      x += advances[i];
    });
  });
}

/** Rotated 90deg CCW text (reads bottom-to-top). x = baseline vertical line,
 *  yStart = where the first character sits (toward the label bottom). */
function drawRotated(
  page: PDFPage,
  font: PDFFont,
  text: string,
  mode: Mode,
  style: Style,
  opts: { x: number; yStart: number; size: number },
  /** Face for `**bold**` runs. Omitted (the warning's justified words, which
   *  carry no markers of their own) means inline bold just keeps `font`. */
  boldFont?: PDFFont,
) {
  // Same inline-run treatment as drawLine, advancing along the rotated
  // baseline (+y, since the text reads bottom-to-top) instead of x. `font`
  // is the caller's face for unmarked text; a `**bold**` run steps up to
  // Bold, which is the only face above the semibold this column uses.
  const runs = parseRuns({ ...style, text });
  const tracking = style.letterSpacing;
  const advances = L.runAdvances(
    runs, (r) => (r.bold ? boldFont ?? font : font).widthOfTextAtSize(r.text, opts.size), tracking,
  );
  const stroke = strokeOf(style, mode);
  let yPos = y(opts.yStart);
  withTracking(page, tracking, () => {
    runs.forEach((run, i) => {
      const face = run.bold ? boldFont ?? font : font;
      const color = mode === "art" ? fillColor(run.fill) : maskColor(run.layer);
      const base = { size: opts.size, font: face, rotate: degrees(90) };
      if (stroke)
        for (const [dx, dy] of ring(stroke.w))
          page.drawText(run.text, { ...base, x: opts.x + dx, y: yPos + dy, color: stroke.color });
      page.drawText(run.text, { ...base, x: opts.x, y: yPos, color });
      yPos += advances[i];
    });
  });
}

/** Like drawRotated, but for a warning column: stretches inter-word gaps so
 *  the line's run reaches EXACTLY `opts.maxLen` (full justification — no
 *  ragged final column). Draws word-by-word, reusing drawRotated's per-word
 *  coordinate math rather than a second rotated-text scheme: each word is
 *  its own drawRotated call, advanced along the run by that word's width
 *  plus the stretched gap. A single-word line has no gap to stretch and
 *  falls back to one plain drawRotated call at its natural length — see
 *  warningColumnLen. */
export function drawJustifiedRotated(
  page: PDFPage,
  font: PDFFont,
  text: string,
  mode: Mode,
  style: Style,
  opts: { x: number; yStart: number; size: number; maxLen: number },
) {
  const words = text.split(" ");
  if (words.length < 2) {
    drawRotated(page, font, text, mode, style, opts);
    return;
  }
  // Tracked widths: the gap that justifies the line has to be computed
  // against the length each word actually draws at, or a tracked warning
  // column overshoots maxLen by one gap per glyph.
  const widths = words.map((w) =>
    L.trackedWidth(font.widthOfTextAtSize(w, opts.size), w, style.letterSpacing));
  const totalWordWidth = widths.reduce((a, b) => a + b, 0);
  // The gap that makes sum(widths) + (n-1)*gap land exactly on maxLen.
  const gap = (opts.maxLen - totalWordWidth) / (words.length - 1);
  // The run advances from yStart toward SMALLER yStart (drawRotated's
  // "reads bottom-to-top": later characters/words sit at a smaller top-
  // origin y) — see drawRotated's doc comment.
  let cursor = opts.yStart;
  words.forEach((w, i) => {
    drawRotated(page, font, w, mode, style, { x: opts.x, yStart: cursor, size: opts.size });
    cursor -= widths[i] + gap;
  });
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
    // The true footprint the art pass inks, from the shared resolver the PSD
    // builder paints too (see barcodeFootprint). Top-origin rects convert to
    // PDF space by their far edge, exactly like the bars above.
    const color = maskColor(cfg.barcodeLayer);
    const measure = (t: string) => fonts.regular.widthOfTextAtSize(t, B.textSize);
    for (const r of barcodeFootprint(geo, S, measure))
      page.drawRectangle({ x: r.x, y: y(r.yTop + r.h), width: r.w, height: r.h, color });
    return;
  }

  // Outer stroke, skipped entirely at S = 0 — ring(0) would emit 16 identical
  // copies at zero offset. EVERY stroke shape draws before ANY fill one —
  // that ordering is what makes this safe. Interleaving the two (an underlay
  // per bar, then its bar) lets a later stroke bite into an already-drawn
  // neighbour, which distorted the module widths until the code stopped
  // decoding. Between the dense bars the stroke closes into a solid field
  // and around the digits it reads as a pill, matching the reference's
  // white shape without a backing box.
  if (S > 0) {
    const strokeColor = fillColor(cfg.barcodeStroke);
    const ringS = ring(S); // loop-invariant
    // A centered border at 2S extends S beyond the bar and — because the page
    // sets a ROUND line join (see newDoc) — rounds each corner at radius S,
    // which is what Photoshop's outside stroke does and what the PSD's real
    // stroke effect produces. The old outset rectangle was square-cornered,
    // the one place the PDF's barcode halo visibly diverged from the PSD.
    for (const r of bars)
      page.drawRectangle({
        ...r, color: strokeColor, borderColor: strokeColor, borderWidth: 2 * S,
      });
    for (const d of digits)
      for (const [dx, dy] of ringS)
        page.drawText(d.txt, { ...glyph, x: d.x + dx, y: d.y + dy, color: strokeColor });
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

  // Left column
  if (!hide("volume"))
    drawLine(page, fonts, cfg.volume, mode, { x: L.VOLUME.x, baseline: L.VOLUME.baseline, size: L.VOLUME.size });
  if (!hide("abv"))
    drawLine(page, fonts, { text: `${displayAbv(cfg)}% alc by vol`, ...cfg.abvStyle }, mode, {
      x: L.ABV.x, baseline: L.ABV.baseline, size: L.ABV.size,
    });
  const desc = parseDescription(cfg.description, cfg.descStyle);
  if (!hide("description")) {
    if (desc.header)
      drawLine(page, fonts, desc.header, mode, {
        x: L.DESC_HEADER.x, baseline: L.DESC_HEADER.baseline, size: L.DESC_HEADER.size,
      });
    desc.lines.forEach((line, i) =>
      drawLine(page, fonts, line, mode, {
        x: L.DESC.x, baseline: L.DESC.firstBaseline + i * L.DESC.leading, size: L.DESC.size,
      }),
    );
  }

  // Left collab logo, flowed under the description with its lead-in. The
  // lead-in is drawn in SemiBold like the reference label's, and only when
  // there is actually a left logo for it to introduce.
  if (cfg.collabEnabled && assets.collabLeft) {
    const flow = L.collabLeftFlow(desc.lines.length);
    if (!hide("collabLead"))
      L.COLLAB_LEAD.lines.forEach((text, i) =>
        drawLine(page, fonts, { text, ...cfg.collabLead, bold: true }, mode, {
          x: L.COLLAB_LEAD.x, baseline: flow.leadBaselines[i], size: L.COLLAB_LEAD.size,
        }),
      );
    if (!hide("collabLeft"))
      await drawCollab(doc, page, assets.collabLeft, cfg.collabLeft, mode, {
        x: L.COLLAB_LEFT.x, top: flow.logoTop,
        maxW: L.COLLAB_LEFT.maxW, maxH: L.COLLAB_LEFT.maxH,
      });
  }

  // Center column. Wordmark and beer name use the Bold face — the reference
  // label sets both in the same heavy weight.
  if (!hide("wordmark"))
    drawLine(page, fonts, { text: L.WORDMARK.text, ...cfg.wordmark, bold: true }, mode, {
      cx: L.WORDMARK.cx, baseline: L.WORDMARK.baseline, size: L.WORDMARK.size, font: fonts.bold,
    });
  // The laurel's geometry is computed even when hidden: the centre collab
  // mark hangs off logoCy below, and hiding the laurel must not move it.
  const logo = parseLogo(assets.logoSvg, L.LOGO.w);
  const logoColor = mode === "art" ? fillColor(cfg.logo.fill) : maskColor(cfg.logo.layer);
  const logoCy = L.LOGO.cy + (cfg.logo.offsetY ?? 0);
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
  if (!hide("name"))
    drawLine(page, fonts, { text: displayName(cfg).toUpperCase(), ...cfg.nameStyle, bold: true }, mode, {
      cx: L.NAME.cx, baseline: L.NAME.baseline, size: L.NAME.size, font: fonts.bold,
    });
  if (!hide("styleLine"))
    drawLine(page, fonts, { ...cfg.styleLine, text: displayStyle(cfg) }, mode, {
      cx: L.STYLE_LINE.cx, baseline: L.STYLE_LINE.baseline, size: L.STYLE_LINE.size,
    });

  // QR — payload derived from the beer name; optional stroked underlay.
  if (!hide("qr")) {
    const shapes = qrShapes(qrUrl(displayName(cfg)));
    const qrAt = { x: L.QR.x, y: y(L.QR.yTop) };
    if (mode === "art" && cfg.qrStroke !== "none")
      page.drawSvgPath(
        qrPath(shapes, L.QR.size, (cfg.qrStrokeWidth ?? L.DEFAULT_STROKE_PX) * L.PX),
        { ...qrAt, color: fillColor(cfg.qrStroke) },
      );
    const qrColor = mode === "art" ? fillColor(cfg.qrFill) : maskColor(cfg.qrLayer);
    page.drawSvgPath(qrPath(shapes, L.QR.size), { ...qrAt, color: qrColor });
  }

  // Right rotated column
  // Info carries the description block's markdown subset (see parseInfoLine):
  // the markers set the face and the white-ink layer, the rest of the style
  // stays the element's own. A plain, marker-free line renders exactly as it
  // always did — semibold, on the element's layer.
  const info = parseInfoLine(cfg.handleAddress.text, cfg.handleAddress);
  if (!hide("handleAddress"))
    drawRotated(page, info.bold ? fonts.bold : fonts.semibold, info.text, mode, info, {
      x: L.HANDLE_ADDR.x, yStart: L.HANDLE_ADDR.yStart, size: L.HANDLE_ADDR.size,
    }, fonts.bold);
  // Wrapping measures with the warning's own tracking: tracked text needs
  // more columns, and hittest.ts derives its columns from the same measure.
  const warnLines = wrapWarning(
    (t) => L.trackedWidth(
      fonts.regular.widthOfTextAtSize(t, L.WARNING.size), t, cfg.warning.letterSpacing,
    ),
    L.WARNING.maxLen,
  );
  if (!hide("warning"))
    warnLines.forEach((line, i) =>
      drawJustifiedRotated(page, fonts.regular, line, mode, cfg.warning, {
        x: L.WARNING.x + i * L.WARNING.leading, yStart: L.WARNING.yStart, size: L.WARNING.size,
        maxLen: L.WARNING.maxLen,
      }),
    );
  if (!hide("storeCold"))
    // Semibold is this line's plain face; the element's bold toggle steps it up
    // to Bold, exactly as handleAddress above.
    drawRotated(page, cfg.storeCold.bold ? fonts.bold : fonts.semibold, cfg.storeCold.text, mode, cfg.storeCold, {
      x: L.STORE_COLD.x, yStart: L.STORE_COLD.yStart, size: L.STORE_COLD.size,
    });

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
