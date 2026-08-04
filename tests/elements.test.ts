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
});
