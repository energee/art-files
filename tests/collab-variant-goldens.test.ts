// collab-variant-goldens.test.ts — the byte-identity gate for the shipped
// Lolev label in the only two states the product ships, Collab OFF and ON,
// each pinning all three deliverables: the art PDF, the mask PDF and the
// PSD. PDF timestamps are pinned (PDF_EPOCH in src/pdf/build.ts), so
// identical input builds byte-identical output and a sha256 IS byte
// identity.
//
// Collab ON mask PDF re-baselined 2026-11-03 (#668): a raster image's White
// Ink footprint follows its alpha instead of its whole rectangle. The 1x1
// slot fixture (onePxPng) is fully transparent, so each slot now draws an
// alpha-cut image XObject instead of a blue rect. 0 px changed at 600 DPI
// (both slots sit on the no-mask flood, blue either way):
// tests/goldens/collab-on-mask-alpha.diff.png. Art PDF, PSD and Collab OFF unchanged.
// PSD hashes re-baselined 2026-10-29 (#583): the dots QR finders carry
// Photoshop path operations (ring, subtract, dot) so Photoshop stops drawing
// them as solid discs. Same length; only the operation fields differ. PDFs
// unchanged.
// All hashes re-baselined 2026-10-27 (#542): the shipped QR encodes at
// error correction Q (was L), so its module pattern changes; the 600 DPI
// diffs (goldens/collab-off-{art,mask}-qr-ec.diff.png) light only the QR.
// PDF hashes re-baselined 2026-10-10: both plates now declare a TrimBox (the
// die inside the bleed) and BleedBox (the page) and a "Label Lab <version>"
// Producer. 0 px changed at 600 DPI on all four plates; PSDs are unchanged.
// The TrimBox is layout.ts's ART exactly. See tests/goldens/collab-*-boxes.diff.png
// (main vs. these plates). The version is pinned below so a
// release bump does not move these digests.
//
// Mask PDF hashes re-baselined 2026-09-28: the white-ink barcode follows the
// glyph stroke instead of a pill around each digit group. Art PDF and art PSD
// are unchanged. See tests/goldens/collab-*-mask-glyph.diff.png.
//
// All hashes re-baselined 2026-09-28: the quiet-zone backing plate is gone.
// The halo is the per-bar and per-digit stroke again. On these untextured
// fixtures the 600 DPI raster diff is 0 px (the plate was the same white as
// the stock); the PDF and PSD bytes move because the plate path is gone.
// See tests/goldens/collab-*-no-backing.diff.png.
//
// All hashes re-baselined 2026-09-27 (#359 review): the barcode backing
// fills the layer's 8X quiet zone instead of GS1's 9X. Zero changed pixels
// at 600 DPI on these fixtures; over a dark flood, 5,844 px at the backing's
// two ends only (see goldens/README.md).
//
// All hashes re-baselined 2026-11-02 (Starter master): the app no longer
// bundles the laurel as `builtin:logo`; the Lolev master carries it as an SVG
// image asset, which planLayers fits by its ink box instead of its viewBox
// (0.009pt taller). The only changed pixels at 600 DPI are a one-pixel
// anti-alias fringe around the laurel's outline (2171 art / 1312 mask, the
// same OFF and ON): tests/goldens/collab-{off,on}-{art,mask}-laurel-asset.diff.png.
// The PSD digests move for the same laurel path data.
//
// All hashes re-baselined 2026-09-27 (#284): barcode backing added.
// The bare-stock/flood PDF fixtures have zero changed pixels at 600 DPI.
// PSD backing geometry is tested; Photoshop visual review remains pending.
//
// Art PDFs re-baselined 2026-09-27 (#339): neutral vectors use DeviceGray.
// Both 600-DPI RGB raster diffs have zero changed pixels; mask/PSD unchanged.
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
// PSD digests RE-BASELINED 2026-09-26 for #338: every PSD now declares its
// export DPI — a ResolutionInfo (0x03ED) resource and an XMP packet with the
// tiff: resolution tags. Each file grew by exactly those two resources (28 +
// 350 bytes); no layer, pixel or PDF byte moved (the PDF digests are
// unchanged), and tests/psd-build.test.ts pins the declared print size.
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
import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { buildArtPdf, buildMaskPdf, type Assets } from "../src/pdf/build";
import { buildPsd } from "../src/psd/build";
import { assets as pdfFixture, lolevLayers, lolevPlan, onePxPng, psdAssets, type LolevOpts } from "./fixtures";

// The PDF Producer carries the app version; pin it so a release bump is not
// a golden change.
vi.mock("../package.json", () => ({ version: "0.0.0-golden" }));

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
      art: "9696a852e6b242588e7a641a764c9eff0776516702677ee33e62d7c7187a6b9b", artLen: 71227,
      mask: "e16db7a3fc2c8e63b18f5d6f881b3f1a1066cc4a2abafb044fd3b7a39a9d4e33", maskLen: 71336,
      psd: "4fe3b1b28b2822389ee437c48aaee81fbd73fdd4046220a7fc5925c724f782f4", psdLen: 1169316,
    });
  });
});

describe("collab byte-identity goldens — Collab variant ON, both slots loaded", () => {
  it("art PDF, mask PDF and PSD are byte-for-byte the re-baselined goldens", async () => {
    expect(digests(await shipped(["collab"]))).toEqual({
      art: "2800cc460d4a758b7f69c8a665b1a2fde8748d5e770a780eb869d92e9ba98590", artLen: 73132,
      mask: "34bf0aba9b20ed20598f15e6c6109be3a452c28029a8a72b97f863163c342429", maskLen: 73616,
      psd: "8fa9894c061bd463496d54edbfb8b936e65b3071bf5827afdb7c3aba60821aaa", psdLen: 1179336,
    });
  });
});
