import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
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

/** Rasterize square-style shapes (plus a 4-module quiet zone) to RGBA and
 *  decode with jsQR — the same round trip a phone scanner makes. */
function decode(text: string): string | undefined {
  const s = qrShapes(text, { style: "square" });
  const px = 4;
  const quiet = 4;
  const side = (s.count + 2 * quiet) * px;
  const rgba = new Uint8ClampedArray(side * side * 4).fill(255);
  for (const q of s.squares!) {
    const c0 = Math.round(q.x * s.count) + quiet;
    const r0 = Math.round(q.y * s.count) + quiet;
    for (let y = r0 * px; y < (r0 + 1) * px; y++) {
      for (let x = c0 * px; x < (c0 + 1) * px; x++) {
        const i = (y * side + x) * 4;
        rgba.fill(0, i, i + 3);
      }
    }
  }
  return jsQR(rgba, side, side)?.data;
}

describe("QR text encoding (#66)", () => {
  it.each(["https://lolev.beer/beer/x", "🍺 cheers", "Brewed in Kraków — €5", "Café"])(
    "scans back exactly: %s",
    (text) => expect(decode(text)).toBe(text),
  );
});

describe("QR capacity overflow (#71)", () => {
  it("throws a real Error naming the problem, not qrcode-generator's bare string", () => {
    let thrown: unknown;
    try { qrShapes("x".repeat(1300), { ecLevel: "H" }); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/QR value is too long/);
    expect((thrown as Error).message).toMatch(/1300 bytes/);
  });
  it("a value that fits still encodes after an overflow", () => {
    expect(() => qrShapes("x".repeat(1300), { ecLevel: "H" })).toThrow();
    expect(qrShapes("x".repeat(1300), { ecLevel: "L" }).count).toBeGreaterThan(0);
  });
});
