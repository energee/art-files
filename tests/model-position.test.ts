import { describe, expect, it } from "vitest";
import { anchoredX, anchoredY, positionFromDrag, type GuideLines } from "../src/model/position";

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

describe("positionFromDrag", () => {
  it("snaps the left edge to the left guide and sets the anchor", () => {
    const r = positionFromDrag(33, 100, 80, 20, g, 6);
    expect(r.snappedX).toBe("left");
    expect(r.position.anchor).toBe("left");
    expect(r.position.offsetX).toBe(0);
    expect(anchoredX(r.position, 80, g)).toBe(30);
  });
  it("snaps the box center to the center guide", () => {
    const r = positionFromDrag(262, 100, 80, 20, g, 6);   // center at 302
    expect(r.snappedX).toBe("center");
    expect(anchoredX(r.position, 80, g)).toBe(260);
  });
  it("snaps the right edge to the right guide", () => {
    const r = positionFromDrag(487, 100, 80, 20, g, 6);   // right edge 567
    expect(r.snappedX).toBe("right");
    expect(anchoredX(r.position, 80, g)).toBe(490);
  });
  it("no snap: keeps the nearest anchor with a real offset, round-trips", () => {
    const r = positionFromDrag(100, 100, 80, 20, g, 6);
    expect(r.snappedX).toBeNull();
    expect(anchoredX(r.position, 80, g)).toBe(100);
    expect(anchoredY(r.position, 20, g)).toBe(100);
  });
  it("vertical snap to bottom sets vAnchor", () => {
    const r = positionFromDrag(100, 308, 80, 20, g, 6);   // bottom edge 328
    expect(r.snappedY).toBe("bottom");
    expect(anchoredY(r.position, 20, g)).toBe(310);
  });
  it("nearest-guide tie-breaking prefers the closer snap", () => {
    const r = positionFromDrag(298 - 40, 100, 80, 20, g, 6); // center 298, 2pt off
    expect(r.snappedX).toBe("center");
  });
});
