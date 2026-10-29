// collab-variant-goldens.test.ts — the byte-identity gate for the shipped
// Lolev label in the only two states the product ships, Collab OFF and ON,
// each pinning all three deliverables: the art PDF, the mask PDF and the
// PSD. PDF timestamps are pinned (PDF_EPOCH in src/pdf/build.ts), so
// identical input builds byte-identical output and a sha256 IS byte
// identity.
//
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
      art: "e27905f277f406b6a4c540119b5be34d1698007575ffa82110014f5d1dd0d941", artLen: 71223,
      mask: "1cd8b8976beb293149440f8414a15d94882b17665ce2e50f145039a8a1d7eac5", maskLen: 71337,
      psd: "fda7b409dbb1e6d3b6abfdaa3c4df5b87c295962010759bdc1690598117f753b", psdLen: 1169316,
    });
  });
});

describe("collab byte-identity goldens — Collab variant ON, both slots loaded", () => {
  it("art PDF, mask PDF and PSD are byte-for-byte the re-baselined goldens", async () => {
    expect(digests(await shipped(["collab"]))).toEqual({
      art: "59ec5a6ea1ee65123a329c9f1b253a03ae9c9855a5dee3419d1db0148433ddb0", artLen: 73126,
      mask: "ea1fec44e7188212333a40d14dd1ffaf3be7bc2b89861c9078d1ad180bde1afd", maskLen: 73151,
      psd: "78cb7e412db6ed3546d913b5ed0d71e001872d9a9fa2f1ee927d3533bd012c54", psdLen: 1179336,
    });
  });
});
