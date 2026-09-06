import { describe, expect, it } from "vitest";
import { lolevMaster } from "../src/model/lolev";
import { lolevMaster as lolevV3 } from "../src/model/lolevLayers";
import { resolve } from "../src/model/resolve";
import { defaultConfig } from "../src/defaults";

describe("lolevMaster", () => {
  it("resolves with no variants/values to exactly the shipped defaults", () => {
    expect(resolve(lolevMaster(), [], {}).config).toEqual(defaultConfig());
  });
  // Collab is an ordinary variant now: three fields plus the laurel's stack
  // nudge, and NOT a boolean on LabelConfig. What suppresses the collab
  // block when the variant is off is `disabledLayers` alone.
  it("the collab variant declares its two logo fields", () => {
    // The lead-in is deliberately not among them: it is fixed template art
    // (plan.ts draws L.COLLAB_LEAD.lines), so a field bound to
    // `collabLead.text` would be a control nothing reads.
    const v = lolevMaster().variants.find((x) => x.id === "collab")!;
    expect(v.fields).toEqual([
      { id: "collabLeft", label: "Text Logo", kind: "image", path: "collabLeft.image" },
      { id: "collabCenter", label: "Graphic Logo", kind: "image", path: "collabCenter.image" },
    ]);
  });
  it("the collab variant overrides no config at all", () => {
    // N = 0: the shipped `logo` carries no offsetY (defaults.ts), so today's
    // collab-on nudge is `cfg.logo.offsetY ?? 0` = 0 and there is nothing to
    // preserve. An explicit 0 here would only shadow — see the next test.
    expect(lolevMaster().variants[0].overrides).toEqual({});
  });
  it("a master-level stack nudge survives enabling Collab", () => {
    // Variant overrides merge ON TOP of master.defaults, so an explicit
    // `logo.offsetY: 0` on the Collab variant would silently discard a
    // designer's master-level nudge on precisely the labels the nudge exists
    // to serve. This is the test that catches that regression.
    const m = lolevMaster();
    m.defaults = { ...m.defaults, logo: { offsetY: 18 } as never };
    expect(resolve(m, [], {}).config.logo.offsetY).toBe(18);
    expect(resolve(m, ["collab"], {}).config.logo.offsetY).toBe(18);
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

// docs/plans/choice-input.md, Task 9. Both lists come back from presets.json
// (deleted 2026-09-04 in aafc163), verbatim — the styles it offered and the
// eight barcode tiers, whose { name, upc } is exactly a Choice.
describe("the shipped vocabularies", () => {
  // The v3 master (lolevLayers), not this file's v1 subject — vocabularies
  // are a layer feature and v1 has no layers.
  const choicesOf = (id: string) =>
    (lolevV3().layers.find((l) => l.id === id) as { choices?: { title?: string; value: string }[] })
      .choices ?? [];

  it("offers the three styles", () => {
    expect(choicesOf("styleLine")).toEqual([
      { value: "Ultra Hopped Ale" },
      { value: "Hazy India Pale Ale" },
      { value: "Hazy Pale Ale" },
    ]);
  });

  it("offers the eight tiers by name, drawing their UPCs", () => {
    const tiers = choicesOf("barcode");
    expect(tiers).toHaveLength(8);
    expect(tiers[0]).toEqual({ title: "Tier 1", value: "850051366040" });
    expect(tiers.at(-1)).toEqual({ title: "Tier 8", value: "860009737600" });
    // The shipped barcode value is one of them, so opening the master and
    // touching nothing leaves the vocabulary alone.
    const shipped = (lolevV3().layers.find((l) => l.id === "barcode") as { value: string }).value;
    expect(tiers.some((c) => c.value === shipped)).toBe(true);
  });
});
