import { describe, expect, it } from "vitest";
import { lolevMaster } from "../src/model/lolev";
import { resolve } from "../src/model/resolve";
import { defaultConfig } from "../src/defaults";

describe("lolevMaster", () => {
  it("resolves with no variants/values to exactly the shipped defaults", () => {
    expect(resolve(lolevMaster(), [], {}).config).toEqual(defaultConfig());
  });
  // Collab is an ordinary variant now: three fields plus the laurel's stack
  // nudge, and NOT a boolean on LabelConfig. What suppresses the collab
  // block when the variant is off is `disabledLayers` alone.
  it("the collab variant declares its three fields", () => {
    const v = lolevMaster().variants.find((x) => x.id === "collab")!;
    expect(v.fields).toEqual([
      { id: "collabLead", label: "Lead-in", kind: "text", path: "collabLead.text" },
      { id: "collabLeft", label: "Text Logo", kind: "image", path: "collabLeft.image" },
      { id: "collabCenter", label: "Graphic Logo", kind: "image", path: "collabCenter.image" },
    ]);
  });
  it("the collab variant's only config override is the laurel's stack nudge", () => {
    // N = 0: the shipped `logo` carries no offsetY (defaults.ts), so today's
    // collab-on nudge is `cfg.logo.offsetY ?? 0` = 0. Recording it as the
    // variant's own override is what lets logoNudge drop its flag gate
    // without moving a single point of ink.
    expect(lolevMaster().variants[0].overrides).toEqual({ logo: { offsetY: 0 } });
  });
  it("no resolved config carries a collabEnabled key any more", () => {
    for (const enabled of [[], ["collab"]]) {
      expect("collabEnabled" in resolve(lolevMaster(), enabled, {}).config).toBe(false);
    }
  });
  it("suppresses the three collab layers off, and none of them on", () => {
    expect([...resolve(lolevMaster(), [], {}).disabledLayers].sort())
      .toEqual(["collabCenter", "collabLead", "collabLeft"]);
    expect([...resolve(lolevMaster(), ["collab"], {}).disabledLayers]).toEqual([]);
  });
  it("fills a typical label", () => {
    const r = resolve(lolevMaster(), [], { name: "HAZY", abv: "6.2", upc: "036000291452" });
    expect(r.errors).toEqual({});
    expect(r.config.beerName).toBe("HAZY");
  });
});
