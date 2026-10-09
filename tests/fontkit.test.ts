// fontkit.test.ts — the typed fontkit wrapper (#436): openFont hands back a
// font whose shaped glyphs expose the recorded outline commands that
// psd/build's digitGroupPaths walks, with no cast at the call site.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
});
