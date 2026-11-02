// lolev-master-file.test.ts — masters/lolev.master, written by
// scripts/export-lolev-master.ts, is the Lolev master as an ordinary file: it
// unpacks and validates, its layers are lolevMaster()'s, it carries the
// laurel SVG under the logo layer's asset id, and those packed bytes draw the
// laurel the same as the test fixtures' copy.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { unpackMaster } from "../src/model/files";
import { parseMaster } from "../src/model/layers";
import { LOGO_ASSET, lolevMaster } from "./fixtures/lolevMaster";
import { planLayerScene } from "../src/planLayers";
import { svgAspect } from "../src/logo";
import { measure, planAssets } from "./fixtures";

const root = join(import.meta.dirname, "..");
const file = unpackMaster(new Uint8Array(readFileSync(join(root, "masters", "lolev.master"))));

describe("masters/lolev.master", () => {
  it("unpacks cleanly and validates", () => {
    expect(() => parseMaster(JSON.parse(JSON.stringify(file.master)))).not.toThrow();
  });

  it("is lolevMaster()", () => {
    expect(file.master).toEqual(lolevMaster());
  });

  it("carries logo2025.svg's bytes under the logo's asset id", () => {
    const a = file.assets.customImages?.[LOGO_ASSET];
    expect(a?.name).toBe("logo2025.svg");
    expect(Buffer.from(a!.bytes).equals(readFileSync(join(root, "src", "assets", "logo2025.svg")))).toBe(true);
  });

  it("draws the laurel from its packed bytes as paths", () => {
    const svg = new TextDecoder().decode(file.assets.customImages![LOGO_ASSET].bytes);
    const only = file.master.layers.filter((l) => l.id === "logo");
    const packed = planLayerScene(only, measure, {
      custom: { [LOGO_ASSET]: { aspect: svgAspect(svg), art: { kind: "svg", svg } } },
    });
    expect(packed.items).toHaveLength(1);
    expect(packed.items[0].kind).toBe("paths");
    expect(packed).toEqual(planLayerScene(only, measure, planAssets));
  });
});
