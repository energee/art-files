// fonts-load.test.ts — the preview registers only the font families a label
// uses (#411): the master's default plus any text layer's override. Other
// bundled families load when a layer first picks them.
import { afterEach, describe, expect, it, vi } from "vitest";
import { usedFontFamilies } from "../src/fontCatalog";

describe("usedFontFamilies", () => {
  it("is the master family plus each layer override, deduplicated", () => {
    expect(usedFontFamilies("poppins", [{ kind: "image" }, { kind: "text", fontFamily: "poppins" }])).toEqual(["poppins"]);
    expect(usedFontFamilies("poppins", [{ kind: "text", fontFamily: "barlow-condensed" }, { kind: "text", fontFamily: "barlow-condensed" }]))
      .toEqual(["poppins", "barlow-condensed"]);
  });
});

describe("loadLabelFaces", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  async function fresh() {
    vi.resetModules();
    const loaded: string[] = [];
    vi.stubGlobal("FontFace", class {
      constructor(family: string) { loaded.push(family); }
      load() { return Promise.resolve(this); }
    });
    const ctx = { font: "", fontKerning: "auto", measureText: () => ({ width: 1 }) };
    vi.stubGlobal("document", { fonts: { add() {} }, createElement: () => ({ getContext: () => ctx }) });
    const fonts = await import("../src/fonts");
    return { loaded, fonts };
  }

  it("registers only the master family when no layer overrides it", async () => {
    const { loaded, fonts } = await fresh();
    await fonts.loadLabelFaces("poppins");
    expect(new Set(loaded)).toEqual(new Set([fonts.labelFontCss("poppins")]));
  });

  it("registers a layer's override family too", async () => {
    const { loaded, fonts } = await fresh();
    await fonts.loadLabelFaces("poppins", ["barlow-condensed"]);
    expect(new Set(loaded)).toEqual(new Set([fonts.labelFontCss("poppins"), fonts.labelFontCss("barlow-condensed")]));
  });
});
