import { describe, expect, it } from "vitest";
import { lineRuns, rotatedRuns, justifiedRotatedRuns, planLabel, type MeasureFace, type PlacedText } from "../src/plan";
import * as L from "../src/layout";
import { defaultConfig } from "../src/defaults";

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
    const on = { ...defaultConfig(), collabEnabled: true };
    const ids = planLabel(on, m, { collab: { left: true, center: false } }).map((r) => r.id);
    const inLeft = ids.map((id) => LEFT.has(id));
    const split = inLeft.lastIndexOf(true);
    expect(split).toBeGreaterThanOrEqual(0);
    expect(inLeft.slice(0, split + 1).every(Boolean)).toBe(true);
    expect(inLeft.slice(split + 1).some(Boolean)).toBe(false);
  });

  it("skip removes an element without moving its neighbours", () => {
    const all = planLabel(cfg, m);
    const skipped = planLabel(cfg, m, { skip: new Set<import("../src/elements").ElementId>(["abv"]) });
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

  it("collabLead appears only with the switch on AND a left slot filled", () => {
    const on = { ...defaultConfig(), collabEnabled: true };
    expect(planLabel(on, m).some((r) => r.id === "collabLead")).toBe(false);
    expect(planLabel(on, m, { collab: { left: true, center: false } })
      .some((r) => r.id === "collabLead")).toBe(true);
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
