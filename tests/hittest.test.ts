import { describe, expect, it } from "vitest";
import { boxOf, hitTest } from "../src/hittest";
import { defaultConfig } from "../src/defaults";
import * as L from "../src/layout";

// Deterministic stand-in for real font metrics.
const measure = (text: string, size: number) => text.length * size * 0.55;

describe("preview hit-testing", () => {
  const cfg = defaultConfig();

  it("hits the beer name just above its baseline", () => {
    expect(hitTest(L.NAME.cx, L.NAME.baseline - 2, measure, cfg)).toBe("name");
  });

  it("hits the logo inside its box", () => {
    expect(hitTest(L.LOGO.cx, L.LOGO.cy, measure, cfg)).toBe("logo");
  });

  it("hits the QR inside its box", () => {
    expect(hitTest(L.QR.x + 5, L.QR.yTop + 5, measure, cfg)).toBe("qr");
  });

  it("hits rotated store-cold text", () => {
    expect(hitTest(L.STORE_COLD.x - 5, L.STORE_COLD.yStart - 20, measure, cfg)).toBe("storeCold");
  });

  it("returns null on empty background", () => {
    expect(hitTest(300, 250, measure, cfg)).toBeNull();
  });

  it("exposes the same box it hit, for drawing the selection", () => {
    const b = boxOf("logo", cfg, measure)!;
    expect(b.x0).toBeCloseTo(L.LOGO.cx - L.LOGO.w / 2, 5);
    expect(hitTest((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, measure, cfg)).toBe("logo");
  });
});
