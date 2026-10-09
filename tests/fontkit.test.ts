// fontkit.test.ts — the typed fontkit wrapper (#436): openFont hands back a
// font whose glyphs expose the recorded outline commands that psd/build's
// digitGroupPaths walks, with no cast at the call site. The expectTypeOf
// lines are checked by `tsc --noEmit` (tests are in tsconfig's include).
import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { openFont } from "../src/fontkit";

describe("openFont (#436)", () => {
  const font = openFont(readFileSync(new URL("../src/assets/fonts/Poppins-Regular.ttf", import.meta.url)));

  it("exposes each glyph's recorded outline commands", () => {
    const [glyph] = font.layout("4").glyphs;
    expect(font.unitsPerEm).toBeGreaterThan(0);
    expect(glyph.advanceWidth).toBeGreaterThan(0);
    expect(glyph.path.commands[0]).toEqual({ command: "moveTo", args: [expect.any(Number), expect.any(Number)] });
    expect(glyph.path.commands.at(-1)?.command).toBe("closePath");
  });

  it("types every glyph's path commands, not only shaped runs", () => {
    type Command = "moveTo" | "lineTo" | "quadraticCurveTo" | "bezierCurveTo" | "closePath";
    const glyph = font.getGlyph(font.layout("4").glyphs[0].id);
    expectTypeOf(glyph.path.commands[0].command).toEqualTypeOf<Command>();
    expectTypeOf(glyph.path.commands[0].args).toEqualTypeOf<number[]>();
    expect(glyph.path.commands.length).toBeGreaterThan(0);
  });
});
