// Test-only pre-v3 layout oracle.
import type {
  CollabSlot, CustomBarcodeLayer, StyledLine, LabelConfig,
} from "../../src/types";
import { anchoredX, anchoredY, type GuideLines } from "../../src/model/position";
import { logoNudge, type ElementId } from "./elements";
import { parseRuns } from "../../src/description";
import { strokeLayerOf } from "../../src/strokes";
import * as L from "./layout";
import { displayAbv, displayName, displayStyle } from "../../src/defaults";
import { parseDescription, parseInfoLine } from "../../src/description";
import { warningMeasure, wrapWarning } from "../../src/warning";
import { parseLogo } from "../../src/logo";
import { qrPath, qrShapes, qrUrl } from "../../src/qr";
import {
  barcodeDigitsFor, barcodeFootprint, barcodeGeometry, barcodeStrokePt,
  CUSTOM_BARCODE_DIGIT_GAP_RATIO, CUSTOM_BARCODE_DIGIT_SIZE_RATIO,
  encodeFor, quietModulesFor, validateFor, type BarcodeGeometry,
} from "./barcode";

import { labelGuides, strokeSpec, lineRuns, rotatedRuns, justifiedRotatedRuns,
  type Face, type MeasureFace, type Placed, type PlacedBarcode, type PlanArt, type PlanAssets } from "./planShared";

/** Which collab logo slots hold art — the same fact hittest tracks: the
 *  renderers skip an empty slot, so its text must not be planned either. */
export interface CollabSlots { left: boolean; center: boolean }

export interface PlanOpts {
  /** Elements to omit entirely (the layers-panel eyes, and the in-place
   *  editor's session element from Phase 3 on). Layout is untouched:
   *  skipping never reflows neighbours. */
  skip?: { has(id: ElementId): boolean };
  /** Which slots hold collab art. Overrides what `assets` implies, for the
   *  caller whose art is nulled out by something other than absence: the PDF
   *  build drops a hidden logo's art so no bytes reach the file, but the
   *  lead-in it introduces has its own eye and must not vanish with it. */
  collab?: CollabSlots;
  /** With assets, planLabel emits the COMPLETE display list — text, laurel,
   *  QR, collab art, barcode — in drawElements' historical draw order.
   *  Without assets: text only, gated by opts.collab — hittest's contract. */
  assets?: PlanAssets;
}

/** A collab slot's art as placed items — drawCollab's placement without the
 *  drawing: the box scaled by the slot's scale knob, offsetY nudging the
 *  flowed position, SVG fitted ink-tight by parseLogo, raster fitted by its
 *  intrinsic aspect. */
/** The two collab slots' fit ENVELOPES — the unscaled frame each slot's art
 *  aspect-fits into. The ONE spelling shared by collabItems' call sites
 *  below and the hit-tester's envelope boxes (hittest.ts), so slot placement
 *  cannot drift between draw and hit-test. The slot's scale/offsetY knobs
 *  are applied by each consumer on top, identically (see collabItems). */
export function collabLeftFrame(descLineCount: number) {
  const flow = L.collabLeftFlow(descLineCount);
  return {
    x: L.COLLAB_LEFT.x, top: flow.logoTop,
    maxW: L.COLLAB_LEFT.maxW, maxH: L.COLLAB_LEFT.maxH,
  };
}
export function collabCenterFrame(logoBottom: number) {
  return {
    cx: L.COLLAB_CENTER.cx, top: logoBottom + L.COLLAB_CENTER.gapAbove,
    maxW: L.COLLAB_CENTER.maxW, maxH: L.COLLAB_CENTER.maxH,
  };
}

function collabItems(
  id: string,
  art: PlanArt,
  slot: CollabSlot,
  box: ({ x: number } | { cx: number }) & { top: number; maxW: number; maxH: number },
): Placed[] {
  const maxW = box.maxW * slot.scale;
  const maxH = box.maxH * slot.scale;
  const top = box.top + (slot.offsetY ?? 0);
  const place = (w: number) => ("cx" in box ? box.cx - w / 2 : box.x);
  if (art.kind === "svg") {
    const a = parseLogo(art.svg, maxW, maxH);
    return [{
      kind: "paths", id, paths: a.paths, x: place(a.w), y: top,
      fill: slot.fill, layer: slot.layer, stroke: strokeSpec(slot),
    }];
  }
  const s = Math.min(maxW / art.w, maxH / art.h);
  const w = art.w * s;
  const h = art.h * s;
  return [{ kind: "image", id, x: place(w), y: top, w, h }];
}

/** The barcode's placed item. Exported for the barcode tests, which assert
 *  paint behaviour against a hand-built item. */
export function barcodeItem(cfg: LabelConfig, m: MeasureFace): PlacedBarcode {
  const B = L.BARCODE;
  const measure = (t: string) => m(t, B.textSize, "regular");
  const geo = barcodeGeometry(cfg.upc, measure);
  return {
    kind: "barcode", id: "barcode", geo,
    S: barcodeStrokePt(cfg),
    fill: cfg.barcodeFill, stroke: cfg.barcodeStroke,
    fillLayer: cfg.barcodeLayer, strokeLayer: cfg.barcodeStrokeLayer,
    textSize: B.textSize, rotated: true,
    digits: geo.digits.map((d) => {
      const w = measure(d.text);
      return { text: d.text, x: d.x, y: geo.bottom - d.center * geo.mod + w / 2, w };
    }),
    footprint: barcodeFootprint(geo, 0, measure),
  };
}

// --- Custom barcode layers (Task 3) ---------------------------------------
// A custom barcode layer draws its own independent symbol rather than the
// template's UPC: barcodeGeometry itself stays untouched (its digits:[] rule
// for any supplied pattern is a standing ruling — see its own comment), so
// this is a small local geometry built directly from the layer's own
// moduleW/h, in a plain UPRIGHT layout (modules along X, digits a normal
// horizontal caption below the bars) — unlike the template's symbol, which
// lives pre-rotated into the page's vertical right column (modules along Y,
// digits rotated 90°). Both share PlacedBarcode/drawBarcode as the paint
// step; PlacedBarcode.rotated (false here, true for the template) is what
// lets the shared renderer (drawBarcode in pdf/build.ts and canvas/draw.ts,
// barcodeLayer in psd/build.ts) draw each orientation correctly instead of
// unconditionally rotating every digit glyph.

/** The pattern's runs merged into rects at the layer's own moduleW/h — the
 *  bar half of a custom barcode layer's geometry, mirroring barcodeGeometry's
 *  run-merging but plain (no guard elongation: a free-floating layer has no
 *  template-fixed digit column its guards need to clear). */
function customBarcodeBars(
  pattern: { modules: string }, x: number, yTop: number, h: number, moduleW: number,
): BarcodeGeometry["bars"] {
  const bars: BarcodeGeometry["bars"] = [];
  const { modules } = pattern;
  for (let i = 0; i < modules.length; ) {
    if (modules[i] !== "1") { i++; continue; }
    let j = i;
    while (j < modules.length && modules[j] === "1") j++;
    bars.push({ x: x + i * moduleW, yTop, w: (j - i) * moduleW, h });
    i = j;
  }
  return bars;
}

/** A custom barcode layer's hit/drag box size — the symbol plus BOTH quiet
 *  zones (quietModulesFor; zero for code-128) wide, `h` tall plus the digit
 *  band when shown — or null when its (raw,
 *  possibly unexpanded — see CustomBarcodeLayer.value) payload fails the
 *  symbology's own validator, so hittest/dragTarget2 and customBarcodeItem
 *  below can't disagree about which layers are even present. Exported so
 *  hittest.ts shares this exact sizing instead of re-deriving the digit-band
 *  math; elements.ts's dragTarget2 keeps its own small local copy of this
 *  function (customBarcodeDragBox — a runtime value-import back into plan.ts
 *  would make the two modules mutually dependent), but imports the SAME two
 *  ratio constants from barcode.ts that this function uses below, so the two
 *  copies' math cannot drift apart even though the functions themselves
 *  aren't shared. */
export function customBarcodeBox(
  layer: CustomBarcodeLayer,
): { w: number; h: number; quiet: number; pattern: ReturnType<typeof encodeFor> } | null {
  if (!validateFor(layer.symbology, layer.value).ok) return null;
  const pattern = encodeFor(layer.symbology, layer.value);
  const showDigits = layer.showDigits ?? true;
  const textSize = layer.h * CUSTOM_BARCODE_DIGIT_SIZE_RATIO;
  const gap = layer.h * CUSTOM_BARCODE_DIGIT_GAP_RATIO;
  // The box spans the quiet zone on BOTH sides, not just the printed symbol:
  // barcodeDigitsFor puts the UPC-A/EAN-13 leading digit at -quiet and the
  // UPC-A check digit at modulesLen + quiet, so a symbol-only box left both
  // outside it — a right-anchored UPC-A pushed its check digit past the trim
  // and the hit/drag box missed both edge digits. `quiet` is in modules and is
  // 0 for code-128, whose single centred caption needs no zone.
  const quiet = quietModulesFor(layer.symbology);
  return {
    w: (pattern.modules.length + 2 * quiet) * layer.moduleW,
    h: layer.h + (showDigits ? gap + textSize : 0),
    quiet,
    pattern,
  };
}

/** A custom barcode layer's placed item, or null when its (raw, possibly
 *  unexpanded — see CustomBarcodeLayer.value) payload fails the symbology's
 *  own validator: an invalid payload emits nothing, never a garbage symbol. */
export function customBarcodeItem(
  layer: CustomBarcodeLayer, m: MeasureFace, guides: GuideLines,
): PlacedBarcode | null {
  const box = customBarcodeBox(layer);
  if (!box) return null;
  const { pattern, quiet } = box;
  const showDigits = layer.showDigits ?? true;
  const textSize = layer.h * CUSTOM_BARCODE_DIGIT_SIZE_RATIO;
  const gap = layer.h * CUSTOM_BARCODE_DIGIT_GAP_RATIO;
  const x = anchoredX(layer.position, box.w, guides);
  const yTop = anchoredY(layer.position, box.h, guides);
  // Module 0 sits one quiet zone in from the box's left edge (the zone is
  // blank by definition, but the leading digit prints in it — see
  // customBarcodeBox), so every module coordinate below measures from here.
  const runX = x + quiet * layer.moduleW;
  const bars = customBarcodeBars(pattern, runX, yTop, layer.h, layer.moduleW);
  const measure = (t: string) => m(t, textSize, "regular");
  // barcodeDigitsFor's `measure` must return MODULE units (see its own
  // comment) since it has no `mod` to convert with — `measure` above is in
  // POINTS, so divide by moduleW before handing it in. Skipping this step
  // double-scaled the edge digits' (dir ±1) offset by moduleW a second time
  // once `center` gets multiplied back by moduleW below; centered groups
  // (dir 0) never combine measure with the anchor, so they were unaffected.
  const digitsRaw = showDigits
    ? barcodeDigitsFor(
        layer.symbology, layer.value, pattern.modules.length, quiet,
        (t) => measure(t) / layer.moduleW,
      )
    : [];
  // barcodeDigitsFor's `x` is a placeholder (see its own comment) — real x
  // comes from this layer's own run origin plus the group's module center.
  const geoDigits = digitsRaw.map((d) => ({ ...d, x: runX + d.center * layer.moduleW }));
  const geo: BarcodeGeometry = { mod: layer.moduleW, bottom: yTop + layer.h, bars, digits: geoDigits };
  const style = layer.style;
  const S = style.stroke && style.stroke !== "none"
    ? (style.strokeWidth ?? L.DEFAULT_STROKE_PX) * L.PX : 0;
  // `y` is the alphabetic BASELINE — that is what all three renderers pass to
  // their text call — so it sits at the BOTTOM of the reserved digit band, not
  // its top: `+ textSize` is the last term. Full textSize (the em box) rather
  // than a cap height, because customBarcodeBox reserves exactly `gap +
  // textSize` below the bars; putting the baseline one em down makes that band
  // the glyphs' own em box, so the box and the ink describe the same
  // rectangle. Digits have no descenders, so nothing spills below it. Without
  // the term the glyph box climbed back over the bottom of the bars while the
  // reserved band printed empty.
  const digits = geoDigits.map((d) => ({
    text: d.text, x: d.x, y: yTop + layer.h + gap + textSize, w: measure(d.text),
  }));
  // Bars, plus one em-box per digit group. Unlike barcodeFootprint (whose
  // formula assumes the template's ROTATED layout), this item is UPRIGHT:
  // each box spans the centered run (x = d.x ± w/2) and the font box around
  // its baseline. These are BASE ink, NOT pre-outset by the halo S — the
  // same contract as `barcodeFootprint(geo, 0, measure)`. The solid
  // background sizes itself from them. The plates paint the glyphs.
  const barFootprint = bars.map((b) => ({
    x: b.x, yTop: b.yTop, w: b.w, h: b.h,
  }));
  const digitFootprint = digits.map((d) => {
    const x0 = d.x - d.w / 2;
    const x1 = d.x + d.w / 2;
    const y0 = d.y - L.FONT_ASC * textSize;
    const y1 = d.y + L.FONT_DESC * textSize;
    return { x: x0, yTop: y0, w: x1 - x0, h: y1 - y0 };
  });
  return {
    kind: "barcode", id: layer.id, geo, S, rotated: false,
    fill: style.fill, stroke: style.stroke ?? "none",
    fillLayer: style.layer, strokeLayer: strokeLayerOf(style),
    textSize,
    digits,
    footprint: [...barFootprint, ...digitFootprint],
  };
}

/** Every display-list item of the label, in drawElements' order. Without
 *  `opts.assets` the list is text only — hittest's contract, and the numbers
 *  match what planLabel has always produced. With it, the laurel, QR, collab
 *  art and barcode interleave at their historical draw positions. */
export function planLabel(cfg: LabelConfig, m: MeasureFace, opts: PlanOpts = {}): Placed[] {
  const skip = (id: ElementId) => !!opts.skip?.has(id);
  const A = opts.assets;
  // One source for the slot gates: opts.collab when the caller knows which
  // slots HOLD art (hittest's booleans; the PDF build, whose art is nulled
  // out for a hidden layer), the art itself otherwise.
  const slots = opts.collab ?? { left: !!A?.collabLeft, center: !!A?.collabCenter };
  const out: Placed[] = [];

  if (!skip("volume"))
    out.push(...lineRuns("volume", cfg.volume, m,
      { x: L.VOLUME.x, baseline: L.VOLUME.baseline, size: L.VOLUME.size }));
  if (!skip("abv"))
    out.push(...lineRuns("abv", { text: `${displayAbv(cfg)}% alc by vol`, ...cfg.abvStyle }, m,
      { x: L.ABV.x, baseline: L.ABV.baseline, size: L.ABV.size }));

  const desc = parseDescription(cfg.description, cfg.descStyle);
  if (!skip("description")) {
    if (desc.header)
      out.push(...lineRuns("description", desc.header, m,
        { x: L.DESC_HEADER.x, baseline: L.DESC_HEADER.baseline, size: L.DESC_HEADER.size }));
    desc.lines.forEach((line, i) =>
      out.push(...lineRuns("description", line, m,
        { x: L.DESC.x, baseline: L.DESC.firstBaseline + i * L.DESC.leading, size: L.DESC.size })));
  }

  // Lead-in only when there is a left logo for it to introduce — the same
  // gate drawElements applies with assets.collabLeft.
  if (slots.left && !skip("collabLead")) {
    const flow = L.collabLeftFlow(desc.lines.length);
    L.COLLAB_LEAD.lines.forEach((text, i) =>
      out.push(...lineRuns("collabLead", { text, ...cfg.collabLead, bold: true }, m,
        { x: L.COLLAB_LEAD.x, baseline: flow.leadBaselines[i], size: L.COLLAB_LEAD.size })));
  }

  // Left collab art, flowed under the lead-in — drawCollab's placement.
  if (A && A.collabLeft && !skip("collabLeft"))
    out.push(...collabItems(
      "collabLeft", A.collabLeft, cfg.collabLeft, collabLeftFrame(desc.lines.length)));

  if (!skip("wordmark"))
    out.push(...lineRuns("wordmark", { text: L.WORDMARK.text, ...cfg.wordmark, bold: true }, m,
      { cx: L.WORDMARK.cx, baseline: L.WORDMARK.baseline, size: L.WORDMARK.size, face: "bold" }));

  // The laurel, and the centre collab mark hanging off its nudged bottom.
  // Geometry is computed even when the laurel is skipped: the centre mark
  // hangs off logoCy, and hiding the laurel must not move it.
  if (A) {
    const logo = parseLogo(A.logoSvg, L.LOGO.w);
    const logoCy = L.LOGO.cy + logoNudge(cfg);
    if (!skip("logo"))
      out.push({
        kind: "paths", id: "logo", paths: logo.paths,
        x: L.LOGO.cx - logo.w / 2, y: logoCy - logo.h / 2,
        fill: cfg.logo.fill, layer: cfg.logo.layer, stroke: strokeSpec(cfg.logo),
      });
    if (A.collabCenter && !skip("collabCenter"))
      out.push(...collabItems("collabCenter", A.collabCenter, cfg.collabCenter,
        collabCenterFrame(logoCy + logo.h / 2)));
  }

  if (!skip("name"))
    out.push(...lineRuns("name", { text: displayName(cfg).toUpperCase(), ...cfg.nameStyle, bold: true }, m,
      { cx: L.NAME.cx, baseline: L.NAME.baseline, size: L.NAME.size, face: "bold" }));
  if (!skip("styleLine"))
    out.push(...lineRuns("styleLine", { ...cfg.styleLine, text: displayStyle(cfg) }, m,
      { cx: L.STYLE_LINE.cx, baseline: L.STYLE_LINE.baseline, size: L.STYLE_LINE.size }));

  const info = parseInfoLine(cfg.handleAddress.text, cfg.handleAddress);
  if (!skip("handleAddress"))
    out.push(...rotatedRuns("handleAddress", info, info.text, m, {
      x: L.HANDLE_ADDR.x, yStart: L.HANDLE_ADDR.yStart, size: L.HANDLE_ADDR.size,
      base: info.bold ? "bold" : "semibold", boldFace: "bold",
    }));

  // Wrapping measures with the warning's own tracking and inline runs — the
  // exact measure both renderers and hittest wrap with today.
  if (!skip("warning")) {
    const warnLines = wrapWarning(
      warningMeasure((t, bold) => m(t, L.WARNING.size, bold ? "bold" : "regular"),
        cfg.warning.letterSpacing),
      L.WARNING.maxLen,
    );
    warnLines.forEach((line, i) =>
      out.push(...justifiedRotatedRuns("warning", cfg.warning, line, m, {
        x: L.WARNING.x + i * L.WARNING.leading, yStart: L.WARNING.yStart,
        size: L.WARNING.size, maxLen: L.WARNING.maxLen, base: "regular", boldFace: "bold",
      })));
  }

  if (!skip("storeCold"))
    // No boldFace: drawElements passes no boldFont here, so markers keep the
    // line's own face.
    out.push(...rotatedRuns("storeCold", cfg.storeCold, cfg.storeCold.text, m, {
      x: L.STORE_COLD.x, yStart: L.STORE_COLD.yStart, size: L.STORE_COLD.size,
      base: cfg.storeCold.bold ? "bold" : "semibold",
    }));

  // QR — payload derived from the beer name; the stroked underlay is its own
  // paths item (the grow'd path IS the stroke, so the item itself is unstroked).
  if (A && !skip("qr")) {
    const shapes = qrShapes(qrUrl(displayName(cfg)));
    const at = { x: L.QR.x, y: L.QR.yTop };
    if (cfg.qrStroke !== "none")
      out.push({
        kind: "paths", id: "qr", ...at, stroke: null,
        paths: [qrPath(shapes, L.QR.size, (cfg.qrStrokeWidth ?? L.DEFAULT_STROKE_PX) * L.PX)],
        fill: cfg.qrStroke, layer: cfg.qrStrokeLayer,
      });
    out.push({
      kind: "paths", id: "qr", ...at, stroke: null,
      paths: [qrPath(shapes, L.QR.size)], fill: cfg.qrFill, layer: cfg.qrLayer,
    });
  }

  if (A && !skip("barcode")) out.push(barcodeItem(cfg, m));

  // Master-variant custom layers — appended last so they draw on top of
  // every fixed element, in the order they're stored. Absent/empty
  // customLayers is a no-op: nothing appends, so the plan is byte-for-byte
  // the pre-feature list (the regression lock plan.test.ts checks).
  for (const layer of cfg.customLayers ?? []) {
    if (skip(layer.id)) continue;
    const guides = labelGuides();
    if (layer.type === "text") {
      const runs = parseRuns(layer.line);
      const faceOf = (r: StyledLine): Face => (r.bold ? "semibold" : "regular");
      const tracking = layer.line.letterSpacing ?? 0;
      const tw = L.runsWidth(runs, (r) => m(r.text, layer.size, faceOf(r)), tracking);
      out.push(...lineRuns(layer.id, layer.line, m, {
        x: anchoredX(layer.position, tw, guides),
        baseline: anchoredY(layer.position, layer.size, guides) + layer.size,
        size: layer.size,
      }));
    } else if (layer.type === "image") {
      const entry = A?.custom?.[layer.asset];
      if (entry?.art?.kind === "svg") {
        // SVG custom art has no raster bytes to embed (see the "image" arm
        // below and its backends' no-op guard for an SVG asset) — it plans
        // as a `paths` item instead, ink-tight fitted to the layer's own box
        // width, exactly like collabItems' SVG branch. `paths` items are
        // backend-generic (pdf/build.ts and canvas/draw.ts already draw any
        // `paths` item, no id-specific handling), so this needs no backend
        // work — only planLabel's placement changes.
        const a = parseLogo(entry.art.svg, layer.w);
        out.push({
          kind: "paths", id: layer.id, paths: a.paths,
          x: anchoredX(layer.position, a.w, guides),
          y: anchoredY(layer.position, a.h, guides),
          fill: layer.style.fill, layer: layer.style.layer, stroke: strokeSpec(layer.style),
        });
      } else {
        // The loaded asset's aspect wins when it's available; otherwise fall
        // back to the layer's own stored aspect (captured at drop time) so
        // the rect — and with it selection/hit/drag — exists before (or
        // without) bytes ever loading. Backends resolve the bytes themselves
        // by `asset`, and no-op when they have none.
        const aspect = entry?.aspect ?? layer.aspect;
        if (aspect === undefined) continue;
        const h = layer.w / aspect;
        out.push({
          kind: "image", id: layer.id, asset: layer.asset,
          x: anchoredX(layer.position, layer.w, guides),
          y: anchoredY(layer.position, h, guides),
          w: layer.w, h,
        });
      }
    } else if (layer.type === "barcode") {
      const item = customBarcodeItem(layer, m, guides);
      if (item) out.push(item);
    } else {
      // "qr" — plain stroke-underlay + fill `paths` items, exactly like the
      // template QR (see above): no backend changes needed, `paths` is
      // universal. EC level defaults to "M" for layers (P2) — the module-
      // level qrShapes default of "L" stays the template QR's own default,
      // unrelated to this layer type.
      const shapes = qrShapes(layer.value, { style: layer.qrStyle, ecLevel: layer.ecLevel ?? "M" });
      const at = { x: anchoredX(layer.position, layer.size, guides), y: anchoredY(layer.position, layer.size, guides) };
      const style = layer.style;
      if (style.stroke && style.stroke !== "none")
        out.push({
          kind: "paths", id: layer.id, ...at, stroke: null,
          paths: [qrPath(shapes, layer.size, (style.strokeWidth ?? L.DEFAULT_STROKE_PX) * L.PX)],
          fill: style.stroke, layer: strokeLayerOf(style),
        });
      out.push({
        kind: "paths", id: layer.id, ...at, stroke: null,
        paths: [qrPath(shapes, layer.size)], fill: style.fill, layer: style.layer,
      });
    }
  }

  return out;
}
