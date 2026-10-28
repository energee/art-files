// image-scale-fold.test.ts — image `scale` is gone from the model. It used to
// multiply w and h at draw time (planLayers), while a canvas resize and the
// inspector wrote w/h only, so a typed Width was not the drawn width. Files
// that still carry it are folded on read: w and h absorb the scale and the key
// is dropped, in the master's layers, its variant diffs and a label's
// overrides. The drawn geometry must not move, so the expected boxes below are
// what planLayers drew for these same files BEFORE the fold existed.
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { unpackLabel, unpackMaster, serializeMaster } from "../src/model/files";
import { foldLabelScale, resolveLayers } from "../src/model/resolveLayers";
import { lolevMaster } from "../src/model/lolevLayers";
import { planLayers } from "../src/planLayers";
import type { PlanAssets } from "../src/plan";
import { logoSvg } from "./fixtures";

const STYLE = { fill: "#F3CD80", layer: "metallic" } as const;
const art = (id: string, asset: string, size: Record<string, number>) => ({
  id, name: id, kind: "image", enabled: true, x: 100, anchor: "left", y: 100, asset, style: STYLE, ...size,
});

/** A v3 master.json as a pre-fold Label Lab wrote it: scale on master layers
 *  (with and without a height, and on the laurel, where it never drew), on a
 *  variant's diff of a master layer, and on a variant's added layer. */
function oldMasterJson() {
  const m = JSON.parse(serializeMaster(lolevMaster()));
  m.layers.push(
    art("art1", "a1", { w: 70, h: 44, scale: 0.5 }),
    art("art2", "a2", { w: 40, scale: 1.5 }),
    art("art4", "a1", { w: 50, h: 20 }),
  );
  m.layers.find((l: { id: string }) => l.id === "logo").scale = 3;
  const collab = m.variants.find((v: { id: string }) => v.id === "collab");
  collab.layers.art1 = { scale: 2 };
  collab.layers.collabLeft.scale = 0.8;
  return m;
}

/** A v3 label.json against it: scale alone, scale with a width, and an added
 *  layer of the label's own. */
function oldLabelJson() {
  return {
    formatVersion: 3, masterId: "lolev", enabledVariants: ["collab"],
    values: { collabLeft: "a2", collabCenter: "a1" },
    overrides: {
      collabCenter: { scale: 1.25 },
      art4: { w: 60, scale: 0.75 },
      art3: art("art3", "a2", { w: 30, h: 30, scale: 1.2 }),
    },
  };
}

const ASSETS: PlanAssets = {
  logoSvg,
  custom: { a1: { aspect: 2 }, a2: { aspect: 0.5 } },
};
const measure = (text: string, size: number) => text.length * size * 0.55;

function openOld() {
  const { master } = unpackMaster(zipSync({ "master.json": strToU8(JSON.stringify(oldMasterJson())) }));
  const { label } = unpackLabel(zipSync({ "label.json": strToU8(JSON.stringify(oldLabelJson())) }));
  return { master, label: foldLabelScale(label!, master) };
}

/** Every image and paths item's box, by layer id. */
function drawn(master: ReturnType<typeof openOld>["master"], label: ReturnType<typeof openOld>["label"]) {
  const { layers } = resolveLayers(master, label.enabledVariants, label.values, label.overrides);
  const out: Record<string, number[]> = {};
  for (const item of planLayers(layers, measure, ASSETS)) {
    if (item.kind === "image") out[item.id] = [item.x, item.y, item.w, item.h];
    else if (item.kind === "paths" && item.id === "logo") out.logo = [item.x, item.y];
  }
  return out;
}

/** What planLayers drew for oldMasterJson + oldLabelJson before the fold,
 *  captured from the pre-change build (x, y, w, h; the laurel's x, y). */
const BEFORE: Record<string, number[]> = {
  logo: [275.81, 164.6796875],
  art1: [100, 100, 140, 70],
  art2: [100, 100, 60, 120],
  art4: [100, 100, 30, 15],
  collabLeft: [28.68, 117.88, 17.6, 35.2],
  collabCenter: [270.06, 215.3203125, 45, 22.5],
  art3: [100, 100, 18, 36],
};

describe("image scale folds into w/h on read", () => {
  it("drops scale from the master, its variants and the label", () => {
    const { master, label } = openOld();
    const json = JSON.stringify({ master, label });
    expect(json).not.toContain('"scale"');
    const byId = (id: string) => master.layers.find((l) => l.id === id) as unknown as Record<string, unknown>;
    expect(byId("art1")).toMatchObject({ w: 35, h: 22 });
    // No height: it still follows the asset's aspect, at the scaled width.
    expect(byId("art2").w).toBe(60);
    expect(byId("art2").h).toBeUndefined();
    // The laurel never drew its scale (parseLogo reads w alone), so it stays.
    expect(byId("logo").w).toBe((lolevMaster().layers.find((l) => l.id === "logo") as { w: number }).w);
    // A variant's scale alone pins the master's size times it.
    expect(master.variants[0].layers.art1).toEqual({ w: 140, h: 88 });
    expect(master.variants[0].layers.collabLeft).toMatchObject({ w: 56, h: expect.closeTo(35.2, 9) });
    expect(label.overrides).toMatchObject({
      collabCenter: { w: 45, h: 45 }, art4: { w: 45, h: 15 },
      art3: { w: expect.closeTo(36, 9), h: expect.closeTo(36, 9) },
    });
  });

  it("draws an old file exactly where it drew before", () => {
    const { master, label } = openOld();
    const now = drawn(master, label);
    expect(Object.keys(now).sort()).toEqual(Object.keys(BEFORE).sort());
    for (const [id, box] of Object.entries(BEFORE))
      box.forEach((v, i) => expect(now[id][i], `${id}[${i}]`).toBeCloseTo(v, 9));
  });
});
