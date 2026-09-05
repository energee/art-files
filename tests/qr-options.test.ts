import { describe, expect, it } from "vitest";
import { qrPath, qrShapes } from "../src/qr";

describe("QR options", () => {
  it("defaults reproduce the legacy dots output exactly", () => {
    const legacy = qrPath(qrShapes("https://lolev.beer/beer/x"), 100);
    const opted = qrPath(qrShapes("https://lolev.beer/beer/x", { style: "dots", ecLevel: "L" }), 100);
    expect(opted).toBe(legacy);
  });
  it("square style emits module squares, not circles", () => {
    const s = qrShapes("test", { style: "square" });
    expect(s.squares!.length).toBeGreaterThan(0);
    expect(qrPath(s, 100)).not.toContain("a ");   // no arc commands
  });
  it("rounded style emits arcs on rects", () => {
    expect(qrPath(qrShapes("test", { style: "rounded" }), 100)).toContain("a ");
  });
  it("higher EC level yields an equal-or-larger matrix", () => {
    const l = qrShapes("test", { ecLevel: "L" }).count;
    const h = qrShapes("test", { ecLevel: "H" }).count;
    expect(h).toBeGreaterThanOrEqual(l);
  });
  it("memo distinguishes options", () => {
    const a = qrShapes("same", { style: "square" });
    const b = qrShapes("same", { style: "dots" });
    expect(a).not.toBe(b);
  });
});
