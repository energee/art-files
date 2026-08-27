import { describe, expect, it } from "vitest";
import { rebind } from "../src/model/rebind";
import type { LabelFileV2, Master } from "../src/model/types";

const target: Master = {
  formatVersion: 1, id: "m2", name: "Other Brewery",
  physical: { labelWidthIn: 8.125, labelHeightIn: 3.625, bleedIn: 0.125, canDiameterIn: 2.6 },
  defaults: {}, guides: { left: 24.12, center: "auto", right: 24.12, top: 24.12, bottom: 24.12 },
  fields: [{ id: "name", label: "Name", kind: "text", path: "beerName" }],
  variants: [{ id: "collab", name: "Collab", overrides: {}, layerOverrides: {}, fields: [] }],
  layers: [],
};

const label: LabelFileV2 = {
  formatVersion: 2, masterId: "m1", enabledVariants: ["collab", "seasonal"],
  values: { name: "HAZY", untappd: "u/x" },
};

describe("rebind", () => {
  it("keeps matching values and retargets the master", () => {
    const r = rebind(label, target);
    expect(r.label.masterId).toBe("m2");
    expect(r.label.values.name).toBe("HAZY");
  });
  it("drops and reports values the target has no field for", () => {
    const r = rebind(label, target);
    expect(r.dropped).toEqual(["untappd"]);
    expect(r.label.values.untappd).toBeUndefined();
  });
  it("disables and reports variants the target lacks", () => {
    const r = rebind(label, target);
    expect(r.label.enabledVariants).toEqual(["collab"]);
    expect(r.disabledVariants).toEqual(["seasonal"]);
  });
  it("does not mutate the input label", () => {
    rebind(label, target);
    expect(label.masterId).toBe("m1");
  });
});
