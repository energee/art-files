// generate.test.ts — headless CLI: argv, value coercion, inspect, and
// master+values builds. Pure against src/generate.ts; no process spawn.
import { describe, expect, it } from "vitest";
import { parseGenerateArgs, coerceValues, parseJobs, inspectMaster, assertVariants } from "../src/generate";
import { lolevMaster } from "../src/model/lolevLayers";

describe("parseGenerateArgs", () => {
  it("new form: positional master + values + out", () => {
    expect(parseGenerateArgs(["beer.master", "v.json", "out"])).toEqual({
      mode: "generate", masterPath: "beer.master", valuesPath: "v.json",
      outDir: "out", variants: [], assets: {}, set: {}, format: { pdf: true, psd: true },
    });
  });

  it("new form: flags, stdin values, one variant, one asset, pdf only", () => {
    expect(parseGenerateArgs([
      "--master", "beer.master", "--values", "-", "--out", "out",
      "--variant", "collab", "--asset", "collabLeft=./a.svg", "--format", "pdf",
    ])).toMatchObject({
      mode: "generate", valuesPath: "-", variants: ["collab"],
      assets: { collabLeft: "./a.svg" }, format: { pdf: true, psd: false },
    });
  });

  it("inspect", () => {
    expect(parseGenerateArgs(["beer.master", "--inspect"])).toEqual({
      mode: "inspect", masterPath: "beer.master",
    });
  });

  it("legacy positional still parses", () => {
    expect(parseGenerateArgs(["none", "none", "out", "cfg.json", "--collab-left=a.svg"]))
      .toMatchObject({ mode: "legacy", texturePath: "none", maskPath: "none",
        outDir: "out", configPath: "cfg.json", collabLeft: "a.svg" });
  });

  it("unknown flag throws USAGE", () => {
    expect(() => parseGenerateArgs(["beer.master", "v.json", "out", "--bogus"]))
      .toThrow(/usage/i);
  });

  it("--label and --values together throw", () => {
    expect(() => parseGenerateArgs(["--master", "m.master", "--label", "a.label",
      "--values", "v.json", "--out", "out"])).toThrow(/--label/);
  });
});

describe("parseJobs", () => {
  it("plain values object is one job", () => {
    expect(parseJobs({ name: "X" })).toEqual([{ values: { name: "X" } }]);
  });
  it("array is a batch", () => {
    expect(parseJobs([{ values: { name: "A" } }, { name: "B" }]))
      .toEqual([{ values: { name: "A" } }, { values: { name: "B" } }]);
  });
});

describe("coerceValues", () => {
  const m = lolevMaster();
  it("plain name string becomes one styled line", () => {
    const r = coerceValues(m, { name: "Labradorite" }, []);
    expect(r.errors).toEqual({});
    expect(r.values.name).toEqual([
      expect.objectContaining({ text: "Labradorite" }),
    ]);
  });
  it("description markdown keeps header and white-ink lines", () => {
    const r = coerceValues(m, { description: "# HOPS\n_dry hopped_" }, []);
    expect(r.values.description).toEqual([
      expect.objectContaining({ text: "HOPS", header: true }),
      expect.objectContaining({ text: "dry hopped", layer: "white" }),
    ]);
  });
  it("abv number stringifies; barcode stays a string", () => {
    const r = coerceValues(m, { abv: 6.5, barcode: "850051366224" }, []);
    expect(r.values.abv).toEqual([expect.objectContaining({ text: "6.5" })]);
    expect(r.values.barcode).toBe("850051366224");
  });
  it("unknown layer id is an error, not dormant", () => {
    const r = coerceValues(m, { nam: "X" }, []);
    expect(r.errors.nam).toMatch(/unknown layer/i);
    expect(r.values).toEqual({});
  });
  it("collabLeft is unknown until the collab variant is enabled", () => {
    expect(coerceValues(m, { collabLeft: "a" }, []).errors.collabLeft).toMatch(/unknown/i);
    expect(coerceValues(m, { collabLeft: "a" }, ["collab"]).errors).toEqual({});
  });
});

describe("inspectMaster", () => {
  it("lists Lolev fill layers and the collab additions", () => {
    const r = inspectMaster(lolevMaster());
    expect(r.id).toBe("lolev");
    expect(r.layers.map((l) => l.id)).toContain("name");
    expect(r.layers.find((l) => l.id === "abv")?.input).toBe("number");
    expect(r.layers.find((l) => l.id === "collabLeft")).toMatchObject({
      kind: "image", variant: "collab",
    });
  });

  it("assertVariants throws on typos", () => {
    expect(() => assertVariants(lolevMaster(), ["collab", "nope"]))
      .toThrow(/nope/);
  });
});
