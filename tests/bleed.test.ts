// bleed.test.ts — the bleed knob and, mostly, the one mechanism that makes it
// safe: layout.ts's position constants are page-absolute at MEASURED_BLEED and
// are NOT rebased when the bleed changes, so every output boundary adds
// BLEED_SHIFT exactly once instead. These tests are the guard on that.
//
// The load-bearing one is "keeps every element the same distance from the
// trim": it measures through a real boundary (hittest, which the preview's
// clicks and selection outlines go through) at two different bleeds and
// asserts nothing moved relative to the die. If the shift were missed at a
// boundary, applied twice, or folded into the constants, that test fails —
// which is the whole reason not to re-derive twenty measured numbers by hand.
import { afterEach, describe, expect, it } from "vitest";
import * as L from "../src/layout";
import { readPsd } from "ag-psd";
import { buildMaskPdf } from "../src/pdf/build";
import { buildPsd } from "../src/psd/build";
import { pointToUnit } from "../src/rulers";
import {
  BLEED_STEP_IN, DEFAULT_RENDER, commitBleedIn, displayBleedIn,
} from "../src/settings";
import { assets, boxOfLayer, contentStreamText, flatLayers, measureBW, psdAssets, lolevLayers, lolevPlan, logoSvg, pageRectPath } from "./fixtures";

/** A press-standard 1/8" bleed — nearly double the shipped one, so anything
 *  that quietly ignores the knob shows up as a large, obvious error rather
 *  than a rounding difference. */
const WIDE_IN = 0.125;

// Every test here mutates module state, so each one hands it back. Without
// this a failure mid-test would leave the rest of the suite building at the
// wrong bleed — and since the whole point is that a wrong bleed is silent,
// that would surface as confusing failures somewhere else entirely.
afterEach(() => L.setBleed(L.SHIPPED_BLEED_IN));

describe("bleed — the shipped default", () => {
  it("reproduces the Photoshop-era page exactly, and shifts nothing", () => {
    // The proof that turning this file live was a no-op. If BLEED_SHIFT is not
    // 0 here, every measured constant is being moved and the pdf-build /
    // psd-build / hittest suites are all describing a label that shifted.
    expect(L.BLEED_SHIFT).toBe(0);
    expect(L.PAGE.w).toBe(585.12);
    expect(L.PAGE.h).toBe(369.12);
    expect(L.ART.x).toBe(4.56);
    expect(L.ART.y).toBe(4.56);
  });

  it("ships the default at a round 0.0635 even though it measured 4.56pt", () => {
    // Two different numbers, deliberately. The positions were measured against
    // 4.56pt = 0.063333...in, which is what BLEED_SHIFT is computed from...
    expect(L.SHIPPED_BLEED_IN * 72).toBe(4.56);
    // ...while the app ships the round figure the artboard has always been
    // quoted at: 8.127in, and (8.127 - 8) / 2 is 0.0635.
    expect(DEFAULT_RENDER.bleedIn).toBe(0.0635);
    // The cost is a slightly larger page and a non-zero shift.
    L.setBleed(DEFAULT_RENDER.bleedIn);
    expect(L.BLEED_SHIFT).toBeCloseTo(0.012, 10);
    expect(L.PAGE.w).toBeCloseTo(585.144, 10);
    // 8.127in exactly, the figure the artboard has always been quoted at.
    expect(pointToUnit(L.PAGE.w, 0, "in")).toBeCloseTo(8.127, 10);
    expect(pointToUnit(L.PAGE.h, 0, "in")).toBeCloseTo(5.127, 10);
  });

  it("moves nothing on the die by shipping that rounded default", () => {
    // The safety argument for the line above, made by measurement rather than
    // assertion: the shift is applied uniformly at every output boundary, so
    // rounding the bleed grows the PAGE and leaves every element exactly where
    // it was relative to the TRIM — the edge the label is actually cut on.
    const at = (bleedIn: number) => {
      L.setBleed(bleedIn);
      const b = boxOfLayer("barcode", lolevLayers(), (t, s, f) => measureBW(t, s, f !== "regular"), { logoSvg })!;
      return { left: b.x - L.ART.x, top: b.y - L.ART.y };
    };
    const measured = at(L.SHIPPED_BLEED_IN);
    const shipped = at(DEFAULT_RENDER.bleedIn);
    expect(shipped.left).toBeCloseTo(measured.left, 10);
    expect(shipped.top).toBeCloseTo(measured.top, 10);
  });

  it("does not let the field's own rounding round-trip into storage", () => {
    // The measured bleed is finer than the field's four decimals, so it shows
    // as 0.0633 and would commit as 0.0633. Storing that changes the document —
    // the page and every element move — because a field was focused.
    const shown = displayBleedIn(L.SHIPPED_BLEED_IN);
    expect(shown).toBe(0.0633);
    expect(shown).not.toBe(L.SHIPPED_BLEED_IN);

    // Echoing it back is a no-op on the STORED value.
    expect(commitBleedIn(L.SHIPPED_BLEED_IN, shown)).toBe(L.SHIPPED_BLEED_IN);
    L.setBleed(commitBleedIn(L.SHIPPED_BLEED_IN, shown));
    expect(L.BLEED_SHIFT).toBe(0);
    expect(L.PAGE.w).toBe(585.12);

    // ...while a real edit still lands, or the knob would not be a knob.
    expect(commitBleedIn(L.SHIPPED_BLEED_IN, 0.125)).toBe(0.125);
    expect(commitBleedIn(0.125, 0.13)).toBe(0.13);
    // Including one only the finer display precision can express, which the
    // guard must not mistake for an echo of the shipped value.
    expect(commitBleedIn(L.SHIPPED_BLEED_IN, 0.0635)).toBe(0.0635);
    // And the guard only ever absorbs the CURRENT value: a stored value the
    // field can express echoes back unchanged anyway, so nothing is stuck.
    expect(commitBleedIn(0.125, 0.125)).toBe(0.125);

    // The shipped default must survive being TYPED, not just displayed. At a
    // 0.005 step ScrubField snapped every commit to three decimals, so 0.0635
    // became 0.064 the moment the field was touched — the page grew 0.072pt
    // and the field showed a bleed nobody chose. BLEED_STEP_IN is what stops
    // that, and it is the reason the guard below is a narrow special case
    // rather than the thing holding the shipped value together.
    expect(BLEED_STEP_IN).toBe(0.0005);
    expect(displayBleedIn(0.0635)).toBe(0.0635);
    expect(Number((0.0635).toFixed(3))).toBe(0.064); // what the old step did
    expect(commitBleedIn(0.0635, 0.0635)).toBe(0.0635);
    // ...and 0.064 is now a real, reachable value rather than a rounding
    // artifact, so it must land instead of being absorbed as an echo.
    expect(commitBleedIn(0.0635, 0.064)).toBe(0.064);
    // A drag off it steps by the coarser drag increment and also lands.
    expect(commitBleedIn(0.0635, 0.0685)).toBe(0.0685);
  });

  it("survives a JSON round-trip, since it is stored as JSON per operator", () => {
    // The default is a derived value (4.56/72), not a typed one, so it has to
    // come back out of storage as the same double or the shipped
    // label stops being byte-identical the first time settings are saved.
    const stored = JSON.parse(JSON.stringify({ bleedIn: L.SHIPPED_BLEED_IN })).bleedIn;
    expect(stored).toBe(L.SHIPPED_BLEED_IN);
    L.setBleed(stored);
    expect(L.BLEED_SHIFT).toBe(0);
    expect(L.PAGE.w).toBe(585.12);
  });
});

describe("bleed — the knob", () => {
  it("grows the page around the die without resizing the die", () => {
    L.setBleed(WIDE_IN);
    expect(L.ART.x).toBe(9);
    expect(L.ART.y).toBe(9);
    expect(pointToUnit(L.PAGE.w, 0, "in")).toBeCloseTo(8.25, 10);
    expect(pointToUnit(L.PAGE.h, 0, "in")).toBeCloseTo(5.25, 10);
    // The trim is what the label is ordered at; it must not move with the knob.
    expect([pointToUnit(L.ART.w, 0, "in"), pointToUnit(L.ART.h, 0, "in")]).toEqual([8, 5]);
    expect(L.ART.w).toBe(L.TRIM.w);
    expect(L.ART.h).toBe(L.TRIM.h);
  });

  it("carries the derived geometries with it", () => {
    L.setBleed(WIDE_IN);
    // PSD_DOC is the page at the output DPI, so it follows the page...
    expect(L.PSD_DOC.w).toBe(4950);
    expect(L.PSD_DOC.h).toBe(3150);
    // ...and TRIM_UV is the die's box within it, which the 3D views crop to.
    expect(L.TRIM_UV.x).toBeCloseTo(9 / 594, 10);
    expect(L.TRIM_UV.w).toBeCloseTo(576 / 594, 10);
  });
});

describe("bleed — the shift mechanism", () => {
  // THE regression guard. Distances are measured from the TRIM, because that
  // is the edge the label is cut on and the only thing an element's position
  // is really specified against; the page edge is just where the bleed happens
  // to end. Measured through hittest — a genuine output boundary, not a
  // recomputation of BLEED_SHIFT, so this cannot pass by restating the bug.
  const distancesFromTrim = (id: "barcode" | "wordmark" | "qr") => {
    const box = boxOfLayer(id, lolevLayers(), (t, s, f) => measureBW(t, s, f !== "regular"), { logoSvg });
    if (!box) throw new Error(`no box for ${id}`);
    return { left: box.x - L.ART.x, top: box.y - L.ART.y };
  };

  it("keeps every element the same distance from the trim at either bleed", () => {
    // The barcode is the tightest fit on the label, and the centre column is
    // the case that LOOKS like it needs special handling (CENTER_X reads as a
    // page-width derivation) — if the uniform shift is right, neither moves.
    const ids = ["barcode", "wordmark", "qr"] as const;
    const shipped = ids.map(distancesFromTrim);
    L.setBleed(WIDE_IN);
    const wide = ids.map(distancesFromTrim);
    ids.forEach((id, i) => {
      expect(wide[i].left, `${id} left`).toBeCloseTo(shipped[i].left, 10);
      expect(wide[i].top, `${id} top`).toBeCloseTo(shipped[i].top, 10);
    });
  });

  it("does move the elements relative to the PAGE, which is the point", () => {
    // Guards the inverse mistake: a boundary that ignored the knob entirely
    // would also keep trim distances equal — by never moving anything at all.
    const before = boxOfLayer("barcode", lolevLayers(), (t, s, f) => measureBW(t, s, f !== "regular"), { logoSvg })!;
    L.setBleed(WIDE_IN);
    const after = boxOfLayer("barcode", lolevLayers(), (t, s, f) => measureBW(t, s, f !== "regular"), { logoSvg })!;
    expect(after.x - before.x).toBeCloseTo(4.44, 10);
    expect(after.y - before.y).toBeCloseTo(4.44, 10);
  });
});

describe("bleed — the PSD boundary", () => {
  // The other two boundaries apply the shift in ONE place each — a single
  // translate operator, a single map over the boxes — so they are hard to apply
  // half of. The PSD applies it through pos(), which every coordinate has to be
  // routed through by hand while sizes keep using px(). That is a convention,
  // and conventions rot: nothing in the types stops a new element being wired to
  // px() and quietly not moving with the page. This is that convention's guard.
  const infoOriginPx = async (bleedIn: number) => {
    L.setBleed(bleedIn);
    const doc = readPsd(
      Buffer.from(await buildPsd(await lolevPlan(), psdAssets, "art", { layers: lolevLayers() })).buffer as ArrayBuffer,
      { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true },
    );
    const t = flatLayers(doc.children).find((l) => l.name === "Info" && l.text)?.text?.transform;
    if (!t) throw new Error("Info layer has no text transform");
    // Slots 4 and 5 of the affine transform are the translation, in pixels at
    // OUTPUT_DPI. Measured from the TRIM, so the answer is bleed-independent.
    const trimPx = (pt: number) => (pt / 72) * L.OUTPUT_DPI;
    return { x: t[4] - trimPx(L.ART.x), y: t[5] - trimPx(L.ART.y) };
  };

  it("keeps a text layer the same distance from the trim at either bleed", async () => {
    const shipped = await infoOriginPx(L.SHIPPED_BLEED_IN);
    const wide = await infoOriginPx(WIDE_IN);
    expect(wide.x).toBeCloseTo(shipped.x, 6);
    expect(wide.y).toBeCloseTo(shipped.y, 6);
    // And it really did move on the page, so this can't pass by never shifting.
    expect(L.ART.x).toBe(9);
  });
});

describe("bleed — the PDF boundary", () => {
  it("still floods the whole plate, so the bleed prints rather than showing paper", async () => {
    // The design shifts; the page-covering paints must NOT, or the extra bleed
    // is blank stock — a white band around the artwork that gets trimmed into
    // the label whenever the cut drifts. This is what the ordering inside
    // buildMaskPdf (flood, then shiftForBleed, then drawElements) protects.
    L.setBleed(WIDE_IN);
    const text = await contentStreamText(await buildMaskPdf(await lolevPlan(), assets));
    const flood = pageRectPath();
    expect(text).toContain(flood);
    // The design after it is translated by the shift, exactly once.
    const shift = "1 0 0 1 4.44 -4.44 cm";
    expect(text.split(shift).length - 1).toBe(1);
    // ...and ORDER is the actual invariant, which the two assertions above
    // cannot see: a `cm` changes where the flood lands without changing one
    // character of its path, so a shift emitted too early leaves the rect
    // reading `0 0 -> PAGE.w PAGE.h` while painting it 4.44pt down and right,
    // stripping the bleed off two edges. Position in the stream is the only
    // evidence of that, so assert on it.
    expect(text.indexOf(flood)).toBeLessThan(text.indexOf(shift));
  });

  it("emits no transform at the shipped bleed, so the bytes are unchanged", async () => {
    const text = await contentStreamText(await buildMaskPdf(await lolevPlan(), assets));
    expect(text).not.toContain("1 0 0 1 4.44 -4.44 cm");
  });
});
