// tracking.test.ts — per-element letter-spacing (Style.letterSpacing). The
// value is authored in PDF points and has to mean the same thing in four
// places: the width every renderer centres and justifies against, the hit
// box the preview draws, the PDF text-state operator that actually spaces
// the glyphs, and the deviation check that offers a Reset. One file, because
// the whole point of the feature is that those four cannot disagree.
import { describe, expect, it } from "vitest";
import { buildArtPdf, buildMaskPdf } from "../src/pdf/build";
import { boxOf } from "../src/hittest";
import { parseDescription } from "../src/description";
import { isDefaultStyle } from "../src/elements";
import { defaultConfig } from "../src/defaults";
import * as L from "../src/layout";
import { assets, contentStreamText, measure } from "./fixtures";

/** Show-text operators in a content stream. A stroked line draws each run
 *  twice — a Tr-2 stroke pass under the fill copy — so it emits more of
 *  these than a bare one; that ratio is the stroke evidence a stream
 *  carries. */
const showOps = (s: string) => (s.match(/\bTj\b/g) ?? []).length;

describe("trackedWidth", () => {
  it("adds one gap per adjacent glyph pair, not one per glyph", () => {
    // "abcd" has 3 gaps; counting the trailing advance PDF's Tc also emits
    // would give 4 and push every centred line off-centre.
    expect(L.trackedWidth(100, "abcd", 2)).toBe(106);
  });

  it("is the plain measured width at zero tracking, and for a lone glyph", () => {
    expect(L.trackedWidth(100, "abcd")).toBe(100);
    expect(L.trackedWidth(100, "a", 2)).toBe(100);
    expect(L.trackedWidth(100, "", 2)).toBe(100);
  });
});

describe("letter-spacing in the config model", () => {
  it("carries the description block's spacing onto every parsed line", () => {
    const d = parseDescription("# HOPS\nCitra", {
      fill: L.GOLD, layer: "metallic", letterSpacing: 0.6,
    });
    expect(d.header!.letterSpacing).toBe(0.6);
    expect(d.lines[0].letterSpacing).toBe(0.6);
  });

  it("counts a respaced element as deviating from its shipped style", () => {
    const cfg = defaultConfig();
    expect(isDefaultStyle("name", cfg.nameStyle)).toBe(true);
    expect(isDefaultStyle("name", { ...cfg.nameStyle, letterSpacing: 0.4 })).toBe(false);
    // Absent and an explicit 0 are the same thing to every renderer.
    expect(isDefaultStyle("name", { ...cfg.nameStyle, letterSpacing: 0 })).toBe(true);
  });
});

describe("hit boxes follow the tracked width", () => {
  it("widens a centred element by the gaps it gains, staying centred", () => {
    const cfg = defaultConfig();
    // The default name is blank (the renderer draws a placeholder), so give
    // the box real text to measure — gaps below count ITS glyphs.
    cfg.beerName = "LABRADORITE";
    const plain = boxOf("name", cfg, measure)!;
    cfg.nameStyle.letterSpacing = 1.5;
    const tracked = boxOf("name", cfg, measure)!;
    const gaps = cfg.beerName.length - 1;
    expect(tracked.x1 - tracked.x0).toBeCloseTo(plain.x1 - plain.x0 + 1.5 * gaps, 5);
    expect((tracked.x0 + tracked.x1) / 2).toBeCloseTo(L.NAME.cx, 5);
  });
});

describe("the art PDF's character-spacing operator", () => {
  it("emits Tc for a tracked element and clears it again", async () => {
    const cfg = defaultConfig();
    cfg.nameStyle.letterSpacing = 0.4;
    const text = await contentStreamText(await buildArtPdf(cfg, assets));
    expect(text).toContain("0.4 Tc");
    // Cleared after the draw: Tc is page-wide state, so a stray one would
    // silently space every element drawn after the name.
    expect(text).toContain("0 Tc");
  });

  it("emits no Tc at all when nothing is tracked", async () => {
    // Three elements ship tracked (Info 0.38pt, storeCold 1.25pt, the
    // warning -0.05pt), so clear them to get a genuinely untracked label —
    // the point of this test is that an element at 0 costs no operator, not
    // that the shipped defaults happen to be untracked.
    const cfg = defaultConfig();
    cfg.handleAddress.letterSpacing = 0;
    cfg.storeCold.letterSpacing = 0;
    cfg.warning.letterSpacing = 0;
    const text = await contentStreamText(await buildArtPdf(cfg, assets));
    expect(text).not.toMatch(/\bTc\b/);
  });

  it("ships the two tracked elements at their defaults", async () => {
    const text = await contentStreamText(await buildArtPdf(defaultConfig(), assets));
    expect(text).toContain("0.38 Tc"); // Info (handle / address)
    expect(text).toContain("1.25 Tc"); // store cold
  });
});

// Regression: the shipped black keyline on the rotated Info line. drawRotated
// draws each stroked run twice (a Tr-2 stroke pass under the fill copy), so a
// stroked line emits more show-text operators than a bare one — that ratio is
// the stroke evidence in the stream.
describe("the Info line's shipped keyline", () => {
  it("draws a stroke around Info in the art PDF", async () => {
    const stroked = await contentStreamText(await buildArtPdf(defaultConfig(), assets));
    const bare = defaultConfig();
    bare.handleAddress.stroke = "none";
    const plain = await contentStreamText(await buildArtPdf(bare, assets));
    expect(showOps(stroked)).toBeGreaterThan(showOps(plain));
  });
});

// The shipped keyline is pure black. The barcode is the deliberate exception
// — its stroke is the white halo the scan contrast depends on.
describe("the shipped keyline colour", () => {
  const KEYLINED = [
    "nameStyle", "styleLine", "abvStyle", "descStyle", "wordmark", "volume", "handleAddress",
  ] as const;

  it("ships #000000 on every keylined element, QR included", () => {
    const cfg = defaultConfig();
    for (const k of KEYLINED) {
      expect([k, cfg[k].stroke, cfg[k].strokeWidth]).toEqual([k, "#000000", 15]);
    }
    expect([cfg.qrStroke, cfg.qrStrokeWidth]).toEqual(["#000000", 15]);
    // The barcode keeps its white halo.
    expect(cfg.barcodeStroke).toBe("#FFFFFF");
  });

  it("draws the volume's stroke in that black on the art plate", async () => {
    const text = await contentStreamText(await buildArtPdf(defaultConfig(), assets));
    expect(text).toContain("0 0 0 rg");
    const bare = defaultConfig();
    bare.volume.stroke = "none";
    const plain = await contentStreamText(await buildArtPdf(bare, assets));
    expect(showOps(text)).toBeGreaterThan(showOps(plain));
  });
});

// Mask strokes are independent of the fill layer and therefore add their own
// stroke-pass show-text operations whenever enabled.
describe("a stroke on the mask plate", () => {
  it("draws its footprint regardless of the element's fill layer", async () => {
    for (const layer of ["metallic", "white"] as const) {
      const stroked = defaultConfig();
      stroked.handleAddress.layer = layer;
      const bare = defaultConfig();
      bare.handleAddress.layer = layer;
      bare.handleAddress.stroke = "none";
      const withRing = await contentStreamText(await buildMaskPdf(stroked, assets));
      const without = await contentStreamText(await buildMaskPdf(bare, assets));
      expect(showOps(withRing)).toBeGreaterThan(showOps(without));
    }
  });
});
