// lolev-master-file.test.ts — masters/lolev.master, written by
// scripts/export-lolev-master.ts, is the built-in Lolev master as an ordinary
// file: it unpacks and validates, its layers are lolevMaster()'s except that
// the laurel is a real SVG image asset instead of `builtin:logo`, and that
// asset draws the laurel where the builtin did (to within 0.01 pt).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { unpackMaster } from "../src/model/files";
import { parseMaster, type ImageLayer } from "../src/model/layers";
import { lolevMaster } from "../src/model/lolevLayers";
import { planLayerScene } from "../src/planLayers";
import type { PlacedPaths } from "../src/plan";
import { svgAspect } from "../src/logo";
import { logoSvg, measure } from "./fixtures";

/** The laurel's asset id in the exported file (scripts/export-lolev-master.ts). */
const LOLEV_LOGO_ASSET = "custom-asset-laurel";
const root = join(import.meta.dirname, "..");
const file = unpackMaster(new Uint8Array(readFileSync(join(root, "masters", "lolev.master"))));

describe("masters/lolev.master", () => {
  it("unpacks cleanly and validates", () => {
    expect(file.warnings).toEqual([]);
    expect(() => parseMaster(JSON.parse(JSON.stringify(file.master)))).not.toThrow();
  });

  it("is lolevMaster() with the laurel as an image asset", () => {
    const expected = lolevMaster();
    const logo = expected.layers.find((l) => l.id === "logo") as ImageLayer;
    logo.asset = LOLEV_LOGO_ASSET;
    expect(file.master).toEqual(expected);
  });

  it("carries logo2025.svg's bytes under the logo's asset id", () => {
    const a = file.assets.customImages?.[LOLEV_LOGO_ASSET];
    expect(a?.name).toBe("logo2025.svg");
    expect(Buffer.from(a!.bytes).equals(readFileSync(join(root, "src", "assets", "logo2025.svg")))).toBe(true);
  });

  // builtin:logo scaled the laurel by its viewBox; an SVG image asset fits
  // its ink box (src/logo.ts parseLogoUncached). The laurel's ink nearly fills
  // its 480x525 viewBox, so the two land within 0.01 pt with the layer as is.
  it("draws the laurel where builtin:logo did, to within 0.01 pt", () => {
    const only = (layers: typeof file.master.layers) => layers.filter((l) => l.id === "logo");
    const builtin = planLayerScene(only(lolevMaster().layers), measure, { logoSvg });
    const asset = planLayerScene(only(file.master.layers), measure, {
      logoSvg: "",
      custom: { [LOLEV_LOGO_ASSET]: { aspect: svgAspect(logoSvg), art: { kind: "svg", svg: logoSvg } } },
    });
    const [b, a] = [builtin.boxes.get("logo")!, asset.boxes.get("logo")!];
    for (const k of ["x", "y", "w", "h"] as const) expect(Math.abs(a[k] - b[k])).toBeLessThan(0.01);
    const [pb, pa] = [builtin.items[0] as PlacedPaths, asset.items[0] as PlacedPaths];
    expect(asset.items).toHaveLength(1);
    expect({ ...pa, paths: pa.paths.length, x: 0, y: 0 }).toEqual({ ...pb, paths: pb.paths.length, x: 0, y: 0 });
    expect(Math.abs(pa.x - pb.x)).toBeLessThan(0.01);
    expect(Math.abs(pa.y - pb.y)).toBeLessThan(0.01);
  });
});
