// model-choice.test.ts — the fill vocabulary that learns
// (docs/plans/choice-input.md, Tasks 2 and 4). A picker offers a list and
// still takes anything typed, and what gets typed joins the list: fill a style
// nobody had authored and the next label opens with it offered.
//
// The vocabulary is MASTER data, so learning writes the master — the one
// content edit that does. That is the fill contract's rule (MASTER_PATHS in
// edit.ts) rather than an exception to routing, and the Save Master review is
// what stands between it and the .master file.
import { describe, expect, it } from "vitest";
import { learnChoice, setContentIn, type Doc } from "../src/model/edit";
import { lolevMaster } from "../src/model/lolevLayers";
import type { Choice, LabelFile, Master } from "../src/model/layers";
import { GOLD } from "../src/layout";

const STYLES: Choice[] = [
  { value: "Ultra Hopped Ale" },
  { title: "Hazy IPA", value: "Hazy India Pale Ale" },
];

const withChoices = (choices: Choice[], id = "styleLine"): Master => {
  const m = lolevMaster();
  return { ...m, layers: m.layers.map((l) => (l.id === id ? { ...l, choices } : l)) };
};
const choicesOf = (m: Master, id = "styleLine") =>
  (m.layers.find((l) => l.id === id) as { choices?: Choice[] }).choices;
const newLabel = (master: Master): LabelFile =>
  ({ formatVersion: 3, masterId: master.id, enabledVariants: [], values: {} });
const line = (text: string) => ({ text, fill: GOLD, layer: "metallic" } as const);

describe("learnChoice", () => {
  it("appends a value the list does not have", () => {
    const m = learnChoice(withChoices(STYLES), "styleLine", "Saison");
    expect(choicesOf(m)).toEqual([...STYLES, { value: "Saison" }]);
  });

  it("returns the master untouched when the value is already offered", () => {
    const before = withChoices(STYLES);
    expect(learnChoice(before, "styleLine", "Ultra Hopped Ale")).toBe(before);
  });

  it("matches on the drawn value, not the title", () => {
    // "Hazy IPA" is a TITLE in the list; typing it means a different beer than
    // the one that title stands for, so it is its own choice.
    const m = learnChoice(withChoices(STYLES), "styleLine", "Hazy IPA");
    expect(choicesOf(m)).toHaveLength(3);
  });

  it("trims what it stores, and learns nothing from blank", () => {
    expect(choicesOf(learnChoice(withChoices(STYLES), "styleLine", "  Saison "))?.at(-1))
      .toEqual({ value: "Saison" });
    const before = withChoices(STYLES);
    expect(learnChoice(before, "styleLine", "   ")).toBe(before);
    expect(learnChoice(before, "styleLine", "Ultra Hopped Ale ")).toBe(before);
  });

  it("starts a list on a layer that has none", () => {
    const m = learnChoice(lolevMaster(), "styleLine", "Saison");
    expect(choicesOf(m)).toEqual([{ value: "Saison" }]);
  });

  it("leaves a layer it cannot find alone", () => {
    const before = withChoices(STYLES);
    expect(learnChoice(before, "ghost", "Saison")).toBe(before);
  });

  it("learns on a barcode layer, which fills a plain string", () => {
    const m = learnChoice(withChoices([{ title: "Tier 1", value: "850051366040" }], "barcode"),
      "barcode", "860009737631");
    expect(choicesOf(m, "barcode")).toEqual([
      { title: "Tier 1", value: "850051366040" }, { value: "860009737631" },
    ]);
  });
});

describe("filling a layer that has a vocabulary", () => {
  const doc = (master: Master): Doc => ({ master, label: newLabel(master) });

  it("writes the label value and teaches the master at once", () => {
    const d = setContentIn(doc(withChoices(STYLES)), "styleLine", [line("Saison")]);
    expect(d.label.values.styleLine).toEqual([line("Saison")]);
    expect(choicesOf(d.master)).toEqual([...STYLES, { value: "Saison" }]);
  });

  it("teaches nothing when the value is already offered", () => {
    const before = doc(withChoices(STYLES));
    const d = setContentIn(before, "styleLine", [line("Ultra Hopped Ale")]);
    expect(d.master).toBe(before.master); // no needless history entry
    expect(d.label.values.styleLine).toEqual([line("Ultra Hopped Ale")]);
  });

  it("reads a multi-run line as the one value it draws", () => {
    const d = setContentIn(doc(withChoices(STYLES)), "styleLine",
      [{ ...line("Hazy "), bold: true }, line("Saison")]);
    expect(choicesOf(d.master)?.at(-1)).toEqual({ value: "Hazy Saison" });
  });

  it("leaves a layer with no vocabulary exactly as it was", () => {
    const before = doc(lolevMaster());
    const d = setContentIn(before, "name", [line("Peregrine")]);
    expect(d.master).toBe(before.master);
  });

  it("learns a barcode's plain-string value", () => {
    const before = doc(withChoices([{ title: "Tier 1", value: "850051366040" }], "barcode"));
    const d = setContentIn(before, "barcode", "860009737631");
    expect(d.label.values.barcode).toBe("860009737631");
    expect(choicesOf(d.master, "barcode")?.at(-1)).toEqual({ value: "860009737631" });
  });
});
