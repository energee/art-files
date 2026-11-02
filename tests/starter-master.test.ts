// The Starter master: the neutral built-in that replaces Lolev as the default
// (docs/plans/starter-master.md, task 2). Brand-free, asset-free, same page.
import { describe, expect, it } from "vitest";
import { parseMaster } from "../src/model/layers";
import { starterMaster } from "../src/model/starterLayers";
import { lolevMaster } from "../src/model/lolevLayers";

describe("starterMaster", () => {
  it("passes the master validator", () => {
    expect(() => parseMaster(starterMaster())).not.toThrow();
  });

  it("is the Starter master with Lolev's page size and no variants", () => {
    const m = starterMaster();
    expect(m.id).toBe("starter");
    expect(m.name).toBe("Starter");
    expect(m.physical).toEqual(lolevMaster().physical);
    expect(m.variants).toEqual([]);
  });

  it("has exactly the generic layers", () => {
    expect(starterMaster().layers.map((l) => l.id)).toEqual([
      "background", "mask", "volume", "abv", "description", "name", "styleLine", "warning",
    ]);
  });

  it("references no assets", () => {
    for (const l of starterMaster().layers) {
      if (l.kind === "image") expect(l.asset).toBe("");
    }
  });

  it("contains no Lolev branding anywhere", () => {
    expect(JSON.stringify(starterMaster())).not.toMatch(/lolev/i);
  });
});
