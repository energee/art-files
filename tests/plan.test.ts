import { describe, expect, it } from "vitest";
import { planLabel, barcodeItem } from "./legacy/plan";
import { lineRuns, rotatedRuns, justifiedRotatedRuns, labelGuides, type MeasureFace, type PlacedText, type PlacedImage } from "./legacy/planShared";
import * as L from "./legacy/layout";
import { defaultConfig } from "../src/defaults";
import { assets } from "./fixtures";
import type { CustomTextLayer, CustomImageLayer } from "../src/types";

// Deterministic fake metrics: 0.5pt per char per size unit, bold faces 10% wider.
const m: MeasureFace = (text, size, face) =>
  text.length * size * 0.5 * (face === "regular" ? 1 : 1.1);

describe("lineRuns", () => {
  it("places a plain flat line as one regular run at x", () => {
    const runs = lineRuns("volume", { text: "1 PINT", fill: "#C8A951", layer: "metallic" },
      m, { x: 40, baseline: 100, size: 10 });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: "volume", text: "1 PINT", x: 40, y: 100, size: 10,
      face: "regular", tracking: 0, rotated: false,
    });
    expect(runs[0].w).toBeCloseTo(m("1 PINT", 10, "regular"));
  });

  it("centres on cx using the tracked total width", () => {
    const tracking = 2;
    const runs = lineRuns("styleLine", { text: "IPA", fill: "#C8A951", layer: "metallic", letterSpacing: tracking },
      m, { cx: 100, baseline: 50, size: 8 });
    const total = m("IPA", 8, "regular") + tracking * 2; // trackedWidth: (len-1) gaps
    expect(runs[0].x).toBeCloseTo(100 - total / 2);
    expect(runs[0].tracking).toBe(tracking);
  });

  it("splits inline **bold** markers into runs with advancing x", () => {
    const runs = lineRuns("styleLine", { text: "a **b** c", fill: "#C8A951", layer: "metallic" },
      m, { x: 10, baseline: 50, size: 10 });
    expect(runs.map((r) => [r.text, r.face])).toEqual(
      [["a ", "regular"], ["b", "semibold"], [" c", "regular"]]);
    // Each run starts where the previous advance ended.
    expect(runs[1].x).toBeCloseTo(runs[0].x + runs[0].w);
    expect(runs[2].x).toBeCloseTo(runs[1].x + runs[1].w);
  });

  it("a forced face wins over the bold flag, matching lineRuns's at.face contract", () => {
    const runs = lineRuns("name", { text: "HAZY", fill: "#C8A951", layer: "metallic", bold: true },
      m, { cx: 100, baseline: 50, size: 20, face: "bold" });
    expect(runs[0].face).toBe("bold");
  });
});

describe("rotatedRuns", () => {
  it("advances along -y from yStart, reading bottom-to-top", () => {
    const runs = rotatedRuns("storeCold", { fill: "#C8A951", layer: "metallic" },
      "STORE **COLD**", m, { x: 500, yStart: 300, size: 6, base: "semibold" });
    // No boldFace: **bold** runs keep the base face (rotatedRuns's contract
    // when its boldFace parameter is omitted, as storeCold's call does).
    expect(runs.map((r) => r.face)).toEqual(["semibold", "semibold"]);
    expect(runs[0]).toMatchObject({ x: 500, y: 300, rotated: true });
    // The second run starts one full advance closer to the label top.
    expect(runs[1].y).toBeCloseTo(300 - runs[0].w);
  });

  it("steps **bold** runs up to boldFace when given", () => {
    const runs = rotatedRuns("handleAddress", { fill: "#C8A951", layer: "metallic" },
      "@LOLEV **BEER**", m, { x: 500, yStart: 300, size: 6, base: "semibold", boldFace: "bold" });
    expect(runs.map((r) => r.face)).toEqual(["semibold", "bold"]);
  });
});

describe("justifiedRotatedRuns", () => {
  it("stretches inter-word gaps so the span is exactly maxLen", () => {
    const runs = justifiedRotatedRuns("warning", { fill: "none", layer: "metallic" },
      "AB CD EF", m, { x: 520, yStart: 300, size: 5, maxLen: 100, base: "regular" });
    expect(runs).toHaveLength(3);
    // First word starts at yStart; the far end of the last word lands at
    // yStart - maxLen exactly.
    expect(runs[0].y).toBe(300);
    const last = runs[runs.length - 1];
    expect(last.y - last.w).toBeCloseTo(300 - 100);
  });

  it("a bold span across words bolds each word, no literal markers (#89)", () => {
    const runs = justifiedRotatedRuns("warning", { fill: "none", layer: "metallic" },
      "**GOVERNMENT WARNING:** (1) text", m, { x: 520, yStart: 300, size: 5, maxLen: 200, base: "regular", boldFace: "bold" });
    expect(runs.map((r) => [r.text, r.face])).toEqual([
      ["GOVERNMENT", "bold"], ["WARNING:", "bold"], ["(1)", "regular"], ["text", "regular"],
    ]);
    const last = runs[runs.length - 1];
    expect(last.y - last.w).toBeCloseTo(300 - 200);
  });

  it("a single word keeps its natural length (no gap to stretch)", () => {
    const runs = justifiedRotatedRuns("warning", { fill: "none", layer: "metallic" },
      "ALCOHOL", m, { x: 520, yStart: 300, size: 5, maxLen: 100, base: "regular" });
    expect(runs).toHaveLength(1);
    expect(runs[0].w).toBeCloseTo(m("ALCOHOL", 5, "regular"));
  });
});

describe("planLabel", () => {
  const cfg = defaultConfig();

  it("emits every text element of a default config, in draw order", () => {
    const ids = [...new Set(planLabel(cfg, m).map((r) => r.id))];
    expect(ids).toEqual([
      "volume", "abv", "description", "wordmark", "name", "styleLine",
      "handleAddress", "warning", "storeCold",
    ]);
  });

  it("the LEFT-column ids form a strict prefix of the run order", () => {
    // src/pdf/build.ts's drawElements keeps a hand-maintained `LEFT` set
    // (volume, abv, description, collabLead) and draws it as one filter
    // pass before everything else, relying on those ids already being
    // contiguous and first in planLabel's output. Restated here (that set
    // isn't exported) so a future reorder of planLabel's element walk that
    // breaks the split fails this test instead of silently reordering the
    // PDF's left column.
    const LEFT = new Set(["volume", "abv", "description", "collabLead"]);
    const ids = planLabel(defaultConfig(), m, { collab: { left: true, center: false } }).map((r) => r.id);
    const inLeft = ids.map((id) => LEFT.has(id));
    const split = inLeft.lastIndexOf(true);
    expect(split).toBeGreaterThanOrEqual(0);
    expect(inLeft.slice(0, split + 1).every(Boolean)).toBe(true);
    expect(inLeft.slice(split + 1).some(Boolean)).toBe(false);
  });

  it("skip removes an element without moving its neighbours", () => {
    const all = planLabel(cfg, m);
    const skipped = planLabel(cfg, m, { skip: new Set<import("./legacy/elements").ElementId>(["abv"]) });
    expect(skipped.some((r) => r.id === "abv")).toBe(false);
    const others = (rs: typeof all) => rs.filter((r) => r.id !== "abv");
    expect(others(skipped)).toEqual(others(all));
  });

  it("the ABV line is the display string, not the raw config field", () => {
    const abv = planLabel(cfg, m).filter((r): r is PlacedText => r.id === "abv" && r.kind === "text");
    expect(abv.map((r) => r.text).join("")).toContain("% alc by vol");
  });

  it("name and wordmark are forced to the Bold face and the name is uppercased", () => {
    const c = { ...defaultConfig(), beerName: "hazy" };
    const name = planLabel(c, m).filter((r): r is PlacedText => r.id === "name" && r.kind === "text");
    expect(name.every((r) => r.face === "bold")).toBe(true);
    expect(name.map((r) => r.text).join("")).toBe("HAZY");
  });

  it("collabLead appears only when a left slot is filled", () => {
    const c = defaultConfig();
    expect(planLabel(c, m).some((r) => r.id === "collabLead")).toBe(false);
    expect(planLabel(c, m, { collab: { left: true, center: false } })
      .some((r) => r.id === "collabLead")).toBe(true);
  });

  it("opts.collab holds the slot open when the art is nulled out (hidden logo)", () => {
    // The PDF build drops a hidden logo's art so no bytes reach the file, but
    // the lead-in has its own eye — it must survive, or the export diverges
    // from the preview.
    const c = defaultConfig();
    const { logoSvg } = assets;
    const plan = planLabel(c, m, {
      collab: { left: true, center: false },
      assets: { logoSvg, collabLeft: null, collabCenter: null },
    });
    expect(plan.some((r) => r.id === "collabLead")).toBe(true);
    expect(plan.some((r) => r.id === "collabLeft")).toBe(false);
  });

  it("every warning column with 2+ words justifies to exactly maxLen", () => {
    const byColumn = new Map<number, { start: number; end: number; words: number }>();
    for (const r of planLabel(cfg, m).filter((r): r is PlacedText => r.id === "warning" && r.kind === "text")) {
      const col = byColumn.get(r.x) ?? { start: -Infinity, end: Infinity, words: 0 };
      byColumn.set(r.x, {
        start: Math.max(col.start, r.y), end: Math.min(col.end, r.y - r.w),
        words: col.words + 1,
      });
    }
    expect(byColumn.size).toBeGreaterThan(1);
    for (const col of byColumn.values())
      if (col.words >= 2)
        expect(col.start - col.end).toBeCloseTo(L.WARNING.maxLen, 5);
  });
});

// A tiny valid logo SVG: one triangle, laurel-shaped viewBox.
const LOGO_SVG =
  '<svg viewBox="0 0 480 525"><path d="M0 0 L480 0 L240 525 Z"/></svg>';

describe("planLabel with assets", () => {
  const cfg = defaultConfig();
  const assets = { logoSvg: LOGO_SVG };

  it("emits the laurel as a paths item centred on LOGO.cx", () => {
    const logo = planLabel(cfg, m, { assets }).find((r) => r.id === "logo");
    expect(logo).toBeDefined();
    expect(logo!.kind).toBe("paths");
    if (logo!.kind !== "paths") return;
    // parseLogo scales by width: drawn w is exactly LOGO.w, x centres it.
    expect(logo!.x).toBeCloseTo(L.LOGO.cx - L.LOGO.w / 2);
    expect(logo!.paths.length).toBeGreaterThan(0);
    expect(logo!.fill).toBe(cfg.logo.fill);
  });

  it("skip('logo') removes the laurel; without assets no laurel exists", () => {
    expect(planLabel(cfg, m, { assets, skip: new Set(["logo" as const]) })
      .some((r) => r.id === "logo")).toBe(false);
    expect(planLabel(cfg, m).some((r) => r.id === "logo")).toBe(false);
  });

  it("emits the QR as underlay+fill paths when stroked, fill alone when not", () => {
    const stroked = planLabel(cfg, m, { assets }).filter((r) => r.id === "qr");
    // defaultConfig ships a qrStroke; both items sit at the QR plate origin.
    expect(stroked).toHaveLength(2);
    expect(stroked.every((r) => r.kind === "paths"
      && r.x === L.QR.x && r.y === L.QR.yTop)).toBe(true);
    const bare = planLabel({ ...cfg, qrStroke: "none" }, m, { assets })
      .filter((r) => r.id === "qr");
    expect(bare).toHaveLength(1);
  });

  it("keeps text placement identical with and without assets", () => {
    const textOnly = planLabel(cfg, m);
    const full = planLabel(cfg, m, { assets }).filter((r) => r.kind === "text");
    expect(full).toEqual(textOnly);
  });

  it("orders the laurel between wordmark and name (the z-order pin)", () => {
    const ids = planLabel(cfg, m, { assets }).map((r) => r.id);
    expect(ids.indexOf("logo")).toBeGreaterThan(ids.lastIndexOf("wordmark"));
    expect(ids.indexOf("logo")).toBeLessThan(ids.indexOf("name"));
    // QR draws after storeCold — drawElements' actual order.
    expect(ids.indexOf("qr")).toBeGreaterThan(ids.lastIndexOf("storeCold"));
  });
});

describe("planLabel collab images and barcode", () => {
  const cfg = defaultConfig();
  const assets = { logoSvg: LOGO_SVG };

  it("fits a raster centre logo into its envelope, centred on cx", () => {
    // 200x100 raster in a 36x36 envelope at scale 1: width-bound, s=0.18.
    const item = planLabel(cfg, m, {
      assets: { ...assets, collabCenter: { kind: "raster" as const, w: 200, h: 100 } },
    }).find((r) => r.id === "collabCenter");
    expect(item).toBeDefined();
    if (item!.kind !== "image") throw new Error("expected an image item");
    expect(item!.w).toBeCloseTo(L.COLLAB_CENTER.maxW * cfg.collabCenter.scale);
    expect(item!.h).toBeCloseTo(item!.w / 2);
    expect(item!.x).toBeCloseTo(L.COLLAB_CENTER.cx - item!.w / 2);
  });

  it("plans an svg left logo as paths at the flowed position", () => {
    const item = planLabel(cfg, m, {
      assets: { ...assets, collabLeft: { kind: "svg" as const, svg: LOGO_SVG } },
    }).find((r) => r.id === "collabLeft");
    expect(item?.kind).toBe("paths");
    if (item?.kind !== "paths") return;
    expect(item.x).toBeCloseTo(L.COLLAB_LEFT.x);
  });

  it("barcodeItem resolves the halo exactly like barcodeStrokePt", () => {
    expect(barcodeItem({ ...cfg, barcodeStroke: "none" }, m).S).toBe(0);
    expect(barcodeItem({ ...cfg, barcodeStrokeWidth: 10 }, m).S).toBeCloseTo(10 * L.PX);
    // defaultConfig ships barcodeStrokeWidth set (20); explicitly unsetting it
    // is what exercises the "unset -> measured halo" branch of barcodeStrokePt.
    expect(barcodeItem({ ...cfg, barcodeStrokeWidth: undefined }, m).S).toBeCloseTo(L.BARCODE.stroke);
  });

  it("places digit runs so each spans w toward the label top from y", () => {
    const item = barcodeItem(cfg, m);
    expect(item.digits).toHaveLength(4);
    for (const d of item.digits) {
      // Rotated-run convention: y is the run's start (bottom), extent is -w.
      const centerTop = (d.y + (d.y - d.w)) / 2;
      const g = item.geo.digits.find((x) => x.text === d.text)!;
      expect(centerTop).toBeCloseTo(item.geo.bottom - g.center * item.geo.mod, 5);
    }
  });

  it("the barcode is the plan's last item", () => {
    const list = planLabel(cfg, m, { assets });
    expect(list[list.length - 1].kind).toBe("barcode");
  });
});

describe("labelGuides", () => {
  it("returns SAFE's edges with center at their midpoint", () => {
    const g = labelGuides();
    expect(g).toEqual({
      left: L.SAFE.left, right: L.SAFE.right,
      top: L.SAFE.top, bottom: L.SAFE.bottom,
      center: (L.SAFE.left + L.SAFE.right) / 2,
    });
  });
});

describe("planLabel with customLayers", () => {
  const cfg = defaultConfig();

  it("absent/empty customLayers produces a plan deep-equal to the no-layers plan", () => {
    const base = planLabel(cfg, m);
    expect(planLabel({ ...cfg, customLayers: [] }, m)).toEqual(base);
    expect(planLabel({ ...cfg, customLayers: undefined }, m)).toEqual(base);
  });

  it("places a custom text layer anchored top-left, on top of the fixed elements", () => {
    const layer: CustomTextLayer = {
      id: "custom-t1", name: "Custom", type: "text", size: 12,
      position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
      line: { text: "HI", fill: "#000000", layer: "metallic" },
    };
    const list = planLabel({ ...cfg, customLayers: [layer] }, m);
    const items = list.filter((r): r is PlacedText => r.id === "custom-t1");
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item.kind).toBe("text");
    const tw = m("HI", 12, "regular");
    expect(item.x).toBeCloseTo(L.SAFE.left);
    expect(item.y).toBeCloseTo(L.SAFE.top + 12);
    expect(item.w).toBeCloseTo(tw);
    // Drawn after every fixed element (on top).
    expect(list[list.length - 1].id).toBe("custom-t1");
  });

  it("a center-anchored text layer re-centers around the measured width", () => {
    const layer: CustomTextLayer = {
      id: "custom-t2", name: "Custom", type: "text", size: 12,
      position: { anchor: "center", vAnchor: "top", offsetX: 0, offsetY: 0 },
      line: { text: "WIDER TEXT", fill: "#000000", layer: "metallic" },
    };
    const item = planLabel({ ...cfg, customLayers: [layer] }, m)
      .find((r): r is PlacedText => r.id === "custom-t2")!;
    const g = labelGuides();
    const tw = m("WIDER TEXT", 12, "regular");
    expect(item.x).toBeCloseTo(g.center - tw / 2);
  });

  it("places a custom image layer sized from the asset's aspect", () => {
    const layer: CustomImageLayer = {
      id: "custom-i1", name: "Custom Image", type: "image", asset: "art1", w: 100,
      position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
      style: { fill: "none", layer: "white" },
    };
    const item = planLabel(
      { ...cfg, customLayers: [layer] }, m, { assets: { logoSvg: assets.logoSvg, custom: { art1: { aspect: 2 } } } },
    ).find((r): r is PlacedImage => r.id === "custom-i1");
    expect(item).toBeDefined();
    if (item?.kind !== "image") throw new Error("expected an image item");
    expect(item.w).toBe(100);
    expect(item.h).toBeCloseTo(50);
  });

  it("emits nothing for a custom image layer whose asset key is missing", () => {
    const layer: CustomImageLayer = {
      id: "custom-i2", name: "Missing", type: "image", asset: "nope", w: 100,
      position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
      style: { fill: "none", layer: "white" },
    };
    const list = planLabel(
      { ...cfg, customLayers: [layer] }, m, { assets: { logoSvg: assets.logoSvg, custom: {} } },
    );
    expect(list.some((r) => r.id === "custom-i2")).toBe(false);
  });

  it("PlanOpts.skip applies to custom ids like any other id", () => {
    const layer: CustomTextLayer = {
      id: "custom-t3", name: "Custom", type: "text", size: 12,
      position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
      line: { text: "HI", fill: "#000000", layer: "metallic" },
    };
    const list = planLabel({ ...cfg, customLayers: [layer] }, m, {
      skip: new Set<import("./legacy/elements").ElementId>(["custom-t3"]),
    });
    expect(list.some((r) => r.id === "custom-t3")).toBe(false);
  });
});
