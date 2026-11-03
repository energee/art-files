// outside-guides.test.ts — outsideGuides, the "runs off the label" warning
// (#607): App passes the die, and a layer whose drawn box crosses it gets the
// Layers dot and an inspector line, without blocking export. Measured with
// pdf-lib's embedded Poppins widths, the metrics export plans with.
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { assets } from "./fixtures";
import { lolevMaster } from "./fixtures/lolevMaster";
import { starterMaster } from "../src/model/starterLayers";
import { resolveLayers } from "../src/model/resolveLayers";
import { guideLines } from "../src/model/convert";
import { layerBoxes, outsideGuides } from "../src/planLayers";
import type { Master } from "../src/model/layers";
import type { MeasureFace } from "../src/plan";

async function measure(): Promise<MeasureFace> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f = {
    regular: await doc.embedFont(assets.fonts.regular),
    semibold: await doc.embedFont(assets.fonts.semibold),
    bold: await doc.embedFont(assets.fonts.bold),
  };
  return (t, size, face) => f[face].widthOfTextAtSize(t, size);
}

const pastDie = async (master: Master, variants: string[] = [], values = {}) => {
  const layers = resolveLayers(master, variants, values).layers;
  const die = guideLines({ physical: master.physical, guides: { left: null, center: null, right: null, top: null, bottom: null } });
  const boxes = layerBoxes(layers, await measure(),
    { guides: guideLines(master), custom: { logo: { aspect: 1 } } });
  return [...outsideGuides(boxes, die)];
};

describe("outsideGuides against the die (#607)", () => {
  it("flags nothing on the shipped masters", async () => {
    expect(await pastDie(lolevMaster())).toEqual([]);
    expect(await pastDie(lolevMaster(), ["collab"])).toEqual([]);
    expect(await pastDie(starterMaster())).toEqual([]);
  });

  it("flags an unwrapped name typed past both die edges, and only it", async () => {
    const name = "Labradorite Haze Double IPA with Citra and Mosaic Hops Brewed for the Long Winter Nights";
    expect(await pastDie(starterMaster(), [], { name })).toEqual(["name"]);
  });
});
