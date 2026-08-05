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
    // Two elements ship tracked (Info 0.38pt, storeCold 1.25pt),
    // so clear them to get a genuinely untracked label — the point of this
    // test is that an element at 0 costs no operator, not that the shipped
    // defaults happen to be untracked.
    const cfg = defaultConfig();
    cfg.handleAddress.letterSpacing = 0;
    cfg.storeCold.letterSpacing = 0;
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
// fakes an outer stroke as a ring of offset copies under the fill (pdf-lib
// cannot stroke text), so a stroked line emits many more show-text operators
// than a bare one — that ratio is the only stroke evidence in the stream,
// since the ring copies carry no operator of their own.
describe("the Info line's shipped keyline", () => {
  const showOps = (s: string) => (s.match(/\bTj\b/g) ?? []).length;

  it("draws a stroke ring around Info in the art PDF", async () => {
    const stroked = await contentStreamText(await buildArtPdf(defaultConfig(), assets));
    const bare = defaultConfig();
    bare.handleAddress.stroke = "none";
    const plain = await contentStreamText(await buildArtPdf(bare, assets));
    expect(showOps(stroked)).toBeGreaterThan(showOps(plain));
  });
});

// Regression: a stroked metallic line used to print a WHITE-INK halo. The
// mask knocked out the glyphs only, so the plate's flood survived in the
// stroke ring and the black keyline landed on white ink instead of bare
// stock. The mask must now knock the ring out too.
describe("a stroked line's mask plate", () => {
  const showOps = (s: string) => (s.match(/\bTj\b/g) ?? []).length;

  it("knocks out the stroke ring, not just the glyphs", async () => {
    const bare = defaultConfig();
    bare.handleAddress.stroke = "none";
    const stroked = await contentStreamText(await buildMaskPdf(defaultConfig(), assets));
    const plain = await contentStreamText(await buildMaskPdf(bare, assets));
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

  it("draws the volume's ring in that black on the art plate", async () => {
    const text = await contentStreamText(await buildArtPdf(defaultConfig(), assets));
    expect(text).toContain("0 0 0 rg");
    const bare = defaultConfig();
    bare.volume.stroke = "none";
    const plain = await contentStreamText(await buildArtPdf(bare, assets));
    const showOps = (s: string) => (s.match(/\bTj\b/g) ?? []).length;
    expect(showOps(text)).toBeGreaterThan(showOps(plain));
  });
});

// A stroke is an outline, not part of the plate choice its glyphs make: even
// on a white-layer element the ring knocks out, so white ink never prints
// under a keyline.
describe("a white-layer line's stroke", () => {
  const knockouts = (s: string) => (s.match(/\b1 1 1 rg\b/g) ?? []).length;

  it("knocks out rather than taking the white-ink layer", async () => {
    const white = defaultConfig();
    white.handleAddress.layer = "white";
    const bare = defaultConfig();
    bare.handleAddress.layer = "white";
    bare.handleAddress.stroke = "none";
    const withRing = await contentStreamText(await buildMaskPdf(white, assets));
    const without = await contentStreamText(await buildMaskPdf(bare, assets));
    expect(knockouts(withRing)).toBeGreaterThan(knockouts(without));
  });
});
