// collab-variant-goldens.test.ts — the byte-identity gate for the shipped
// Lolev label in the only two states the product ships, Collab OFF and ON,
// each pinning all three deliverables: the art PDF, the mask PDF and the
// PSD. PDF timestamps are pinned (PDF_EPOCH in src/pdf/build.ts), so
// identical input builds byte-identical output and a sha256 IS byte
// identity.
//
// RE-BASELINED 2026-09-04 for the master-as-layers switch (spec: Goldens):
// the backends now draw a display list planned by planLayers over
// model/lolevLayers' data instead of a LabelConfig through layout.ts. The
// 600 DPI raster diffs against the previous goldens are committed beside
// this file as tests/goldens/collab-{off,on}-{art,mask}.diff.png; the only
// changed pixels (99275 art / 53661 mask, identical OFF and ON) are the
// warning's LAST column, which the old renderer justified to the full
// column length and the generic text path leaves at its natural length
// (spec: "justify on a last/only line degrades to left"). Nothing else
// moved — the collab block included.
//
//   OFF — the collab variant off: its three layers are not in the resolved
//         list at all, so BOTH slot assets being loaded (the hard case: art
//         in hand that must not draw) changes nothing.
//   ON  — the variant on, both slots bound to a 1x1 PNG and drawing.
//
// Only HALF this guard is load-bearing for collab: the four PDF digests
// really do differ between the two states. The PSD digests pin the PSD
// against unrelated drift (PSD raster review remains pending; see goldens/README.md) and prove the empty-slot rule (the PSD build here
// gets no pixels for the slots, so ON adds only the lead-in group); the
// real collab-art PSD guard is tests/psd-collab.test.ts.
//
// A digest that moves is NOT a golden to regenerate outside an approved
// rendering change: it is proof that what prints changed. Stop and report
// it, or re-baseline per docs/goldens.md with a reviewed diff PNG.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildArtPdf, buildMaskPdf, type Assets } from "../src/pdf/build";
import { buildPsd } from "../src/psd/build";
import { assets as pdfFixture, lolevLayers, lolevPlan, onePxPng, psdAssets, type LolevOpts } from "./fixtures";

const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** The shipped master with `variants` enabled and both slots bound to a
 *  loaded 1x1 PNG, handed to the builders exactly as the app hands them. */
async function shipped(variants: string[]) {
  const opts: LolevOpts = {
    variants,
    overrides: { collabLeft: { asset: "left" }, collabCenter: { asset: "center" } },
    custom: { left: { aspect: 1 }, center: { aspect: 1 } },
  };
  const png = { kind: "png" as const, bytes: onePxPng };
  const assets: Assets = { ...pdfFixture, images: { left: png, center: png } };
  const items = await lolevPlan(opts);
  const layers = lolevLayers(opts);
  return {
    art: await buildArtPdf(items, assets),
    mask: await buildMaskPdf(items, assets),
    psd: await buildPsd(items, psdAssets, "art", { layers }),
  };
}

const digests = (r: Awaited<ReturnType<typeof shipped>>) => ({
  art: hash(r.art), artLen: r.art.length,
  mask: hash(r.mask), maskLen: r.mask.length,
  psd: hash(r.psd), psdLen: r.psd.length,
});

describe("collab byte-identity goldens — Collab variant OFF, both slots loaded", () => {
  it("art PDF, mask PDF and PSD are byte-for-byte the re-baselined goldens", async () => {
    expect(digests(await shipped([]))).toEqual({
      art: "80217f6667bd2fc46774441e69968fca664c67b5d7938a7fad30fe3fc7d65c29", artLen: 57916,
      mask: "663472fc6d93ba8d9ed76f3834543c6520bf9a8d4378656abd071afb81de7e4d", maskLen: 57090,
      psd: "f470f1ac36c161adfd5868a042ed5718528904d4fe3241695584191e9701bec7", psdLen: 1155342,
    });
  });
});

describe("collab byte-identity goldens — Collab variant ON, both slots loaded", () => {
  it("art PDF, mask PDF and PSD are byte-for-byte the re-baselined goldens", async () => {
    expect(digests(await shipped(["collab"]))).toEqual({
      art: "9cfe5396f8ee63918d539e943fce1b0f3efdd75fc71fefcd785a10f7a4130984", artLen: 59799,
      mask: "bc6b233b530e7b04e5b45fbc984d89edb698ab683816741dd7f1196685a57a96", maskLen: 58946,
      psd: "608dc03ddd85c41b6618b2121ee40a8faea3d72b1f5ba222f1d64b3051ef557c", psdLen: 1165362,
    });
  });
});
