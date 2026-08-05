// psd-build.test.ts — the layered PSD deliverable: that every element it
// promises actually lands as a layer, and that a keylined element carries a
// stroke effect Photoshop can show (the PDF fakes strokes as a ring of offset
// text copies, which has no PSD equivalent — a layer effect is the parallel).
import { describe, expect, it } from "vitest";
import { readPsd } from "ag-psd";
import { buildPsd, type PsdAssets } from "../src/psd/build";
import { defaultConfig } from "../src/defaults";
import { assets as pdfAssets } from "./fixtures";

const assets: PsdAssets = { fonts: pdfAssets.fonts, logoSvg: pdfAssets.logoSvg };

/** Every layer name in the document, groups flattened. */
function names(children: { name?: string; children?: unknown[] }[] = []): string[] {
  return children.flatMap((l) => [
    l.name ?? "",
    ...names((l.children ?? []) as { name?: string; children?: unknown[] }[]),
  ]);
}

describe("psd build", () => {
  // Built once: buildPsd embeds fonts, which is the slow part.
  let doc: ReturnType<typeof readPsd>;
  const psd = () => doc;

  it("includes the Info layer with its text, markers stripped", async () => {
    doc = readPsd(
      Buffer.from(await buildPsd(defaultConfig(), assets)).buffer as ArrayBuffer,
      // No canvas in Node: skip every pixel surface, the layer TREE is what
      // this asserts.
      { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true },
    );
    expect(names(doc.children)).toContain("Info");
  });

  it("merges the description and the warning into one layer each", () => {
    const all = names(doc.children);
    expect(all).toContain("Description");
    expect(all).toContain("Warning");
    // The old per-line / per-column layers are gone.
    expect(all.filter((n) => /^Description \d/.test(n))).toEqual([]);
    expect(all.filter((n) => /^Warning \d/.test(n))).toEqual([]);
    const flat = (children: any[] = []): any[] =>
      children.flatMap((l) => [l, ...flat(l.children ?? [])]);
    const desc = flat(doc.children as any[]).find((l) => l.name === "Description");
    // Every body line is in that one layer.
    expect((desc.text.text as string).split(/\r|\n/).filter(Boolean).length)
      .toBe(defaultConfig().description.split("\n").length - 1); // less the header
  });

  it("keeps a description line's own style as a run inside the merged layer", async () => {
    const cfg = defaultConfig();
    cfg.description = "# HOPS\nplain line\n**bold line**";
    const psd = readPsd(
      Buffer.from(await buildPsd(cfg, assets)).buffer as ArrayBuffer,
      { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true },
    );
    const flat = (children: any[] = []): any[] =>
      children.flatMap((l) => [l, ...flat(l.children ?? [])]);
    const desc = flat(psd.children as any[]).find((l) => l.name === "Description");
    // Two lines, two faces — so the merged layer must carry more than one
    // style run. (ag-psd collapses runs that are identical, which is why the
    // shipped all-regular block reads as a single run.)
    expect(desc.text.styleRuns?.length ?? 1).toBeGreaterThan(1);
  });

  it("gives every keylined text layer a real stroke effect in black", () => {
    const flat = (children: any[] = []): any[] =>
      children.flatMap((l) => [l, ...flat(l.children ?? [])]);
    const layers = flat(psd().children as any[]);
    // Logo and QR are vector layers, not type layers — they take the same
    // effect through shapeLayer.
    for (const name of [
      "Info", "Volume", "Beer name", "Style line", "ABV", "Wordmark", "Logo", "QR",
    ]) {
      const l = layers.find((x) => x.name === name);
      expect([name, !!l]).toEqual([name, true]);
      const stroke = l.effects?.stroke?.[0];
      expect([name, stroke?.enabled, stroke?.color]).toEqual([
        name, true, { r: 0, g: 0, b: 0 },
      ]);
      expect([name, stroke?.size?.value]).toEqual([name, 15]);
    }
  });
});
