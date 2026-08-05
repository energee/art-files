import { describe, expect, it } from "vitest";
import { ELEMENTS, applyStyle, elementById, isDefaultStyle } from "../src/elements";
import { defaultConfig } from "../src/defaults";
import { GOLD } from "../src/layout";

describe("element registry", () => {
  it("covers every stylable element exactly once", () => {
    const ids = ELEMENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("name");
    expect(ids).toContain("storeCold");
    expect(ids).toContain("qr");
    expect(ids).toContain("barcode");
  });

  it("splits per-beer fields from set-once template fields", () => {
    const g = (id: string) => ELEMENTS.find((e) => e.id === id)!.group;
    expect(g("name")).toBe("beer");
    expect(g("styleLine")).toBe("beer");
    // Both codes change per release (QR payload follows the name, UPC digits
    // are per-beer), so neither belongs behind the brand-template disclosure.
    expect(g("qr")).toBe("beer");
    expect(g("barcode")).toBe("beer");
    expect(g("wordmark")).toBe("template");
    expect(g("storeCold")).toBe("template");
  });

  it("reads each element's live style out of the config", () => {
    const cfg = defaultConfig();
    cfg.nameStyle.fill = "#123456";
    expect(elementById("name").style(cfg).fill).toBe("#123456");
    cfg.qrFill = "#654321";
    cfg.qrLayer = "white";
    expect(elementById("qr").style(cfg).fill).toBe("#654321");
    expect(elementById("qr").style(cfg).layer).toBe("white");
    cfg.barcodeFill = "#222222";
    cfg.barcodeStroke = "#EEEEEE";
    cfg.barcodeStrokeWidth = 22;
    const bc = elementById("barcode").style(cfg);
    expect(bc).toEqual({
      fill: "#222222", layer: "white", stroke: "#EEEEEE", strokeWidth: 22,
    });
  });

  it("writes back through applyStyle, including the flat QR fields", () => {
    const cfg = defaultConfig();
    applyStyle(cfg, "name", { fill: "#ABCDEF" });
    expect(cfg.nameStyle.fill).toBe("#ABCDEF");
    applyStyle(cfg, "qr", { fill: "#112233", layer: "white" });
    expect(cfg.qrFill).toBe("#112233");
    expect(cfg.qrLayer).toBe("white");
  });

  it("routes every barcode field to its own flat config key, never the QR's", () => {
    const cfg = defaultConfig();
    const qrBefore = { ...elementById("qr").style(cfg) };
    applyStyle(cfg, "barcode", {
      fill: "#445566", layer: "metallic", stroke: "#778899", strokeWidth: 31,
    });
    expect(cfg.barcodeFill).toBe("#445566");
    expect(cfg.barcodeLayer).toBe("metallic");
    expect(cfg.barcodeStroke).toBe("#778899");
    expect(cfg.barcodeStrokeWidth).toBe(31);
    // The two flat elements share one write path; this is the check that it
    // never crosses the wires between them.
    expect(elementById("qr").style(cfg)).toEqual(qrBefore);
  });

  it("recognises the gold/metallic default so deviations can be marked", () => {
    expect(isDefaultStyle({ fill: GOLD, layer: "metallic" })).toBe(true);
    expect(isDefaultStyle({ fill: "#FF0000", layer: "metallic" })).toBe(false);
    expect(isDefaultStyle({ fill: GOLD, layer: "white" })).toBe(false);
    expect(isDefaultStyle({ fill: GOLD, layer: "metallic", stroke: "#FFFFFF" })).toBe(false);
    expect(isDefaultStyle({ fill: GOLD, layer: "metallic", stroke: "none" })).toBe(true);
  });

  it("marks 'no ink' as illegal for both codes and nothing else", () => {
    for (const e of ELEMENTS) {
      expect(e.allowNone).toBe(e.id !== "qr" && e.id !== "barcode");
    }
  });

  it("clears a stale qrStrokeWidth when a patch explicitly carries strokeWidth: undefined (Reset path)", () => {
    const cfg = defaultConfig();
    applyStyle(cfg, "qr", { stroke: "#000000", strokeWidth: 40 });
    expect(cfg.qrStrokeWidth).toBe(40);
    // This is exactly the shape StyleProperties' reset() sends: every field
    // present, strokeWidth explicitly undefined because the shipped qr
    // default has no width. The "key absent" case (a plain `{ fill }`
    // patch from e.g. the Fill swatch) must NOT clear it — only a patch
    // that actually carries the key should.
    applyStyle(cfg, "qr", { fill: GOLD, layer: "metallic", stroke: "none", strokeWidth: undefined });
    expect(cfg.qrStrokeWidth).toBeUndefined();
    applyStyle(cfg, "qr", { fill: "#654321" });
    expect(cfg.qrStrokeWidth).toBeUndefined();
  });

  // The barcode's unset strokeWidth is not cosmetic: it is what keeps the
  // halo at L.BARCODE.stroke, the width measured off the finished labels
  // (drawBarcode). A Reset that failed to clear it would silently narrow the
  // white footprint on every future print.
  it("clears a stale barcodeStrokeWidth on an explicit strokeWidth: undefined, and keeps it otherwise", () => {
    const cfg = defaultConfig();
    expect(cfg.barcodeStrokeWidth).toBeUndefined();
    applyStyle(cfg, "barcode", { strokeWidth: 40 });
    expect(cfg.barcodeStrokeWidth).toBe(40);
    // Teeth: a patch with the key ABSENT must leave a real width alone. The
    // QR version of this test only checks that against an already-undefined
    // width, so it cannot fail — assert survival of a set value instead.
    applyStyle(cfg, "barcode", { fill: "#654321" });
    expect(cfg.barcodeStrokeWidth).toBe(40);
    // And the Reset shape — every field present, strokeWidth explicitly
    // undefined because the shipped barcode default has no width — clears it.
    applyStyle(cfg, "barcode", {
      fill: "#1A1A1A", layer: "white", stroke: "#FFFFFF", strokeWidth: undefined,
    });
    expect(cfg.barcodeStrokeWidth).toBeUndefined();
  });

  it("drops a bold patch for elements without hasBold, even though the type allows it", () => {
    const cfg = defaultConfig();
    applyStyle(cfg, "logo", { fill: "#111111", bold: true });
    expect(cfg.logo.fill).toBe("#111111");
    expect("bold" in cfg.logo).toBe(false);
    // The barcode's digits are drawn in one fixed face, so a stray bold must
    // not survive onto its flat config either.
    applyStyle(cfg, "barcode", { fill: "#222222", bold: true });
    expect(cfg.barcodeFill).toBe("#222222");
    expect("barcodeBold" in cfg).toBe(false);
    expect("bold" in cfg).toBe(false);
  });

  it("still writes bold for elements that have it", () => {
    const cfg = defaultConfig();
    expect(cfg.storeCold.bold).toBe(true);
    applyStyle(cfg, "storeCold", { bold: false });
    expect(cfg.storeCold.bold).toBe(false);
  });
});
