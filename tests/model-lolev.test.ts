import { describe, expect, it } from "vitest";
import { lolevMaster } from "../src/model/lolev";
import { resolve } from "../src/model/resolve";
import { defaultConfig } from "../src/defaults";

describe("lolevMaster", () => {
  it("resolves with no variations/values to exactly the shipped defaults", () => {
    expect(resolve(lolevMaster(), [], {}).config).toEqual(defaultConfig());
  });
  it("collab variation flips only collabEnabled", () => {
    const base = resolve(lolevMaster(), [], {}).config;
    const collab = resolve(lolevMaster(), ["collab"], {}).config;
    expect(collab.collabEnabled).toBe(true);
    expect({ ...collab, collabEnabled: base.collabEnabled }).toEqual(base);
  });
  it("fills a typical label", () => {
    const r = resolve(lolevMaster(), [], { name: "HAZY", abv: "6.2", upc: "036000291452" });
    expect(r.errors).toEqual({});
    expect(r.config.beerName).toBe("HAZY");
  });
});
