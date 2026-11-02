// convert-v1.test.ts — an old v1 config.json label has no master of its own,
// so it converts onto the master it opens against (the open tab's, or the
// CLI's --master), not a built-in Lolev table: the values that master has a
// layer for fill it, and the rest (a barcode, the Collab variant) are benched
// on the label for a master that has them.
import { describe, expect, it } from "vitest";
import { convertConfigV1 } from "../src/model/convert";
import { starterMaster } from "../src/model/starterLayers";
import { lolevMaster } from "../src/model/lolevLayers";
import { resolveLayers } from "../src/model/resolveLayers";
import { defaultConfig } from "../src/defaults";

const hazy = () => {
  const cfg = defaultConfig();
  cfg.beerName = "Hazy";
  cfg.styleLine.text = "Hazy Pale Ale";
  cfg.abv = "7";
  return cfg;
};
const texts = (v: unknown) => (v as { text: string }[]).map((l) => l.text);

describe("convertConfigV1 onto the open master", () => {
  it("fills Starter's name, style and ABV", () => {
    const { label } = convertConfigV1(hazy(), false, starterMaster());
    expect(label.masterId).toBe("starter");
    expect(texts(label.values.name)).toEqual(["Hazy"]);
    expect(texts(label.values.styleLine)).toEqual(["Hazy Pale Ale"]);
    expect(texts(label.values.abv)).toEqual(["7"]);
    const { errors } = resolveLayers(starterMaster(), label.enabledVariants, label.values, label.overrides);
    expect(errors).toEqual({});
  });

  it("benches the values and variant the master has no layer for", () => {
    const cfg = hazy();
    cfg.collabLeft.image = "a1";
    const { label } = convertConfigV1(cfg, true, starterMaster());
    expect(label.values.barcode).toBeUndefined();
    expect(label.enabledVariants).toEqual([]);
    expect(label.dormant).toMatchObject({ values: { barcode: "850051366224", collabLeft: "a1" }, variants: ["collab"] });
  });

  it("takes the id of whichever master it converts onto", () => {
    const { label } = convertConfigV1(hazy(), true, lolevMaster());
    expect(label.masterId).toBe("lolev");
    expect(label.enabledVariants).toEqual(["collab"]);
    expect(label.values.barcode).toBe("850051366224");
  });
});
