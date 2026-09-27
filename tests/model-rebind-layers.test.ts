// tests/model-rebind-layers.test.ts — re-aiming a v3 .label at another
// master (model/rebindLayers.ts): values match by layer id against what the
// target HAS, anything unmatched is benched on `dormant`
// instead of lost, and a round trip A→B→A restores everything.
import { describe, expect, it } from "vitest";
import { parseLabel, serializeLabel } from "../src/model/files";
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
    expect(home.dormant).toEqual({ values: { untappd: "u/x" }, variants: ["seasonal"], variantOrder: ["collab", "seasonal"] });
  });
  it("restores a benched text value stored as a plain string (#96)", () => {
    const l: LabelFile = { formatVersion: 3, masterId: "other", enabledVariants: [],
      values: {}, dormant: { values: { name: "Peregrine" }, variants: [] } };
    const r = rebindLabel(l, undefined, lolevMaster());
    expect(r.label.values).toEqual({ name: "Peregrine" });
    expect(r.dropped.values).toEqual([]);
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

// A label-only legacy layer (#264) travels in the label's own overrides, so
// it exists on every master the label moves to — its value must too.
it("keeps a value typed into a label-only legacy layer", () => {
  const stamp = { ...lolevMaster().layers.find((l) => l.kind === "text")!, id: "custom-abc", name: "Stamp" };
  const l: LabelFile = { ...label(), overrides: { "custom-abc": stamp }, values: { "custom-abc": line("TYPED") } };
  const same = rebindLabel(l, lolevMaster(), lolevMaster());
  expect(same.label.values["custom-abc"]).toEqual(line("TYPED"));
  expect(same.dropped.values).toEqual([]);
  expect(rebindLabel(l, lolevMaster(), other()).label.values["custom-abc"]).toEqual(line("TYPED"));
});

it("restores variant precedence after a saved partial rebind (#269)", () => {
  const a = lolevMaster();
  a.variants = [{ id: "v1", name: "One", layers: {} }, { id: "v2", name: "Two", layers: {} }];
  const b = { ...a, id: "other", variants: [a.variants[1]] };
  const original: LabelFile = { formatVersion: 3, masterId: a.id, enabledVariants: ["v2", "v1"], values: {} };
  const away = rebindLabel(original, a, b).label;
  const saved = parseLabel(JSON.parse(serializeLabel(away))) as LabelFile;
  expect(rebindLabel(saved, b, a).label.enabledVariants).toEqual(["v2", "v1"]);
});
