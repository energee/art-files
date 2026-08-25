import { describe, expect, it } from "vitest";
import { lineRuns, rotatedRuns, justifiedRotatedRuns, type MeasureFace } from "../src/plan";

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

  it("a forced face wins over the bold flag, matching drawLine's opts.font", () => {
    const runs = lineRuns("name", { text: "HAZY", fill: "#C8A951", layer: "metallic", bold: true },
      m, { cx: 100, baseline: 50, size: 20, face: "bold" });
    expect(runs[0].face).toBe("bold");
  });
});

describe("rotatedRuns", () => {
  it("advances along -y from yStart, reading bottom-to-top", () => {
    const runs = rotatedRuns("storeCold", { fill: "#C8A951", layer: "metallic" },
      "STORE **COLD**", m, { x: 500, yStart: 300, size: 6, base: "semibold" });
    // No boldFace: **bold** runs keep the base face (drawRotated's contract
    // when its boldFont parameter is omitted, as storeCold's call does).
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
