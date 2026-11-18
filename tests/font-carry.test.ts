// font-carry.test.ts — imported fonts travel with the document (font import
// task 9): an opened file's font is registered only when its bytes hash to
// the id it is stored under (one file must not swap glyphs into another tab's
// font), the ids a .master and a .label must carry are the ones their layers
// name, and an in-session edit may set a master layer to a font the tab
// carries. The App-level open, save and recovery flows are in
// font-carry-dom.test.tsx.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importedFontId, readImportedFont } from "../src/fontImport";
import { importedFontBundle, importedFamilies, registerImportedFont, registerImportedFonts } from "../src/fonts";
import type { FontAsset } from "../src/labelfile";
import { learnChoice } from "../src/model/editLabel";
import { masterFontIds, patchLayer, referencedFontIds } from "../src/model/editLayers";
import { applyPromotions, masterChanges } from "../src/model/editSave";
import type { LabelFile, Master, TextLayer } from "../src/model/layers";
import { lolevMaster } from "./fixtures/lolevMaster";

const fixture = (file: string): FontAsset =>
  ({ name: file, bytes: new Uint8Array(readFileSync(`tests/fixtures/fonts/${file}`)) });
const svn = () => readImportedFont([fixture("SVN-Poppins-Bold.ttf")]);
const label = (overrides?: LabelFile["overrides"]): LabelFile =>
  ({ formatVersion: 3, masterId: "lolev", enabledVariants: [], values: {}, ...overrides ? { overrides } : {} });

describe("importedFontId", () => {
  it("is the id readImportedFont minted for the same faces", async () => {
    const { id, font } = await svn();
    expect(await importedFontId(font)).toBe(id);
  });
});

describe("registerImportedFont", () => {
  it("refuses a font whose bytes do not hash to its id", async () => {
    const { font } = await svn();
    await expect(registerImportedFont("imported:0123456789ab", font)).rejects.toThrow(`This file's font ${font.family} is damaged.`);
    expect(importedFamilies().has("imported:0123456789ab")).toBe(false);
  });

  // A crafted file naming a REGISTERED id with other bytes is refused too:
  // registration is idempotent per id, so it must not pass as "already there".
  it("refuses other bytes under an id already registered", async () => {
    const { id, font } = await svn();
    await registerImportedFont(id, font);
    const regular = await readImportedFont([fixture("SVN-Poppins-Regular.ttf")]);
    await expect(registerImportedFonts({ [id]: regular.font })).rejects.toThrow("is damaged");
  });

  it("registers a font whose bytes match, and bundles it back for a save", async () => {
    const { id, font } = await svn();
    await registerImportedFonts({ [id]: font });
    expect(importedFamilies().get(id)?.label).toBe(font.family);
    expect(importedFontBundle([id])).toEqual({ [id]: font });
    expect(importedFontBundle([])).toBeUndefined();
  });
});

describe("the fonts a file must carry", () => {
  it("are the imported ids the master's default, layers and variants name", () => {
    const m = lolevMaster();
    const withFonts: Master = {
      ...m, fontFamily: "imported:aaaaaaaaaaaa",
      layers: m.layers.map((l) => l.id === "name" ? { ...l, fontFamily: "imported:bbbbbbbbbbbb" } as TextLayer : l),
      variants: [...m.variants, { id: "x", name: "X", layers: { name: { fontFamily: "imported:cccccccccccc" } } }],
    };
    expect(masterFontIds(withFonts)).toEqual(new Set(["imported:aaaaaaaaaaaa", "imported:bbbbbbbbbbbb", "imported:cccccccccccc"]));
    expect(masterFontIds(m)).toEqual(new Set());
  });

  it("for a label, add the ids its overrides name", () => {
    const ids = referencedFontIds(lolevMaster(), label({ name: { fontFamily: "imported:dddddddddddd" }, style: { fontFamily: "barlow-condensed" } }));
    expect(ids).toEqual(new Set(["imported:dddddddddddd"]));
  });
});

describe("editing a master with imported fonts", () => {
  it("sets a master layer to an imported font the tab carries", async () => {
    const { id } = await svn();
    const m = patchLayer(lolevMaster(), "name", { fontFamily: id }, new Set([id]));
    expect((m.layers.find((l) => l.id === "name") as TextLayer).fontFamily).toBe(id);
    expect(() => patchLayer(lolevMaster(), "name", { fontFamily: id })).toThrow(`unknown font family "${id}"`);
  });

  it("promotes a label's imported font onto the master", async () => {
    const { id } = await svn();
    const master = lolevMaster();
    const l = label({ name: { fontFamily: id } });
    const promote = masterChanges(master, master, l).filter((c) => c.kind === "promote");
    expect(promote.length).toBeGreaterThan(0);
    const out = applyPromotions(master, l, promote, undefined, new Set([id]));
    expect((out.master.layers.find((x) => x.id === "name") as TextLayer).fontFamily).toBe(id);
  });

  // A master that already names an imported font keeps validating through an
  // edit that does not touch it (the editor passes no font set there).
  it("keeps a font the master already names through another edit", async () => {
    const { id } = await svn();
    const m = lolevMaster();
    const named = { ...m, layers: m.layers.map((l) => l.id === "name" ? { ...l, fontFamily: id } as TextLayer : l) };
    const choiceLayer = named.layers.find((l) => l.kind === "text" && l.choices)!;
    expect(() => learnChoice(named, choiceLayer.id, "Hazy")).not.toThrow();
    expect(() => patchLayer(named, "name", { placeholder: "Beer" })).not.toThrow();
  });
});
