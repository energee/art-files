// defaults.ts — default LabelConfig mirroring the Labradorite reference label,
// plus the fixed template strings (warning text, address) used by the layout.
import type { LabelConfig, ConfigFile } from "./types";
import { DEFAULT_STROKE_PX, GOLD } from "./layout";

/** The shipped outer stroke: pure black, at the standard width. The barcode
 *  is the one element that does NOT take it — its stroke is a white halo the
 *  scan contrast depends on (see barcodeStroke below). */
export const KEYLINE = { stroke: "#000000", strokeWidth: DEFAULT_STROKE_PX } as const;

// "GOVERNMENT WARNING:" carries inline **bold** markers — the TTB requires
// the phrase in bold caps. Marked PER WORD, not across the phrase, because
// wrapWarning splits on spaces and every word must stay a balanced run on
// its own (an unmatched marker renders literally — see parseRuns).
// Sentence case body (2026-08): the TTB requires caps + bold only for the
// "GOVERNMENT WARNING:" phrase itself; lowercase body text is narrower, which
// is what lets the type size come up toward the 2mm minimum.
export const WARNING_TEXT =
  "**GOVERNMENT** **WARNING:** (1) According to the Surgeon General, women should " +
  "not drink alcoholic beverages during pregnancy because of the risk of " +
  "birth defects. (2) Consumption of alcoholic beverages impairs your " +
  "ability to drive a car or operate machinery, and may cause health problems.";

/** Blank per-release fields render as placeholders — the label previews
 *  (and prints) "Name" / "Style" / "#" until something is typed. One home
 *  for the fallbacks so both renderers, the hit-tester and the QR payload
 *  can never disagree about what a blank field draws. */
export const displayName = (c: LabelConfig) => c.beerName.trim() || "Name";

/** Filename stem for every export (PDF, PSD, and their mask plates). One
 *  fallback, so an unnamed label downloads as "label.*" everywhere. */
export const exportBaseName = (c: LabelConfig) => c.beerName.trim() || "label";
export const displayStyle = (c: LabelConfig) => c.styleLine.text.trim() || "Style";
/** The ABV figure alone. Every caller appends the unit ("% alc by vol" on the
 *  label), so a trailing percent sign — typed, or inherited from a config
 *  written when the field carried its own unit — is stripped rather than
 *  printed twice. Text measurement runs on this same value, so the hitbox
 *  follows. */
export const displayAbv = (c: LabelConfig) =>
  c.abv.trim().replace(/\s*%$/, "").trim() || "#";

export function defaultConfig(): LabelConfig {
  return {
    beerName: "",
    nameStyle: { fill: GOLD, layer: "metallic", ...KEYLINE },
    styleLine: { text: "", fill: GOLD, layer: "metallic", ...KEYLINE },
    abv: "",
    abvStyle: { fill: GOLD, layer: "metallic", ...KEYLINE },
    // A placeholder, not a real hop bill: the list changes per beer, so the
    // default just shows where it goes.
    description: "# HOPS\n...",
    descStyle: { fill: GOLD, layer: "metallic", ...KEYLINE },
    upc: "850051366224",
    // Near-black bars and digits inside a white halo, over white ink. The
    // fill matches the PSD's bars (psd/build.ts) so the two deliverables
    // agree. The halo ships at 20px @600dpi by request (2026-08) — wider
    // than the ~15.5px measured off the old finished labels, which is what
    // an UNSET width still resolves to (see types.ts and drawBarcode's
    // resolver); pre-style configs migrate without a width so their print
    // output is preserved.
    barcodeFill: "#1A1A1A",
    barcodeStroke: "#FFFFFF",
    barcodeStrokeWidth: 20,
    barcodeLayer: "white",
    qrFill: GOLD,
    // Same keyline as the text elements. The QR's stroke is a real stroked
    // path under the dots (drawSvgPath), not the faked ring text uses.
    qrStroke: KEYLINE.stroke,
    qrStrokeWidth: KEYLINE.strokeWidth,
    qrLayer: "metallic",
    // Collab off by default: most releases are not collabs, and with the
    // switch off none of these three are reachable from the form.
    collabEnabled: false,
    collabLead: { fill: GOLD, layer: "metallic" },
    // offsetY/tintRaster ship explicit rather than absent so the form's
    // number inputs and checkbox are controlled from the first render. The
    // centre slot has no offsetY of its own: it rides the laurel's (see
    // types.ts), which is what keeps the centre stack together.
    collabLeft: { fill: GOLD, layer: "metallic", scale: 1, offsetY: 0, tintRaster: false },
    collabCenter: { fill: GOLD, layer: "metallic", scale: 1, tintRaster: false },
    volume: { text: "1 PINT", fill: GOLD, layer: "metallic", bold: true, ...KEYLINE },
    wordmark: { fill: GOLD, layer: "metallic", ...KEYLINE },
    // The laurel's classic dark keyline, now an ordinary editable stroke.
    logo: { fill: GOLD, layer: "metallic", ...KEYLINE },
    handleAddress: {
      // The handle is an inline bold run (see parseRuns); the address stays
      // in the column's semibold face.
      text: "**@LOLEVBEER** 5247 BUTLER ST, PITTSBURGH, PA",
      fill: GOLD,
      layer: "metallic",
      ...KEYLINE,
      // Ships tracked (2026-08): the handle and address read as one long
      // rotated run, and better than a third of a point of spacing opens it up.
      letterSpacing: 0.38,
    },
    // Slightly negative tracking (2026-08): buys the last fraction of a point
    // of type size that keeps the paragraph on 4 columns at a 2mm cap height.
    warning: { fill: GOLD, layer: "metallic", ...KEYLINE, letterSpacing: -0.05 },
    // Widely tracked (2026-08): two short uppercase words set large enough
    // that tight spacing reads as one word.
    storeCold: {
      text: "STORE COLD", fill: GOLD, layer: "metallic", bold: true,
      letterSpacing: 1.25,
    },
  };
}

export function toConfigFile(c: LabelConfig): ConfigFile {
  return { version: 1, ...c };
}

/** Parse a saved config JSON; throws with a readable message on mismatch.
 *  Configs saved before the markdown description migrate transparently. */
export function parseConfigFile(json: string): LabelConfig {
  const data = JSON.parse(json);
  if (data?.version !== 1) throw new Error("Unsupported config version");
  const { version: _v, ...cfg } = data;
  if (cfg.description === undefined && Array.isArray(cfg.descriptionLines)) {
    const md = (l: { text: string; fill: string; layer: string; bold?: boolean }) => {
      let s = l.text;
      if (l.fill === "white" || l.layer === "white") s = `_${s}_`;
      if (l.bold) s = `**${s}**`;
      return s;
    };
    cfg.description = [
      ...(cfg.descriptionHeader ? [`# ${cfg.descriptionHeader.text}`] : []),
      ...cfg.descriptionLines.map(md),
    ].join("\n");
    delete cfg.descriptionHeader;
    delete cfg.descriptionLines;
  }
  const base = defaultConfig();
  // Legacy fill migration: configs saved before free-hex fills. Every
  // schema field shaped like a style ({ fill: string }) gets its named fill
  // mapped, so new styled fields are covered without touching this loop.
  const LEGACY_FILLS: Record<string, string> = { gold: GOLD, black: "#000000", white: "none" };
  for (const k of Object.keys(base)) {
    const s = cfg[k];
    if (s && typeof s.fill === "string" && s.fill in LEGACY_FILLS) s.fill = LEGACY_FILLS[s.fill];
  }
  delete cfg.qrData; // payload is derived from beerName now
  cfg.qrFill ??= GOLD;
  cfg.qrStroke ??= "none";
  // Configs saved before the barcode became a styled element, when the
  // renderer hardcoded these three. Deliberately no barcodeStrokeWidth line:
  // unset is what keeps the measured L.BARCODE.stroke halo, so these configs
  // print byte-identically to how they always have.
  cfg.barcodeFill ??= "#1A1A1A";
  cfg.barcodeStroke ??= "#FFFFFF";
  cfg.barcodeLayer ??= "white";
  // Configs saved before the warning shipped tracked at -0.05 (2026-08).
  // Not cosmetic: at 8.2pt the untracked paragraph wraps into a 5th column
  // that lands under the barcode — the tracking is part of the geometry.
  if (cfg.warning) cfg.warning.letterSpacing ??= -0.05;
  // Configs saved before the description block was styleable.
  cfg.descStyle ??= { fill: GOLD, layer: "metallic" };
  // Configs saved before per-element strokes: keep the logo's classic keyline.
  if (cfg.logo) {
    cfg.logo.stroke ??= "#1A1A1A";
    cfg.logo.strokeWidth ??= DEFAULT_STROKE_PX;
  }
  // Configs saved before collab labels existed: not a collab, no collab art.
  cfg.collabEnabled ??= false;
  cfg.collabLead ??= base.collabLead;
  cfg.collabLeft ??= base.collabLeft;
  cfg.collabCenter ??= base.collabCenter;
  for (const key of Object.keys(base) as (keyof LabelConfig)[]) {
    // barcodeStrokeWidth is optional: pre-style configs omit it — that is
    // what preserves their measured halo — while defaultConfig ships 20.
    if (key === "barcodeStrokeWidth") continue;
    if (!(key in cfg)) throw new Error(`Config missing field: ${key}`);
  }
  return cfg as LabelConfig;
}
