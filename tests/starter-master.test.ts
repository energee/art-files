// The Starter master: the neutral built-in that replaces Lolev as the default
// (docs/plans/starter-master.md, task 2). Brand-free, asset-free, same page.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMaster } from "../src/model/layers";
import { starterMaster } from "../src/model/starterLayers";
import { lolevMaster } from "./fixtures/lolevMaster";

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

// Task 6: no Lolev URL or brewery default ships in the app. The legacy v1
// LabelConfig baseline (defaults.ts's handleAddress) is the one deliberate
// exception: convertConfigV1 diffs old labels against what old builds wrote.
describe("the app source", () => {
  const src = join(import.meta.dirname, "..", "src");
  const files = (readdirSync(src, { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f));

  it("ships no lolev.beer URL", () => {
    const hits = files.filter((f) => /lolev\.beer/i.test(readFileSync(join(src, f), "utf8")));
    expect(hits).toEqual([]);
  });
});
