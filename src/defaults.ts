// defaults.ts — default LabelConfig mirroring the Labradorite reference label,
// plus the fixed template strings (warning text, address) used by the layout.
import type { LabelConfig, ConfigFile } from "./types";

export const WARNING_TEXT =
  "GOVERNMENT WARNING: (1) ACCORDING TO THE SURGEON GENERAL, WOMEN SHOULD " +
  "NOT DRINK ALCOHOLIC BEVERAGES DURING PREGNANCY BECAUSE OF THE RISK OF " +
  "BIRTH DEFECTS. (2) CONSUMPTION OF ALCOHOLIC BEVERAGES IMPAIRS YOUR " +
  "ABILITY TO DRIVE A CAR OR OPERATE MACHINERY, AND MAY CAUSE HEALTH PROBLEMS.";

export function defaultConfig(): LabelConfig {
  return {
    beerName: "LABRADORITE",
    nameStyle: { fill: "gold", layer: "metallic" },
    styleLine: { text: "Ultra Hopped Ale", fill: "gold", layer: "metallic" },
    abv: "8",
    abvStyle: { fill: "gold", layer: "metallic" },
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
    volume: { text: "1 PINT", fill: "gold", layer: "metallic", bold: true },
    wordmark: { fill: "gold", layer: "metallic" },
    logo: { fill: "gold", layer: "metallic" },
    handleAddress: {
      text: "@LOLEVBEER   5247 BUTLER ST, PITTSBURGH, PA",
      fill: "gold",
      layer: "metallic",
    },
    warning: { fill: "black", layer: "metallic" },
    storeCold: { text: "STORE COLD", fill: "gold", layer: "metallic", bold: true },
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
  for (const key of Object.keys(base) as (keyof LabelConfig)[]) {
    if (!(key in cfg)) throw new Error(`Config missing field: ${key}`);
  }
  return cfg as LabelConfig;
}
