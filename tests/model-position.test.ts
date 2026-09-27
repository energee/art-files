import { describe, expect, it } from "vitest";
import { anchoredX, anchoredY, type GuideLines } from "../src/model/position";

const g: GuideLines = { left: 30, center: 300, right: 570, top: 30, bottom: 330 };
const P = (over = {}) => ({ anchor: "left" as const, vAnchor: "top" as const, offsetX: 0, offsetY: 0, ...over });

describe("anchoredX/Y", () => {
  it("left anchor plants the left edge", () => {
    expect(anchoredX(P(), 100, g)).toBe(30);
    expect(anchoredX(P({ offsetX: 5 }), 100, g)).toBe(35);
  });
  it("center anchor stays centered as width changes", () => {
    expect(anchoredX(P({ anchor: "center" }), 100, g)).toBe(250);
    expect(anchoredX(P({ anchor: "center" }), 200, g)).toBe(200);
  });
  it("right anchor plants the right edge", () => {
    expect(anchoredX(P({ anchor: "right" }), 100, g)).toBe(470);
  });
  it("top and bottom anchors", () => {
    expect(anchoredY(P(), 50, g)).toBe(30);
    expect(anchoredY(P({ vAnchor: "bottom" }), 50, g)).toBe(280);
  });
});
