import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFName } from "pdf-lib";
import { readPsd } from "ag-psd";
import { FONT_FAMILIES, type FontFamilyId } from "../src/fontCatalog";
import { planText } from "../src/planLayers";
import type { Face, MeasureFace } from "../src/plan";
import { createHeightMeasure } from "../src/textheight";
import { buildArtPdf, buildMaskPdf } from "../src/pdf/build";
import { buildPsd } from "../src/psd/build";
import { lolevMaster } from "../src/model/lolevLayers";
import { parseMaster, type TextLayer } from "../src/model/layers";
import { parseLabel, serializeLabel, serializeMaster } from "../src/model/files";
import { setLabelOverride } from "../src/model/edit";
import { resolveLayers } from "../src/model/resolveLayers";

const bytes = (family: FontFamilyId): Record<Face, Uint8Array> => {
  const read = (face: Face) => readFileSync(new URL(`../src/assets/fonts/${FONT_FAMILIES[family].files[face]}`, import.meta.url));
  return { regular: read("regular"), semibold: read("semibold"), bold: read("bold") };
};
const poppins = bytes("poppins"), condensed = bytes("barlow-condensed");
const parsed = Object.fromEntries(Object.entries({ poppins, "barlow-condensed": condensed }).map(([id, faces]) =>
  [id, Object.fromEntries(Object.entries(faces).map(([face, data]) => [face, fontkit.create(data)]))]));
const measure: MeasureFace = (text, size, face, family = "poppins") => {
  const f = parsed[family][face];
  return f.layout(text).glyphs.reduce((sum: number, g: { advanceWidth: number }) => sum + g.advanceWidth, 0) * size / f.unitsPerEm;
};
const style = { fill: "#000000", layer: "white" } as const;
const text: TextLayer = { id: "warning", name: "Warning", kind: "text", enabled: true,
  x: 20, y: 20, anchor: "left", align: "left", size: 10, style,
  lines: [{ text: "**GOVERNMENT WARNING** small text", ...style }] };
const narrow: TextLayer = { ...text, fontFamily: "barlow-condensed" };

it("uses the selected family's actual metrics and carries it through normal, rotated and justified runs", () => {
  for (const rotation of [0, 90] as const) for (const align of ["left", "justify"] as const) {
    const runs = planText({ ...narrow, rotation, align, width: 120 }, measure);
    expect(runs.length).toBeGreaterThan(1);
    expect(runs.every((r) => r.fontFamily === "barlow-condensed")).toBe(true);
    for (const r of runs) expect(r.w).toBeCloseTo(measure(r.text, r.size, r.face, "barlow-condensed"));
  }
  const width = (l: TextLayer) => planText(l, measure).reduce((sum, r) => sum + r.w, 0);
  expect(width(narrow)).toBeLessThan(width(text));
  expect(planText(text, measure).every((r) => !("fontFamily" in r))).toBe(true);
  expect(createHeightMeasure(condensed)(narrow)).not.toEqual(createHeightMeasure(poppins)(text));
  for (const [family, faces] of Object.entries(parsed)) for (const [face, font] of Object.entries(faces)) {
    expect((font as { postscriptName: string }).postscriptName).toBe(FONT_FAMILIES[family as FontFamilyId].ps[face as Face]);
  }
});

it("embeds both families on both PDF plates and keeps PSD type names per layer", async () => {
  const plan = [...planText(text, measure), ...planText({ ...narrow, id: "condensed" }, measure)];
  const assets = { fonts: poppins, fontFamilies: { "barlow-condensed": condensed } };
  for (const build of [buildArtPdf, buildMaskPdf]) {
    const doc = await PDFDocument.load(await build(plan, assets));
    const names = doc.context.enumerateIndirectObjects().flatMap(([, obj]) => {
      const dict = (obj as { dict?: { get: (n: PDFName) => unknown } }).dict;
      return String(dict?.get(PDFName.of("BaseFont")) ?? "");
    }).join(" ");
    expect(names).toContain("Poppins-Regular");
    expect(names).toContain("BarlowCondensed-Regular");
    expect(names).toContain("BarlowCondensed-SemiBold");
    await expect(build(plan, { fonts: poppins })).rejects.toThrow("Missing PDF font family");
  }
  const psd = readPsd(await buildPsd(plan, { fonts: poppins }), {
    skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true,
  });
  const names = psd.children!.map((g) => g.children![0].text!.styleRuns!.map((r) => r.style!.font!.name));
  expect(names[0]).toEqual(["Poppins-SemiBold", "Poppins-Regular"]);
  expect(names[1]).toEqual(["BarlowCondensed-SemiBold", "BarlowCondensed-Regular"]);
});

it("round-trips the override and inherited default through label/master files and rejects unknown families", () => {
  const master = { ...lolevMaster(), layers: [narrow], variants: [] };
  expect(parseMaster(JSON.parse(serializeMaster(master))).layers).toEqual([narrow]);
  let label = setLabelOverride({ formatVersion: 3, masterId: master.id, enabledVariants: [], values: {} }, text.id, { fontFamily: "poppins" });
  const restored = parseLabel(JSON.parse(serializeLabel(label)));
  if (!("formatVersion" in restored)) throw new Error("Expected v3 label");
  expect((resolveLayers(master, [], {}, restored.overrides).layers[0] as TextLayer).fontFamily).toBe("poppins");
  label = setLabelOverride(label, text.id, { fontFamily: undefined });
  const inherited = parseLabel(JSON.parse(serializeLabel(label)));
  if (!("formatVersion" in inherited)) throw new Error("Expected v3 label");
  expect((resolveLayers(master, [], {}, inherited.overrides).layers[0] as TextLayer).fontFamily).toBeUndefined();
  expect(() => parseMaster({ ...master, layers: [{ ...narrow, fontFamily: "missing" }] })).toThrow(/font family/);
  expect(() => parseLabel({ ...label, overrides: { warning: { fontFamily: "missing" } } })).toThrow(/font family/);
});
