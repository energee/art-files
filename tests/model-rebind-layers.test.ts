// tests/model-rebind-layers.test.ts — re-aiming a v3 .label at another
// master (model/rebindLayers.ts): values match by layer id against what the
// target HAS, anything unmatched is benched on `dormant`
// instead of lost, and a round trip A→B→A restores everything.
import { describe, expect, it } from "vitest";
import { rebindLabel } from "../src/model/rebindLayers";
import { lolevMaster } from "../src/model/lolevLayers";
import type { LabelFile, Master, TextLine } from "../src/model/layers";
import { GOLD } from "../src/layout";

const line = (text: string): TextLine[] => [{ text, fill: GOLD, layer: "metallic" }];

/** A master that HAS only `name` and the page art, and no variants — every
 *  layer it has is fillable now, so what it lacks is what benches. */
const other = (): Master => ({
  ...lolevMaster(), id: "other", name: "Other Brewery",
  layers: lolevMaster().layers.filter(
    (l) => l.id === "name" || l.id === "background" || l.id === "mask"),
  variants: [],
});

const label = (): LabelFile => ({
  formatVersion: 3, masterId: "lolev", masterHint: "lolev.master",
  enabledVariants: ["collab", "seasonal"],
  values: { name: line("HAZY"), abv: line("6.5"), collabLeft: "asset-1", untappd: "u/x" },
});

describe("rebindLabel", () => {
  it("keeps matching values and retargets the master", () => {
    const r = rebindLabel(label(), lolevMaster(), other());
    expect(r.label.masterId).toBe("other");
    expect(r.label.masterHint).toBeUndefined();
    expect(r.label.values).toEqual({ name: line("HAZY") });
  });
  it("benches and reports values the target does not have", () => {
    const r = rebindLabel(label(), lolevMaster(), other());
    expect(r.dropped.values.sort()).toEqual(["abv", "collabLeft", "untappd"]);
    expect(r.label.dormant!.values).toEqual({ abv: line("6.5"), collabLeft: "asset-1", untappd: "u/x" });
  });
  it("benches and reports variants the target lacks, keeping enable order", () => {
    const r = rebindLabel(label(), lolevMaster(), other());
    expect(r.label.enabledVariants).toEqual([]);
    expect(r.dropped.variants).toEqual(["collab", "seasonal"]);
    expect(r.label.dormant!.variants).toEqual(["collab", "seasonal"]);
  });
  it("a variant-added layer counts as one the target has", () => {
    const r = rebindLabel(label(), undefined, lolevMaster());
    expect(r.label.values.collabLeft).toBe("asset-1");
    expect(r.label.enabledVariants).toEqual(["collab"]);
    expect(r.dropped).toEqual({ values: ["untappd"], variants: ["seasonal"] });
  });
  it("benches a value whose shape no longer fits the target layer's kind", () => {
    const to: Master = { ...lolevMaster(), id: "swapped",
      layers: lolevMaster().layers.map((l) => (l.id === "name"
        ? { id: "name", name: "Name", kind: "image", enabled: true,
            x: 0, anchor: "left", y: 0, asset: "", w: 10, style: l.style }
        : l)) };
    const r = rebindLabel(label(), lolevMaster(), to);
    expect(r.dropped.values).toContain("name");
    expect(r.label.dormant!.values.name).toEqual(line("HAZY"));
  });
  it("a clean rebind carries no dormant key", () => {
    const l: LabelFile = { formatVersion: 3, masterId: "x", enabledVariants: ["collab"],
      values: { name: line("HAZY") } };
    const r = rebindLabel(l, undefined, lolevMaster());
    expect("dormant" in r.label).toBe(false);
    expect(r.dropped).toEqual({ values: [], variants: [] });
  });
  it("round trip A→B→A loses nothing: benched values and variants come back", () => {
    const away = rebindLabel(label(), lolevMaster(), other()).label;
    const home = rebindLabel(away, other(), lolevMaster()).label;
    expect(home.masterId).toBe("lolev");
    expect(home.values).toEqual({ name: line("HAZY"), abv: line("6.5"), collabLeft: "asset-1" });
    expect(home.enabledVariants).toEqual(["collab"]);
    expect(home.dormant).toEqual({ values: { untappd: "u/x" }, variants: ["seasonal"] });
  });
  it("live values win over a benched value with the same id", () => {
    const l: LabelFile = { ...label(), dormant: { values: { name: line("OLD") }, variants: [] } };
    expect(rebindLabel(l, undefined, lolevMaster()).label.values.name).toEqual(line("HAZY"));
  });
  it("leaves label overrides alone and never mutates the input", () => {
    const l: LabelFile = { ...label(), overrides: { name: { size: 20 } } };
    const before = structuredClone(l);
    const r = rebindLabel(l, lolevMaster(), other());
    expect(r.label.overrides).toEqual({ name: { size: 20 } });
    expect(l).toEqual(before);
  });
});
