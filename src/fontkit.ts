// fontkit.ts — the one place a label font's bytes become a fontkit Font for
// glyph-level work (PSD barcode digit outlines, inspector glyph heights).
// Node-safe on purpose (no ?url imports), unlike the DOM gate in fonts.ts,
// because the headless harness builds PSDs too. pdf-lib's own embedding
// registers fontkit separately (pdf/build.ts) and never comes through here.
import fontkit, { type Font } from "@pdf-lib/fontkit";

// @pdf-lib/fontkit's `.d.ts` types `Glyph.path` as the builder-method-only
// `Path` interface and omits the `commands` array those methods record to.
// Declaring it here types every glyph's path (layout runs, getGlyph, ...)
// with no cast; the runtime has always carried it.
declare module "@pdf-lib/fontkit" {
  interface Path {
    /** The outline as recorded, one entry per builder call. */
    commands: {
      command: "moveTo" | "lineTo" | "quadraticCurveTo" | "bezierCurveTo" | "closePath";
      args: number[];
    }[];
  }
}

/** Parse font bytes into a fontkit Font. */
export const openFont = (bytes: Uint8Array): Font => fontkit.create(bytes);
