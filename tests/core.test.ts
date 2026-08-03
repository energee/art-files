// core.test.ts — pure-logic coverage: UPC-A encode/validate, QR geometry,
// mask polarity rules, and config JSON round-trip.
import { describe, expect, it } from "vitest";
import { encodeUpc, upcCheckDigit, validateUpc } from "../src/upc";
import { qrPath, qrShapes } from "../src/qr";
import { recolorMaskForPdf, validateMask } from "../src/maskimage";
import { defaultConfig, parseConfigFile, toConfigFile } from "../src/defaults";
import { parseDescription } from "../src/description";
import { GOLD, parseHexFill } from "../src/layout";

describe("upc", () => {
  it("computes the Labradorite check digit", () => {
    expect(upcCheckDigit("85005136622")).toBe(4);
  });
  it("validates the reference UPC and rejects bad ones", () => {
    expect(validateUpc("850051366224").ok).toBe(true);
    expect(validateUpc("850051366225").ok).toBe(false);
    expect(validateUpc("12345").ok).toBe(false);
  });
  it("encodes 95 modules with correct guards", () => {
    const { modules, guards } = encodeUpc("850051366224");
    expect(modules).toHaveLength(95);
    expect(modules.startsWith("101")).toBe(true);
    expect(modules.endsWith("101")).toBe(true);
    expect(modules.slice(45, 50)).toBe("01010");
    expect(guards).toEqual([[0, 3], [45, 50], [92, 95]]);
  });
  it("encodes digit 0 as 0001101 in the left half", () => {
    expect(encodeUpc("000000000000").modules.slice(3, 10)).toBe("0001101");
  });
});

describe("qr", () => {
  it("produces three finders and a plausible dot count", () => {
    const s = qrShapes("https://lolev.beer");
    expect(s.finders).toHaveLength(3);
    expect(s.dots.length).toBeGreaterThan(50);
    for (const d of s.dots) {
      expect(d.cx).toBeGreaterThan(0);
      expect(d.cx).toBeLessThan(1);
    }
  });
  it("emits only absolute circle path commands", () => {
    const p = qrPath(qrShapes("test"), 60);
    expect(p).toMatch(/^M /);
    expect(new Set(p.match(/[A-Za-z]/g))).toEqual(new Set(["M", "a", "Z"]));
  });
});

describe("mask", () => {
  const px = (r: number, g: number, b: number) => [r, g, b, 255];
  it("accepts a pure white/blue mask and recolors it", () => {
    const rgba = new Uint8Array([...px(255, 255, 255), ...px(0, 156, 215)]);
    expect(validateMask(rgba).ok).toBe(true);
    recolorMaskForPdf(rgba);
    expect(rgba[3]).toBe(0); // metallic white -> transparent (knockout)
    expect([...rgba.slice(4)]).toEqual([0, 156, 215, 255]); // blue stays
  });
  it("rejects off-palette masks", () => {
    const rgba = new Uint8Array([...px(255, 0, 0), ...px(0, 255, 0)]);
    const v = validateMask(rgba);
    expect(v.ok).toBe(false);
    expect(v.offPalette).toBe(1);
  });
});

describe("description markdown", () => {
  it("parses header, bold, white-ink, and combined styles", () => {
    const d = parseDescription(
      "# HOPS\nFreestyle Motueka\n**_Roy Farms_**\n_Silvery_\n**Bold Gold**\n\n",
    );
    expect(d.header).toMatchObject({ text: "HOPS", bold: true, fill: "#D0B070", layer: "metallic" });
    expect(d.lines).toEqual([
      { text: "Freestyle Motueka", bold: false, fill: "#D0B070", layer: "metallic" },
      { text: "Roy Farms", bold: true, fill: "none", layer: "white" },
      { text: "Silvery", bold: false, fill: "none", layer: "white" },
      { text: "Bold Gold", bold: true, fill: "#D0B070", layer: "metallic" },
    ]);
  });
  it("handles a headerless block", () => {
    const d = parseDescription("just a line");
    expect(d.header).toBeNull();
    expect(d.lines).toHaveLength(1);
  });
});

describe("hex fills", () => {
  it("parses hex fills to rgb 0-1", () => {
    expect(parseHexFill("#D0B070")).toEqual({ r: 208 / 255, g: 176 / 255, b: 112 / 255 });
    expect(parseHexFill("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHexFill("none")).toEqual({ r: 1, g: 1, b: 1 }); // no ink = white in art
  });

  it("migrates legacy named fills in config files", () => {
    const legacy = toConfigFile(defaultConfig());
    (legacy.nameStyle as unknown as Record<string, unknown>).fill = "gold";
    (legacy.warning as unknown as Record<string, unknown>).fill = "black";
    (legacy.styleLine as unknown as Record<string, unknown>).fill = "white";
    const cfg = parseConfigFile(JSON.stringify(legacy));
    expect(cfg.nameStyle.fill).toBe(GOLD);
    expect(cfg.warning.fill).toBe("#000000");
    expect(cfg.styleLine.fill).toBe("none");
  });
});

describe("config", () => {
  it("migrates legacy per-line description configs", () => {
    const legacy = {
      ...toConfigFile(defaultConfig()),
      description: undefined,
      descriptionHeader: { text: "HOPS", fill: "gold", layer: "metallic", bold: true },
      descriptionLines: [
        { text: "Plain", fill: "gold", layer: "metallic" },
        { text: "Roy", fill: "white", layer: "white", bold: true },
      ],
    };
    const cfg = parseConfigFile(JSON.stringify(legacy));
    expect(cfg.description).toBe("# HOPS\nPlain\n**_Roy_**");
    expect(cfg).not.toHaveProperty("descriptionLines");
  });
  it("round-trips through JSON", () => {
    const cfg = defaultConfig();
    cfg.beerName = "TEST";
    const parsed = parseConfigFile(JSON.stringify(toConfigFile(cfg)));
    expect(parsed).toEqual(cfg);
  });
  it("rejects unknown versions and missing fields", () => {
    expect(() => parseConfigFile('{"version":2}')).toThrow(/version/);
    expect(() => parseConfigFile('{"version":1,"beerName":"X"}')).toThrow(/missing/);
  });
});
