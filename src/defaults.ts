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
    descriptionHeader: { text: "HOPS", fill: "gold", layer: "metallic", bold: true },
    descriptionLines: [
      { text: "Freestyle Motueka", fill: "gold", layer: "metallic" },
      { text: "Freestyle Waimea", fill: "gold", layer: "metallic" },
      { text: "Freestyle Nelson Sauvin", fill: "gold", layer: "metallic" },
      { text: "Roy Farms Citra Liquid Lupulin", fill: "white", layer: "white", bold: true },
      { text: "Fresh Wai-iti Cold-Pressed Hop Juice", fill: "gold", layer: "metallic" },
    ],
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

/** Parse a saved config JSON; throws with a readable message on mismatch. */
export function parseConfigFile(json: string): LabelConfig {
  const data = JSON.parse(json);
  if (data?.version !== 1) throw new Error("Unsupported config version");
  const { version: _v, ...cfg } = data;
  const base = defaultConfig();
  for (const key of Object.keys(base) as (keyof LabelConfig)[]) {
    if (!(key in cfg)) throw new Error(`Config missing field: ${key}`);
  }
  return cfg as LabelConfig;
}
