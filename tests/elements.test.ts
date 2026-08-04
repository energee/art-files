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
  });

  it("splits per-beer fields from set-once template fields", () => {
    const g = (id: string) => ELEMENTS.find((e) => e.id === id)!.group;
    expect(g("name")).toBe("beer");
    expect(g("styleLine")).toBe("beer");
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
  });

  it("writes back through applyStyle, including the flat QR fields", () => {
    const cfg = defaultConfig();
    applyStyle(cfg, "name", { fill: "#ABCDEF" });
    expect(cfg.nameStyle.fill).toBe("#ABCDEF");
    applyStyle(cfg, "qr", { fill: "#112233", layer: "white" });
    expect(cfg.qrFill).toBe("#112233");
    expect(cfg.qrLayer).toBe("white");
  });

  it("recognises the gold/metallic default so deviations can be marked", () => {
    expect(isDefaultStyle({ fill: GOLD, layer: "metallic" })).toBe(true);
    expect(isDefaultStyle({ fill: "#FF0000", layer: "metallic" })).toBe(false);
    expect(isDefaultStyle({ fill: GOLD, layer: "white" })).toBe(false);
    expect(isDefaultStyle({ fill: GOLD, layer: "metallic", stroke: "#FFFFFF" })).toBe(false);
    expect(isDefaultStyle({ fill: GOLD, layer: "metallic", stroke: "none" })).toBe(true);
  });

  it("marks 'no ink' as illegal only for QR", () => {
    for (const e of ELEMENTS) {
      expect(e.allowNone).toBe(e.id !== "qr");
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

  it("drops a bold patch for elements without hasBold, even though the type allows it", () => {
    const cfg = defaultConfig();
    applyStyle(cfg, "logo", { fill: "#111111", bold: true });
    expect(cfg.logo.fill).toBe("#111111");
    expect("bold" in cfg.logo).toBe(false);
  });

  it("still writes bold for elements that have it", () => {
    const cfg = defaultConfig();
    expect(cfg.storeCold.bold).toBe(true);
    applyStyle(cfg, "storeCold", { bold: false });
    expect(cfg.storeCold.bold).toBe(false);
  });
});
