// tests/model-lolev.test.ts — the shipped Lolev master's (model/lolevLayers.ts)
// preset vocabularies.
import { describe, expect, it } from "vitest";
import { lolevMaster as lolevV3 } from "../src/model/lolevLayers";

// docs/plans/choice-input.md, Task 9. Both lists come back from presets.json
// (deleted 2026-09-04 in aafc163), verbatim — the styles it offered and the
// eight barcode tiers, whose { name, upc } is exactly a Choice.
describe("the shipped vocabularies", () => {
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
