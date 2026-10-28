// pdf-outline.test.ts — glyph outlines for the combined White Ink PDF use the
// same unkerned, tracked placements as pdf-lib's live text.
import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PNG } from "pngjs";
import { PDFDocument, degrees, rgb, setCharacterSpacing } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { openFont } from "../src/fontkit";
import { glyphPaths, outlineText } from "../src/pdf/outline";
import type { PlacedText } from "../src/plan";
import { PAGE } from "../src/layout";

const bytes = readFileSync(new URL("../src/assets/fonts/Poppins-Bold.ttf", import.meta.url));
const font = openFont(bytes);
const item = (overrides: Partial<PlacedText> = {}): PlacedText => ({
  kind: "text", id: "outline", text: "LUPULA", x: 40, y: 80, w: 0, size: 24,
  face: "bold", tracking: 1.25, fill: "#000000", layer: "white", stroke: null, rotated: false,
  ...overrides,
});


it("uses raw advances and one tracking gap per glyph", async () => {
  const text = "LUPULA";
  const size = 24;
  const tracking = 1.25;
  const outlined = glyphPaths(font, text, size, false, 0, 0, tracking);
  const last = glyphPaths(font, text.at(-1)!, size, false, 0, 0);
  const rawBeforeLast = font.glyphsForString(text.slice(0, -1))
    .reduce((sum, glyph) => sum + glyph.advanceWidth * size / font.unitsPerEm, 0);
  expect(outlined.bbox.maxX - last.bbox.maxX).toBeCloseTo(rawBeforeLast + tracking * (text.length - 1), 5);

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const embedded = await doc.embedFont(bytes);
  expect(embedded.widthOfTextAtSize(text, size)).toBeCloseTo(
    font.glyphsForString(text).reduce((sum, glyph) => sum + glyph.advanceWidth * size / font.unitsPerEm, 0), 5,
  );
});

it.each([false, true])("matches live tracked text bounds and preserves counters (rotated=%s)", async (rotated) => {
  const dir = mkdtempSync(join(tmpdir(), "pdf-outlines-"));
  const run = item({ text: "BLUPULA", x: 100, y: 180, rotated });
  try {
    const rasters: PNG[] = [];
    for (const outlined of [false, true]) {
      const doc = await PDFDocument.create();
      doc.registerFontkit(fontkit);
      const page = doc.addPage([PAGE.w, PAGE.h]);
      if (outlined) {
        for (const d of outlineText(font, run))
          page.drawSvgPath(d, { x: 0, y: PAGE.h, color: rgb(0, 0, 0) });
      } else {
        const embedded = await doc.embedFont(bytes);
        page.pushOperators(setCharacterSpacing(run.tracking));
        page.drawText(run.text, { x: run.x, y: PAGE.h - run.y, size: run.size, font: embedded, rotate: degrees(rotated ? 90 : 0), color: rgb(0, 0, 0) });
      }
      const path = join(dir, outlined ? "outline" : "live");
      writeFileSync(path + ".pdf", await doc.save());
      // 1440 DPI: one raster pixel is .05pt. Crop around both orientations.
      const result = spawnSync("pdftoppm", ["-png", "-singlefile", "-r", "1440",
        "-x", "1600", "-y", "800", "-W", "3600", "-H", "3200", path + ".pdf", path]);
      if (result.error) throw result.error;
      expect(result.status, result.stderr.toString()).toBe(0);
      rasters.push(PNG.sync.read(readFileSync(path + ".png")));
    }
    const bounds = rasters.map((png) => {
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
        if (png.data[(y * png.width + x) * 4] >= 128) continue;
        box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
        box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
      }
      return box;
    });
    for (let i = 0; i < 4; i++) expect(Math.abs(bounds[0][i] - bounds[1][i]) / 20).toBeLessThanOrEqual(.05);
    // A solid-filled counter creates interior black pixels absent from live
    // text. Grid-fitted glyphs and vector curves can differ within two
    // pixels (.1pt at 1440 DPI); counters have much larger interiors.
    const [live, outline] = rasters;
    let interiorDifferences = 0;
    for (let y = 2; y < live.height - 2; y++) for (let x = 2; x < live.width - 2; x++) {
      const i = (y * live.width + x) * 4;
      if ((live.data[i] < 128) === (outline.data[i] < 128)) continue;
      let edge = false;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        if ((live.data[((y + dy) * live.width + x + dx) * 4] < 128) !== (live.data[i] < 128)) edge = true;
      if (!edge) interiorDifferences++;
    }
    expect(interiorDifferences).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30_000);
