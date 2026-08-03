// defaults.ts — default LabelConfig mirroring the Labradorite reference label,
// plus the fixed template strings (warning text, address) used by the layout.
import type { LabelConfig, ConfigFile } from "./types";
import { GOLD } from "./layout";

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
      "**_Roy Farms Citra Liquid Lupulin_**",
      "Fresh Wai-iti Cold-Pressed Hop Juice",
    ].join("\n"),
    upc: "850051366224",
    qrData: "https://lolev.beer",
    qrLayer: "metallic",
    volume: { text: "1 PINT", fill: GOLD, layer: "metallic", bold: true },
    wordmark: { fill: GOLD, layer: "metallic" },
    logo: { fill: GOLD, layer: "metallic" },
    handleAddress: {
      text: "@LOLEVBEER   5247 BUTLER ST, PITTSBURGH, PA",
      fill: GOLD,
      layer: "metallic",
    },
    warning: { fill: "#000000", layer: "metallic" },
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
  // Legacy fill migration: configs saved before free-hex fills.
  const LEGACY_FILLS: Record<string, string> = { gold: GOLD, black: "#000000", white: "none" };
  for (const k of [
    "nameStyle", "styleLine", "abvStyle", "volume", "wordmark",
    "logo", "handleAddress", "warning", "storeCold",
  ]) {
    const s = cfg[k];
    if (s && typeof s.fill === "string" && s.fill in LEGACY_FILLS) s.fill = LEGACY_FILLS[s.fill];
  }
  const base = defaultConfig();
  for (const key of Object.keys(base) as (keyof LabelConfig)[]) {
    if (!(key in cfg)) throw new Error(`Config missing field: ${key}`);
  }
  return cfg as LabelConfig;
}
