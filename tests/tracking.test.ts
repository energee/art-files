// tracking.test.ts — per-element letter-spacing (Style.letterSpacing). The
// value is authored in PDF points and has to mean the same thing in four
// places: the width every renderer centres and justifies against, the hit
// box the preview draws, the PDF text-state operator that actually spaces
// the glyphs, and the deviation check that offers a Reset. One file, because
// the whole point of the feature is that those four cannot disagree.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, decodePDFRawStream } from "pdf-lib";
import { buildArtPdf, type Assets } from "../src/pdf/build";
import { boxOf } from "../src/hittest";
import { parseDescription } from "../src/description";
import { isDefaultStyle } from "../src/elements";
import { defaultConfig } from "../src/defaults";
import * as L from "../src/layout";

const measure = (text: string, size: number) => text.length * size * 0.55;

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

const asset = (p: string) => join(__dirname, "..", "src", "assets", p);
const assets: Assets = {
  fonts: {
    regular: readFileSync(asset("fonts/Poppins-Regular.ttf")),
    semibold: readFileSync(asset("fonts/Poppins-SemiBold.ttf")),
    bold: readFileSync(asset("fonts/Poppins-Bold.ttf")),
  },
  logoSvg: readFileSync(asset("logo2025.svg"), "utf8"),
};

/** Page-1 content stream as operator text (same helper as pdf-build.test.ts). */
async function contentStreamText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  const refs = (contents as { array?: unknown[] }).array ?? [contents];
  let out = "";
  for (const ref of refs) {
    const stream = doc.context.lookup(ref as never);
    out += new TextDecoder().decode(decodePDFRawStream(stream as never).decode());
  }
  return out;
}

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
    const text = await contentStreamText(await buildArtPdf(defaultConfig(), assets));
    expect(text).not.toMatch(/\bTc\b/);
  });
});
