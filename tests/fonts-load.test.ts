// fonts-load.test.ts — the preview registers only the font families a label
// uses (#411): the master's default plus any text layer's override. Other
// bundled families load when a layer first picks them. Imported families load
// from the bytes registered for them, never from a fetch.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usedFontFamilies } from "../src/fontCatalog";
import { readImportedFont } from "../src/fontImport";
import type { FontAsset } from "../src/labelfile";

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
    const sources: unknown[] = [];
    const fetched: string[] = [];
    vi.stubGlobal("FontFace", class {
      constructor(family: string, source: unknown) { loaded.push(family); sources.push(source); }
      load() { return Promise.resolve(this); }
    });
    vi.stubGlobal("fetch", async (url: string) => { fetched.push(url); return new Response(new Uint8Array([fetched.length])); });
    const ctx = { font: "", fontKerning: "auto", measureText: () => ({ width: 1 }) };
    vi.stubGlobal("document", { fonts: { add() {} }, createElement: () => ({ getContext: () => ctx }) });
    const fonts = await import("../src/fonts");
    return { loaded, sources, fetched, fonts };
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

  it("fetches each face file once, for the preview faces and the export bytes alike (#611)", async () => {
    const { sources, fetched, fonts } = await fresh();
    await fonts.loadLabelFaces("poppins");
    const bytes = await fonts.loadFonts("poppins");
    expect(fetched).toHaveLength(3);
    expect(sources).toEqual([bytes.regular, bytes.semibold, bytes.bold]);
  });

  describe("imported families", () => {
    const svnBold = (): FontAsset => {
      const url = new URL("./fixtures/fonts/SVN-Poppins-Bold.ttf", import.meta.url);
      return { name: "SVN-Poppins-Bold.ttf", bytes: new Uint8Array(readFileSync(url)) };
    };

    it("loads a registered font's own bytes without fetching", async () => {
      const { fetched, fonts } = await fresh();
      const { id, font } = await readImportedFont([svnBold()]);
      await fonts.registerImportedFont(id, font);
      const bytes = await fonts.loadFonts(id);
      expect(fetched).toHaveLength(0);
      expect(bytes).toEqual({ regular: font.faces.regular.bytes, semibold: font.faces.semibold.bytes, bold: font.faces.bold.bytes });
    });

    it("rejects an imported id that was never registered", async () => {
      const { fetched, fonts } = await fresh();
      await expect(fonts.loadFonts("imported:0123456789ab")).rejects.toThrow("An imported font this label uses is not loaded.");
      expect(fetched).toHaveLength(0);
    });

    it("names an imported family with a valid unquoted CSS identifier", async () => {
      const { fonts } = await fresh();
      const css = fonts.labelFontCss("imported:0123456789ab");
      expect(css).toBe("LabelFont-imported-0123456789ab");
      expect(css).not.toContain(":");
      expect(css).toMatch(/^[A-Za-z][\w-]*$/);
    });

    it("registers an imported layer family's faces under its CSS name", async () => {
      const { loaded, sources, fonts } = await fresh();
      const { id, font } = await readImportedFont([svnBold()]);
      await fonts.registerImportedFont(id, font);
      await fonts.loadLabelFaces("poppins", [id]);
      expect(new Set(loaded)).toEqual(new Set([fonts.labelFontCss("poppins"), fonts.labelFontCss(id)]));
      expect(sources).toContain(font.faces.bold.bytes);
    });

    it("lists a registered family's label once it is registered", async () => {
      const { fonts } = await fresh();
      const { id, font } = await readImportedFont([svnBold()]);
      expect(fonts.importedFamilies().has(id)).toBe(false);
      await fonts.registerImportedFont(id, font);
      expect(fonts.importedFamilies().get(id)?.label).toBe(font.family);
    });
  });
});
