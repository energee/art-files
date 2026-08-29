// collab-variant-goldens.test.ts — the byte-identity gate for Task 5c, which
// deletes `LabelConfig.collabEnabled` and lets the Collab variant's own
// disabled-layer set do the suppressing instead.
//
// These digests were taken BEFORE that change, against the shipped Lolev
// master, in both of the only two states the product ships:
//   OFF — resolve(lolevMaster(), [], {}): the collab flag false, the three
//         collab layers in `disabledLayers`, and BOTH logo slots nonetheless
//         loaded (the hard case: art in hand that must not draw).
//   ON  — resolve(lolevMaster(), ["collab"], {}): the flag true, no layer
//         disabled, both slots loaded and drawing.
// Each state pins all three deliverables: the art PDF, the mask PDF and the
// PSD. PDF timestamps are pinned (PDF_EPOCH in src/pdf/build.ts), so identical
// input builds byte-identical output and a sha256 IS byte identity.
//
// Only HALF this guard is load-bearing for collab: the four PDF digests (art
// + mask, OFF and ON) really do differ between the two states, so a
// regression in the PDF collab path fails here. The two PSD digests are
// byte-identical to each other (same hash, same 882336-byte length, OFF and
// ON) — this suite hands buildPsd no collab assets (`psdAssets` carries
// none), and an absent slot plans nothing, so these PSD assertions pin the
// PSD against unrelated drift AND prove the empty-slot no-op, but do not
// exercise collab art in the PSD. The real collab-art PSD guard is
// tests/psd-collab.test.ts, which builds WITH partner art in both slots.
//
// A digest that moves is NOT a golden to regenerate: for the PDF digests it
// is proof that dropping `cfg.collabEnabled &&` from the renderers changed
// what prints; for the PSD digests it is proof something unrelated to collab
// changed the PSD. Either way, stop and report it instead.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildArtPdf, buildMaskPdf, type Assets, type CollabImage } from "../src/pdf/build";
import { buildPsd } from "../src/psd/build";
import { resolve } from "../src/model/resolve";
import { lolevMaster } from "../src/model/lolev";
import type { ElementId } from "../src/elements";
import { assets as pdfFixture, psdAssets } from "./fixtures";

const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** A minimal embeddable 1x1 PNG standing in for a partner's logo — the point
 *  is that art IS loaded in both slots, not what it depicts. */
const onePxPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const partnerLogo: CollabImage = { kind: "png", bytes: onePxPng };

/** The shipped master resolved with `variants` enabled, handed to a builder
 *  exactly as the app hands it over: the resolved config plus the resolver's
 *  own disabled-layer set as the renderers' skip set. */
function shipped(variants: string[]) {
  const r = resolve(lolevMaster(), variants, {});
  const hidden = r.disabledLayers as ReadonlySet<string> as { has(id: ElementId): boolean };
  const assets: Assets = {
    ...pdfFixture, collabLeft: partnerLogo, collabCenter: partnerLogo, hidden,
  };
  return { cfg: r.config, assets };
}

describe("collab byte-identity goldens — Collab variant OFF, both slots loaded", () => {
  it("art PDF, mask PDF and PSD are byte-for-byte what they were before Task 5c", async () => {
    const { cfg, assets } = shipped([]);
    const art = await buildArtPdf(cfg, assets);
    const mask = await buildMaskPdf(cfg, assets);
    const psd = await buildPsd(cfg, psdAssets);
    expect({
      art: hash(art), artLen: art.length,
      mask: hash(mask), maskLen: mask.length,
      psd: hash(psd), psdLen: psd.length,
    }).toEqual({
      art: "1aa544e8fbc112411f62a1d4c3eec067e0a5fcf2e09c87d08dd1a9146829d7f1",
      artLen: 62878,
      mask: "51f02240022ce0b20343cfc334d92109b0e726a36c2a347d5c91339f16a24ac4",
      maskLen: 61928,
      psd: "5421f3775cc47dbf3d272b374b63b5b84eddf0ce11b43240868402f19b6ea445",
      psdLen: 882336,
    });
  });
});

describe("collab byte-identity goldens — Collab variant ON, both slots loaded", () => {
  it("art PDF, mask PDF and PSD are byte-for-byte what they were before Task 5c", async () => {
    const { cfg, assets } = shipped(["collab"]);
    const art = await buildArtPdf(cfg, assets);
    const mask = await buildMaskPdf(cfg, assets);
    const psd = await buildPsd(cfg, psdAssets);
    expect({
      art: hash(art), artLen: art.length,
      mask: hash(mask), maskLen: mask.length,
      psd: hash(psd), psdLen: psd.length,
    }).toEqual({
      art: "11eb6ce3fda3c53dda13b54a8320af388d3570aeb0bc0b2a64e83d2e38295944",
      artLen: 64642,
      mask: "498fb178bf480d7e294527e6cb45bd657d031552e180584d6554e7923021f833",
      maskLen: 63654,
      psd: "5421f3775cc47dbf3d272b374b63b5b84eddf0ce11b43240868402f19b6ea445",
      psdLen: 882336,
    });
  });
});
