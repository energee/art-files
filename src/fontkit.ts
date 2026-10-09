// fontkit.ts — the one place a label font's bytes become a fontkit Font for
// glyph-level work (PSD barcode digit outlines, inspector glyph heights).
// Node-safe on purpose (no ?url imports), unlike the DOM gate in fonts.ts,
// because the headless harness builds PSDs too. pdf-lib's own embedding
// registers fontkit separately (pdf/build.ts) and never comes through here.
import fontkit, { type Font, type Glyph, type GlyphRun, type Path } from "@pdf-lib/fontkit";

/** One glyph-outline command as fontkit's Path records it at runtime. */
type GlyphCmd = { command: string; args: number[] };

/** A glyph whose path exposes its recorded `commands`. @pdf-lib/fontkit's
 *  `.d.ts` types `Glyph.path` as the builder-method-only `Path` interface and
 *  omits the `commands` array those methods record to; this type adds what
 *  the runtime has always carried. */
type OutlineGlyph = Glyph & { path: Path & { commands: GlyphCmd[] } };

/** A fontkit Font whose shaped runs carry OutlineGlyphs. */
export interface OutlineFont extends Font {
  layout(text: string, features?: Parameters<Font["layout"]>[1]): GlyphRun & { glyphs: OutlineGlyph[] };
}

/** Parse font bytes. The cast bridges the declaration gap described on
 *  OutlineGlyph, not a runtime difference. */
export const openFont = (bytes: Uint8Array): OutlineFont => fontkit.create(bytes) as OutlineFont;
