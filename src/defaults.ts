// defaults.ts — default LabelConfig mirroring the Labradorite reference label,
// plus the fixed template strings (warning text, address) used by the layout.
import type { LabelConfig, ConfigFile } from "./types";
import { DEFAULT_STROKE_PX, GOLD } from "./layout";

export const WARNING_TEXT =
  "GOVERNMENT WARNING: (1) ACCORDING TO THE SURGEON GENERAL, WOMEN SHOULD " +
  "NOT DRINK ALCOHOLIC BEVERAGES DURING PREGNANCY BECAUSE OF THE RISK OF " +
  "BIRTH DEFECTS. (2) CONSUMPTION OF ALCOHOLIC BEVERAGES IMPAIRS YOUR " +
  "ABILITY TO DRIVE A CAR OR OPERATE MACHINERY, AND MAY CAUSE HEALTH PROBLEMS.";

export function defaultConfig(): LabelConfig {
  return {
    beerName: "LABRADORITE",
    nameStyle: { fill: GOLD, layer: "metallic" },
    styleLine: { text: "Ultra Hopped Ale", fill: GOLD, layer: "metallic" },
    abv: "8",
    abvStyle: { fill: GOLD, layer: "metallic" },
    description: [
      "# HOPS",
      "Freestyle Motueka",
      "Freestyle Waimea",
      "Freestyle Nelson Sauvin",
      "Roy Farms Citra Liquid Lupulin",
      "Fresh Wai-iti Cold-Pressed Hop Juice",
    ].join("\n"),
    descStyle: { fill: GOLD, layer: "metallic" },
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
    qrStroke: "none",
    qrLayer: "metallic",
    volume: { text: "1 PINT", fill: GOLD, layer: "metallic", bold: true },
    wordmark: { fill: GOLD, layer: "metallic" },
    // The laurel's classic dark keyline, now an ordinary editable stroke.
    logo: { fill: GOLD, layer: "metallic", stroke: "#1A1A1A", strokeWidth: DEFAULT_STROKE_PX },
    handleAddress: {
      text: "@LOLEVBEER   5247 BUTLER ST, PITTSBURGH, PA",
      fill: GOLD,
      layer: "metallic",
      // Ships tracked (2026-08): the handle and address read as one long
      // rotated run, and a quarter point of spacing opens it up.
      letterSpacing: 0.25,
    },
    warning: { fill: GOLD, layer: "metallic" },
    storeCold: { text: "STORE COLD", fill: GOLD, layer: "metallic", bold: true },
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
  // Configs saved before the description block was styleable.
  cfg.descStyle ??= { fill: GOLD, layer: "metallic" };
  // Configs saved before per-element strokes: keep the logo's classic keyline.
  if (cfg.logo) {
    cfg.logo.stroke ??= "#1A1A1A";
    cfg.logo.strokeWidth ??= DEFAULT_STROKE_PX;
  }
  for (const key of Object.keys(base) as (keyof LabelConfig)[]) {
    // barcodeStrokeWidth is optional: pre-style configs omit it — that is
    // what preserves their measured halo — while defaultConfig ships 20.
    if (key === "barcodeStrokeWidth") continue;
    if (!(key in cfg)) throw new Error(`Config missing field: ${key}`);
  }
  return cfg as LabelConfig;
}
