// model-rows.test.ts — layerRows (src/model/rows.ts): the Layers list's rows
// from a v3 master + label — resolved draw order, disabled rows kept, an off
// variant's added layers appended raw and badged, and the two separate
// provenance marks (a variant changed it / this label changed it).
import { describe, expect, it } from "vitest";
import { layerRows, variantChips } from "../src/model/rows";
import { lolevMaster } from "../src/model/lolevLayers";
import type { LabelFile } from "../src/model/layers";

const label = (over: Partial<LabelFile> = {}): LabelFile =>
  ({ formatVersion: 3, masterId: "lolev", enabledVariants: [], values: {}, ...over });

describe("layerRows", () => {
  it("lists the master's layers in draw order, then an off variant's added layers badged off", () => {
    const m = lolevMaster();
    const { rows } = layerRows(m, label());
    expect(rows.slice(0, m.layers.length).map((r) => r.layer.id)).toEqual(m.layers.map((l) => l.id));
    const tail = rows.slice(m.layers.length);
    expect(tail.map((r) => r.layer.id)).toEqual(["collabLead", "collabLeft", "collabCenter"]);
    expect(tail.every((r) => r.variant?.id === "collab" && r.variant.enabled === false)).toBe(true);
  });

  it("keeps a disabled layer in the rows and applies label values", () => {
    const m = lolevMaster();
    m.layers.find((l) => l.id === "volume")!.enabled = false;
    const { rows } = layerRows(m, label({ values: { name: [{ text: "Peregrine", fill: "#F3CD80", layer: "metallic" }] } }));
    expect(rows.find((r) => r.layer.id === "volume")?.layer.enabled).toBe(false);
    const name = rows.find((r) => r.layer.id === "name")!.layer;
    expect(name.kind === "text" && name.lines[0].text).toBe("Peregrine");
  });

  it("badges an enabled variant's added layers on and marks one it changes", () => {
    const m = lolevMaster();
    m.variants[0].layers.logo = { y: 120 };
    const { rows } = layerRows(m, label({ enabledVariants: ["collab"] }));
    const row = (id: string) => rows.find((r) => r.layer.id === id);
    expect(row("collabLead")?.variant).toEqual({ id: "collab", name: "Collab", enabled: true });
    expect(row("logo")?.variantOverridden).toEqual({ id: "collab", name: "Collab", enabled: true });
    expect(row("logo")?.changed).toBeUndefined();
    expect(row("logo")?.variant?.id).toBe("collab");
    expect(row("name")?.variantOverridden).toBeUndefined();
    expect(variantChips(m, label({ enabledVariants: ["collab"] }))).toEqual([{ id: "collab", name: "Collab", enabled: true }]);
  });

  it("marks a label override separately from a variant's", () => {
    const { rows } = layerRows(lolevMaster(), label({ overrides: { name: { x: 10 } } }));
    const name = rows.find((r) => r.layer.id === "name");
    expect(name?.changed).toBe(true);
    expect(name?.variantOverridden).toBeUndefined();
  });

  it("marks both when a variant and the label each change the same layer", () => {
    const m = lolevMaster();
    m.variants[0].layers.logo = { y: 120 };
    const { rows } = layerRows(m, label({ enabledVariants: ["collab"], overrides: { logo: { x: 9 } } }));
    const logo = rows.find((r) => r.layer.id === "logo");
    expect(logo?.variantOverridden?.id).toBe("collab");
    expect(logo?.changed).toBe(true);
  });

  it("a value alone marks the layer as changed by this label", () => {
    const { rows } = layerRows(lolevMaster(), label({ values: { name: [{ text: "X", fill: "#F3CD80", layer: "metallic" }] } }));
    expect(rows.find((r) => r.layer.id === "name")?.changed).toBe(true);
  });
});
