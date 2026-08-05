// core.test.ts — pure-logic coverage: UPC-A encode/validate, QR geometry,
// mask polarity rules, and config JSON round-trip.
import { describe, expect, it } from "vitest";
import { encodeUpc, upcCheckDigit, validateUpc } from "../src/upc";
import { qrPath, qrShapes, machineName, qrUrl } from "../src/qr";
import { recolorMaskForPdf, validateMask } from "../src/maskimage";
import { defaultConfig, parseConfigFile, toConfigFile } from "../src/defaults";
import { parseDescription, serializeDescription } from "../src/description";
import {
  COLLAB_LEAD, COLLAB_LEFT, DEFAULT_STROKE_PX, DESC, GOLD, QR,
  collabLeftFlow, parseHexFill,
} from "../src/layout";

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
    // Tall runs: start guard + number-system digit, center guard, check
    // digit + end guard (those two digits print outside the symbol).
    expect(guards).toEqual([[0, 10], [45, 50], [85, 95]]);
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
    expect(d.header).toMatchObject({ text: "HOPS", bold: true, fill: GOLD, layer: "metallic" });
    expect(d.lines).toEqual([
      { text: "Freestyle Motueka", bold: false, fill: GOLD, layer: "metallic" },
      { text: "Roy Farms", bold: true, fill: "none", layer: "white" },
      { text: "Silvery", bold: false, fill: "none", layer: "white" },
      { text: "Bold Gold", bold: true, fill: GOLD, layer: "metallic" },
    ]);
  });
  it("handles a headerless block", () => {
    const d = parseDescription("just a line");
    expect(d.header).toBeNull();
    expect(d.lines).toHaveLength(1);
  });
  it("applies the base style, stroke included, with white overriding fill/layer", () => {
    const base = { fill: "#123456", layer: "metallic", stroke: "#FFFFFF", strokeWidth: 20 } as const;
    const d = parseDescription("# H\nplain\n_white_", base);
    expect(d.header).toMatchObject({ fill: "#123456", stroke: "#FFFFFF", strokeWidth: 20 });
    expect(d.lines[0]).toMatchObject({ fill: "#123456", layer: "metallic", stroke: "#FFFFFF" });
    expect(d.lines[1]).toMatchObject({ fill: "none", layer: "white", stroke: "#FFFFFF" });
  });

  it("round-trips through serialize", () => {
    const src = "# HOPS\nFreestyle Motueka\n**_Roy Farms_**\n_Silvery_\n**Bold Gold**";
    expect(serializeDescription(parseDescription(src))).toBe(src);
  });

  it("serializes an empty block to an empty string", () => {
    expect(serializeDescription({ header: null, lines: [] })).toBe("");
  });

  it("canonicalizes marker order: reverse input normalizes to white-inside/bold-outside", () => {
    const reversed = "_**Roy Farms**_"; // reverse order: white outside, bold inside
    const canonical = "**_Roy Farms_**"; // canonical order: bold outside, white inside
    expect(serializeDescription(parseDescription(reversed))).toBe(canonical);
  });

  it("drops blank lines: they are skipped during parsing and cannot be recovered", () => {
    const src = "A\n\nB";
    expect(serializeDescription(parseDescription(src))).toBe("A\nB");
  });

  it("a second # line does not overwrite the header: first # wins, second survives as a body line", () => {
    const d = parseDescription("# HOPS\n#Freestyle Motueka");
    expect(d.header).toMatchObject({ text: "HOPS" });
    expect(d.lines).toEqual([
      { text: "#Freestyle Motueka", bold: false, fill: GOLD, layer: "metallic" },
    ]);
  });

  it("round-trips a block with a second # line: the header survives, the literal # is preserved", () => {
    const src = "# HOPS\n#Freestyle Motueka";
    expect(serializeDescription(parseDescription(src))).toBe(src);
  });

  // Regression: a '#' body line used to be promoted to the header by the
  // next parse — it jumped to the top of the block and rendered at the
  // header baseline in both deliverables.
  it("does not promote a later # line in a header-less block", () => {
    const d = parseDescription("Citra, Mosaic\n#3 Citra");
    expect(d.header).toBeNull();
    expect(d.lines.map((l) => l.text)).toEqual(["Citra, Mosaic", "#3 Citra"]);
    expect(serializeDescription(d)).toBe("Citra, Mosaic\n#3 Citra");
  });

  // A leading '#' on the first line of the SOURCE still means "header" —
  // that is the format. What must round-trip is a block the editor hands
  // back with no header and a body line that happens to start with '#':
  // serializing it verbatim made the next parse promote that line to the
  // header, jumping it to the top of the block at the header baseline.
  it("round-trips a header-less block whose FIRST body line starts with #", () => {
    const body = (text: string) =>
      ({ text, bold: false, fill: GOLD, layer: "metallic" }) as const;
    const md = serializeDescription({ header: null, lines: [body("#3 Citra"), body("Mosaic")] });
    expect(md).toBe("\\#3 Citra\nMosaic");
    const again = parseDescription(md);
    expect(again.header).toBeNull();
    expect(again.lines.map((l) => l.text)).toEqual(["#3 Citra", "Mosaic"]);
    expect(serializeDescription(again)).toBe(md);
  });

  it("still parses and round-trips a real '# HOPS' header", () => {
    const src = "# HOPS\nFreestyle Motueka";
    const d = parseDescription(src);
    expect(d.header).toMatchObject({ text: "HOPS", bold: true });
    expect(serializeDescription(d)).toBe(src);
  });

  // Locks in deliberate behaviour (not a bug, see task-6-report.md Finding
  // 2): a line whose typed text happens to be symmetrically wrapped in
  // `**...**` or `_..._` is interpreted as that marker, same as the old
  // plain textarea always stored and the renderers always drew — the
  // WYSIWYG editor didn't create this, it just makes it visible instead of
  // a silent field/render divergence.
  it("interprets a body line wrapped in ** as bold, markers stripped — mirrors the renderer", () => {
    const d = parseDescription("**Galaxy**");
    expect(d.lines).toEqual([{ text: "Galaxy", bold: true, fill: GOLD, layer: "metallic" }]);
  });

  it("interprets a body line wrapped in _ as white ink, markers stripped — mirrors the renderer", () => {
    const d = parseDescription("_Galaxy_");
    expect(d.lines).toEqual([{ text: "Galaxy", bold: false, fill: "none", layer: "white" }]);
  });
});

describe("hex fills", () => {
  it("parses hex fills to rgb 0-1", () => {
    expect(parseHexFill("#D0B070")).toEqual({ r: 208 / 255, g: 176 / 255, b: 112 / 255 });
    expect(parseHexFill("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHexFill("none")).toEqual({ r: 1, g: 1, b: 1 }); // no ink = white in art
  });

  it("keeps the logo's classic keyline on pre-stroke configs", () => {
    const legacy = toConfigFile(defaultConfig()) as unknown as Record<string, unknown>;
    delete (legacy.logo as Record<string, unknown>).stroke;
    delete (legacy.logo as Record<string, unknown>).strokeWidth;
    const cfg = parseConfigFile(JSON.stringify(legacy));
    expect(cfg.logo.stroke).toBe("#1A1A1A");
    expect(cfg.logo.strokeWidth).toBe(DEFAULT_STROKE_PX);
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

describe("collab layout", () => {
  it("flows the left block below the description and keeps it on the label", () => {
    const six = collabLeftFlow(6);
    const three = collabLeftFlow(3);
    expect(six.leadBaselines).toHaveLength(COLLAB_LEAD.lines.length);
    expect(six.leadBaselines[1]).toBeGreaterThan(six.leadBaselines[0]);
    expect(six.logoTop).toBeGreaterThan(six.leadBaselines[1]);
    // Fewer description lines pull the whole block up by exactly the leading.
    expect(six.logoTop - three.logoTop).toBeCloseTo(3 * DESC.leading);
    // Even the tallest realistic block clears the QR code at the bottom left.
    expect(six.logoTop + COLLAB_LEFT.maxH).toBeLessThan(QR.yTop);
  });
  it("does not run off the top with an empty description", () => {
    expect(collabLeftFlow(0).leadBaselines[0]).toBe(collabLeftFlow(1).leadBaselines[0]);
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

describe("derived QR payload", () => {
  it("machine-names beer titles", () => {
    expect(machineName("Ultra Juice")).toBe("ultra-juice");
    expect(machineName("  Käse & Bier!  ")).toBe("k-se-bier");
    expect(machineName("LABRADORITE")).toBe("labradorite");
  });
  it("builds the beer URL", () => {
    expect(qrUrl("Ultra Juice")).toBe("https://lolev.beer/beer/ultra-juice");
  });
  it("defaults descStyle on pre-descStyle configs", () => {
    const legacy = toConfigFile(defaultConfig()) as unknown as Record<string, unknown>;
    delete legacy.descStyle;
    const cfg = parseConfigFile(JSON.stringify(legacy));
    expect(cfg.descStyle).toEqual({ fill: GOLD, layer: "metallic" });
  });
  it("config migration drops qrData and defaults qrFill/qrStroke", () => {
    const legacy = { ...toConfigFile(defaultConfig()), qrData: "https://old.example" } as Record<string, unknown>;
    delete legacy.qrFill;
    delete legacy.qrStroke;
    const cfg = parseConfigFile(JSON.stringify(legacy)) as unknown as Record<string, unknown>;
    expect("qrData" in cfg).toBe(false);
    expect(cfg.qrFill).toBe(GOLD);
    expect(cfg.qrStroke).toBe("none");
  });
});
