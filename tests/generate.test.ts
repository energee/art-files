// generate.test.ts — headless CLI: argv, value coercion, inspect, and
// master+values builds. Pure against scripts/generate-lib.ts; no process spawn.
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  parseGenerateArgs, coerceValues, parseJobs, inspectMaster, assertVariants, buildLabel,
  runGenerate,
} from "../scripts/generate-lib";
import { PNG } from "pngjs";
import { defaultConfig } from "../src/defaults";
import { packLabel, packMaster } from "../src/model/files";
import { lolevMaster } from "../src/model/lolevLayers";

/** A tiny solid-white PNG, enough to embed and tint. */
const whitePng = (): Uint8Array => {
  const png = new PNG({ width: 2, height: 2 });
  png.data.fill(255);
  return new Uint8Array(PNG.sync.write(png));
};
const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

describe("parseGenerateArgs", () => {
  it("new form: positional master + values + out", () => {
    expect(parseGenerateArgs(["beer.master", "v.json", "out"])).toEqual({
      mode: "generate", masterPath: "beer.master", source: { kind: "values", path: "v.json" },
      outDir: "out", variants: [], assets: {}, set: {}, format: "all",
    });
  });

  it("new form: flags, stdin values, one variant, one asset, pdf only", () => {
    expect(parseGenerateArgs([
      "--master", "beer.master", "--values", "-", "--out", "out",
      "--variant", "collab", "--asset", "collabLeft=./a.svg", "--format", "pdf",
    ])).toMatchObject({
      mode: "generate", source: { kind: "values", path: "-" }, variants: ["collab"],
      assets: { collabLeft: "./a.svg" }, format: "pdf",
    });
  });

  it("inspect", () => {
    expect(parseGenerateArgs(["beer.master", "--inspect"])).toEqual({
      mode: "inspect", masterPath: "beer.master",
    });
  });

  it("shipped master: --out alone is generate mode", () => {
    expect(parseGenerateArgs(["--out", "out"])).toMatchObject({
      mode: "generate", outDir: "out",
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

  it("equals-form stdin and empty flags", () => {
    expect(parseGenerateArgs(["--values=-", "--out", "out"])).toMatchObject({
      mode: "generate", source: { kind: "values", path: "-" },
    });
    expect(() => parseGenerateArgs(["--out="])).toThrow(/needs a value/i);
  });

  it("new-form --collab-left is rejected", () => {
    expect(() => parseGenerateArgs(["--out", "out", "--collab-left=a.svg"]))
      .toThrow(/--asset collabLeft/i);
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
  it("empty array is an error", () => {
    expect(() => parseJobs([])).toThrow(/no jobs/i);
  });
  it("variants must be strings", () => {
    expect(() => parseJobs({ values: { name: "A" }, variants: "collab" }))
      .toThrow(/variants/i);
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
  it("a text-line array without fill/layer is an error", () => {
    const r = coerceValues(m, { name: [{ text: "Hello" }] }, []);
    expect(r.errors.name).toMatch(/text/i);
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

const assetRoot = join(import.meta.dirname, "..", "src", "assets");
const labradorite = () => coerceValues(
  lolevMaster(), { name: "Labradorite", barcode: "850051366224" }, [],
).values;

describe("buildLabel", () => {
  it("writes an art PDF whose stream contains the filled name", async () => {
    const result = await buildLabel({
      master: lolevMaster(),
      masterAssets: {},
      values: labradorite(),
      enabledVariants: [],
      extraImages: {},
      format: "pdf",
      assetRoot,
    });
    expect(result.basename).toBe("labradorite");
    const art = result.files.find((f) => f.name === "labradorite.pdf");
    expect(art).toBeTruthy();
    expect((await PDFDocument.load(art!.bytes)).getTitle()).toBe("Labradorite label art");
  });

  it("invalid UPC fails loudly", async () => {
    await expect(buildLabel({
      master: lolevMaster(),
      masterAssets: {},
      values: coerceValues(lolevMaster(), { name: "X", barcode: "123" }, []).values,
      enabledVariants: [],
      extraImages: {},
      format: "pdf",
      assetRoot,
    })).rejects.toThrow(/barcode/i);
  });
});

function memIo() {
  const files = new Map<string, Uint8Array>();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const text = (p: string) => {
    const b = files.get(p);
    if (!b) throw new Error(`ENOENT ${p}`);
    return new TextDecoder().decode(b);
  };
  return {
    files, stdout, stderr,
    run: (argv: string[], stdin?: string) => runGenerate({
      argv, cwd: "/", readStdin: () => stdin ?? "",
      readFile: (p) => {
        const b = files.get(p);
        if (!b) throw new Error(`ENOENT ${p}`);
        return b;
      },
      readFileText: text,
      writeFile: (p, b) => { files.set(p, b); },
      mkdir: () => {},
      stdout: (s) => stdout.push(s),
      stderr: (s) => stderr.push(s),
      assetRoot,
    }),
  };
}

describe("runGenerate", () => {
  it("inspect prints layer ids as JSON", async () => {
    const io = memIo();
    expect(await io.run(["--inspect"])).toBe(0);
    expect(JSON.parse(io.stdout.join(""))).toMatchObject({ id: "lolev" });
    expect(JSON.parse(io.stdout.join("")).layers.map((l: { id: string }) => l.id)).toContain("name");
  });

  it("generate writes the named art PDF", async () => {
    const io = memIo();
    io.files.set("/v.json", new TextEncoder().encode(JSON.stringify({
      name: "Labradorite", barcode: "850051366224",
    })));
    expect(await io.run(["--values", "/v.json", "--out", "/out", "--format", "pdf"])).toBe(0);
    expect(io.files.has("/out/labradorite.pdf")).toBe(true);
  });

  it("unknown variant returns 1", async () => {
    const io = memIo();
    expect(await io.run(["--variant", "nope", "--out", "/out"])).toBe(1);
    expect(io.stderr.join("")).toMatch(/nope/);
  });

  it("legacy none none out still writes four files", async () => {
    const io = memIo();
    expect(await io.run(["none", "none", "/out"])).toBe(0);
    expect(io.files.has("/out/label.pdf")).toBe(true);
    expect(io.files.has("/out/label-mask.pdf")).toBe(true);
    expect(io.files.has("/out/label.psd")).toBe(true);
    expect(io.files.has("/out/label-mask.psd")).toBe(true);
  });

  it("reads values from stdin when --values=-", async () => {
    const io = memIo();
    expect(await io.run(
      ["--values=-", "--out", "/out", "--format", "pdf"],
      JSON.stringify({ name: "Labradorite", barcode: "850051366224" }),
    )).toBe(0);
    expect(io.files.has("/out/labradorite.pdf")).toBe(true);
  });

  it("unknown --asset layer returns 1", async () => {
    const io = memIo();
    expect(await io.run(["--asset", "nope=./a.svg", "--out", "/out"])).toBe(1);
    expect(io.stderr.join("")).toMatch(/nope/);
  });

  it("rejects a .label aimed at a different master", async () => {
    const io = memIo();
    io.files.set("/x.label", packLabel({
      formatVersion: 3, masterId: "other", enabledVariants: [], values: {},
    }, {}));
    expect(await io.run(["--label", "/x.label", "--out", "/out"])).toBe(1);
    expect(io.stderr.join("")).toMatch(/masterId/);
  });

  it("usage errors exit 2 with the usage text", async () => {
    const io = memIo();
    expect(await io.run(["--bogus"])).toBe(2);
    expect(io.stderr.join("")).toMatch(/usage/i);
  });

  it("--set overlays every job's values", async () => {
    const io = memIo();
    io.files.set("/v.json", json([{ name: "A" }, { name: "B", abv: "5" }]));
    expect(await io.run(["--values", "/v.json", "--out", "/out", "--format", "pdf",
      "--set", "name=Forced"])).toBe(1);
    // Both jobs collapse onto the same forced name: the overlay applied to each.
    expect(io.stderr.join("")).toMatch(/duplicate output file "forced\.pdf"/);
  });

  it("--label builds from the saved values and its embedded page art", async () => {
    const io = memIo();
    const lab = lolevMaster();
    const values = coerceValues(lab, { name: "Saved Name", barcode: "850051366224" }, []).values;
    io.files.set("/x.label", packLabel({
      formatVersion: 3, masterId: lab.id, enabledVariants: [], values,
    }, { texture: { name: "t.png", bytes: whitePng() } }));
    expect(await io.run(["--label", "/x.label", "--out", "/out", "--format", "pdf"])).toBe(0);
    expect(io.files.has("/out/saved-name.pdf")).toBe(true);
  });

  it("--variant collab applies on top of a .label that saved no variants", async () => {
    const io = memIo();
    const lab = lolevMaster();
    const values = coerceValues(lab, { name: "Collab Label", barcode: "850051366224" }, []).values;
    io.files.set("/x.label", packLabel({
      formatVersion: 3, masterId: lab.id, enabledVariants: [], values,
    }, {}));
    io.files.set("/left.png", whitePng());
    expect(await io.run([
      "--label", "/x.label", "--out", "/out", "--format", "pdf",
      "--variant", "collab", "--asset", "collabLeft=/left.png",
    ])).toBe(0);
    expect(io.files.has("/out/collab-label.pdf")).toBe(true);
  });

  it("new-form --asset background= and mask= feed the page art", async () => {
    const io = memIo();
    io.files.set("/tex.png", whitePng());
    io.files.set("/mask.png", whitePng());
    io.files.set("/v.json", json({ name: "Art", barcode: "850051366224" }));
    expect(await io.run(["--values", "/v.json", "--out", "/out", "--format", "pdf",
      "--asset", "background=/tex.png", "--asset", "mask=/mask.png"])).toBe(0);
    const withArt = io.files.get("/out/art.pdf")!.length;
    const bare = memIo();
    bare.files.set("/v.json", json({ name: "Art", barcode: "850051366224" }));
    await bare.run(["--values", "/v.json", "--out", "/out", "--format", "pdf"]);
    expect(withArt).toBeGreaterThan(bare.files.get("/out/art.pdf")!.length);
  });

  it("page art aimed at a master with no such role layer is an error, not a no-op", async () => {
    const io = memIo();
    const m = lolevMaster();
    const noRole = { ...m, id: "norole", layers: m.layers.filter((l) => l.kind !== "image" || !l.role) };
    io.files.set("/norole.master", packMaster(noRole, {}));
    io.files.set("/tex.png", whitePng());
    expect(await io.run(["/norole.master", "--out", "/out", "--asset", "background=/tex.png"])).toBe(1);
    expect(io.stderr.join("")).toMatch(/no background layer/);
  });

  it("a bad image in job 2 leaves nothing of job 1 on disk", async () => {
    const io = memIo();
    io.files.set("/v.json", json([
      { values: { name: "First", barcode: "850051366224" } },
      { values: { name: "Second" }, files: { collabLeft: "/missing.png" }, variants: ["collab"] },
    ]));
    expect(await io.run(["--values", "/v.json", "--out", "/out", "--format", "pdf"])).toBe(1);
    expect(io.stderr.join("")).toMatch(/missing\.png/);
    expect([...io.files.keys()].filter((k) => k.startsWith("/out/"))).toEqual([]);
  });

  it("a mistyped override names the layer and field", async () => {
    const io = memIo();
    io.files.set("/v.json", json({ values: { name: "X" }, overrides: { name: { size: "big" } } }));
    expect(await io.run(["--values", "/v.json", "--out", "/out"])).toBe(1);
    expect(io.stderr.join("")).toMatch(/name\.size: expected number, got string/);
  });

  it("legacy config.json plus --collab-left names the output after the config", async () => {
    const io = memIo();
    io.files.set("/cfg.json", json({ version: 1, ...defaultConfig(), beerName: "Old Way" }));
    io.files.set("/left.png", whitePng());
    expect(await io.run(["none", "none", "/out", "/cfg.json", "--collab-left=/left.png"])).toBe(0);
    expect(io.files.has("/out/old-way.pdf")).toBe(true);
  });

  it("rejects a batch whose files would overwrite (night vs night-mask)", async () => {
    const io = memIo();
    io.files.set("/v.json", new TextEncoder().encode(JSON.stringify([
      { name: "Night" }, { name: "Night Mask" },
    ])));
    expect(await io.run(["--values", "/v.json", "--out", "/out", "--format", "pdf"])).toBe(1);
    expect(io.stderr.join("")).toMatch(/night-mask\.pdf/);
  });
});

describe("buildLabel tint", () => {
  const build = (tint: boolean) => buildLabel({
    master: lolevMaster(),
    masterAssets: {},
    values: coerceValues(lolevMaster(), { name: "T", barcode: "850051366224" }, ["collab"]).values,
    enabledVariants: ["collab"],
    overrides: { collabLeft: { tintRaster: tint } },
    extraImages: { collabLeft: { name: "l.png", bytes: whitePng() } },
    format: "pdf",
    assetRoot,
  });
  it("a tinted raster is not the untinted one", async () => {
    const [on, off] = await Promise.all([build(true), build(false)]);
    expect(on.warnings).toEqual([]);
    expect(Buffer.from(on.files[0].bytes).equals(Buffer.from(off.files[0].bytes))).toBe(false);
  });
});

describe("buildLabel missing art", () => {
  it("throws when an image value names an asset that was not loaded", async () => {
    await expect(buildLabel({
      master: lolevMaster(),
      masterAssets: {},
      values: coerceValues(lolevMaster(), { collabLeft: "missing" }, ["collab"]).values,
      enabledVariants: ["collab"],
      extraImages: {},
      format: "pdf",
      assetRoot,
    })).rejects.toThrow(/missing/i);
  });
});
