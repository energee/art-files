// custom-layers.test.ts — schema for the master-variant custom layers:
// CustomLayer (text/image) survives a JSON round-trip, and isCustomId
// distinguishes custom layer ids from the fixed ElementId set.
import { describe, expect, it } from "vitest";
import type {
  CustomBarcodeLayer, CustomImageLayer, CustomLayer, CustomQrLayer, CustomTextLayer, LabelConfig,
} from "@/types";
import { defaultConfig } from "@/defaults";
import { dragTarget2, isCustomId } from "./legacy/elements";
import { anchoredX, anchoredY } from "@/model/position";
import { barcodeItem, planLabel } from "./legacy/plan";
import { labelGuides, type PlacedBarcode, type PlacedImage, type PlacedPaths,  } from "../src/plan";
import { minModuleWarning } from "@/model/fields";
import { qrShapes, qrPath } from "@/qr";
import { FONT_ASC, FONT_DESC } from "@/layout";

describe("custom layer schema", () => {
  it("adds a custom text layer to LabelConfig and round-trips through JSON", () => {
    const cfg = defaultConfig();
    const textLayer: CustomTextLayer = {
      id: "custom-a1b2c3",
      name: "Extra line",
      type: "text",
      position: { anchor: "center", vAnchor: "top", offsetX: 0, offsetY: 0 },
      line: { text: "Hello", fill: "#000000", layer: "white" },
      size: 12,
    };
    const layers: CustomLayer[] = [textLayer];
    cfg.customLayers = layers;

    const roundTripped = JSON.parse(JSON.stringify(cfg));
    expect(roundTripped).toEqual(cfg);
    expect(roundTripped.customLayers[0].id).toBe("custom-a1b2c3");
  });

  it("distinguishes custom ids from fixed element ids", () => {
    expect(isCustomId("custom-x")).toBe(true);
    expect(isCustomId("logo")).toBe(false);
  });
});

describe("custom image layer — stored aspect fallback", () => {
  it("planLabel emits `asset` and h = w / aspect from the layer's stored aspect, with no PlanAssets.custom", () => {
    const cfg = defaultConfig();
    const layer: CustomImageLayer = {
      id: "custom-i9", name: "Custom Image", type: "image", asset: "art9", w: 80, aspect: 4,
      position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
      style: { fill: "none", layer: "white" },
    };
    cfg.customLayers = [layer];
    const m = (text: string, size: number) => text.length * size;
    // No opts.assets at all: the loaded-bytes path (PlanAssets.custom) is
    // entirely absent, so this exercises the stored-aspect fallback alone.
    const item = planLabel(cfg, m).find((r): r is PlacedImage => r.id === "custom-i9");
    expect(item).toBeDefined();
    if (item?.kind !== "image") throw new Error("expected an image item");
    expect(item.asset).toBe("art9");
    expect(item.w).toBe(80);
    expect(item.h).toBeCloseTo(20); // 80 / 4
  });
});

describe("custom image layer — SVG art plans as paths, not a rect", () => {
  it("emits a `paths` item fitted to layer.w, styled from layer.style", () => {
    const cfg = defaultConfig();
    const layer: CustomImageLayer = {
      id: "custom-svg1", name: "Custom Art", type: "image", asset: "art-svg", w: 40,
      position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
      style: { fill: "#112233", layer: "metallic" },
    };
    cfg.customLayers = [layer];
    const m = (text: string, size: number) => text.length * size;
    const svg = '<svg viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z"/></svg>';
    const items = planLabel(cfg, m, {
      assets: {
        logoSvg: svg,
        custom: { "art-svg": { aspect: 1, art: { kind: "svg", svg } } },
      },
    });
    const item = items.find((r) => r.id === "custom-svg1");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("paths");
    if (item?.kind !== "paths") throw new Error("expected a paths item");
    expect(item.fill).toBe("#112233");
    expect(item.layer).toBe("metallic");
    expect(item.paths.length).toBeGreaterThan(0);
    // Never both: an SVG custom image must not ALSO plan the rect `image`
    // item its stored aspect would otherwise fall back to.
    expect(items.some((r) => r.id === "custom-svg1" && r.kind === "image")).toBe(false);
  });
});

describe("dragTarget2", () => {
  const textLayer: CustomTextLayer = {
    id: "custom-a1b2c3",
    name: "Extra line",
    type: "text",
    position: { anchor: "left", vAnchor: "top", offsetX: 3, offsetY: 5 },
    line: { text: "Hello", fill: "#000000", layer: "white" },
    size: 12,
  };

  it("returns null for a locked custom layer", () => {
    const cfg = defaultConfig();
    cfg.customLayers = [{ ...textLayer, locked: true }];
    expect(dragTarget2(cfg, { left: false, center: false }, "custom-a1b2c3")).toBeNull();
  });

  it("returns null for an id with no matching custom layer", () => {
    const cfg = defaultConfig();
    cfg.customLayers = [];
    expect(dragTarget2(cfg, { left: false, center: false }, "custom-a1b2c3")).toBeNull();
  });

  it("gives an unlocked custom layer the position form", () => {
    const cfg = defaultConfig();
    cfg.customLayers = [textLayer];
    const t = dragTarget2(cfg, { left: false, center: false }, "custom-a1b2c3");
    expect(t?.kind).toBe("position");
    if (t?.kind !== "position") throw new Error("expected position form");
    expect(t.get()).toEqual(textLayer.position);
  });

  it("set() writes a position that round-trips through anchoredX/anchoredY", () => {
    const cfg = defaultConfig();
    cfg.customLayers = [textLayer];
    const t = dragTarget2(cfg, { left: false, center: false }, "custom-a1b2c3");
    if (t?.kind !== "position") throw new Error("expected position form");
    const guides = labelGuides();
    const w = 40, h = 12;
    const newPosition = { anchor: "center" as const, vAnchor: "bottom" as const, offsetX: -2, offsetY: 7 };
    t.set(cfg, newPosition);
    const updated = dragTarget2(cfg, { left: false, center: false }, "custom-a1b2c3");
    if (updated?.kind !== "position") throw new Error("expected position form");
    expect(updated.get()).toEqual(newPosition);
    expect(anchoredX(updated.get(), w, guides)).toBeCloseTo(guides.center - w / 2 - 2, 5);
    expect(anchoredY(updated.get(), h, guides)).toBeCloseTo(guides.bottom - h + 7, 5);
  });

  it("box() measures a text layer's run width using the given measurer", () => {
    const cfg = defaultConfig();
    cfg.customLayers = [textLayer];
    const m = (text: string, size: number) => text.length * size;
    const t = dragTarget2(cfg, { left: false, center: false }, "custom-a1b2c3", m);
    if (t?.kind !== "position") throw new Error("expected position form");
    expect(t.box()).toEqual({ w: "Hello".length * 12, h: 12 });
  });

  it("box() returns null for a text layer with no measurer given", () => {
    const cfg = defaultConfig();
    cfg.customLayers = [textLayer];
    const t = dragTarget2(cfg, { left: false, center: false }, "custom-a1b2c3");
    if (t?.kind !== "position") throw new Error("expected position form");
    expect(t.box()).toBeNull();
  });

  it("keeps the offsetY form for logo/collab ids, unchanged by dragTarget2", () => {
    const cfg = defaultConfig();
    const t = dragTarget2(cfg, { left: false, center: false }, "logo");
    expect(t?.kind).toBe("offsetY");
    if (t?.kind !== "offsetY") throw new Error("expected offsetY form");
    expect(t.get()).toBe(cfg.logo.offsetY ?? 0);
  });

  it("returns null for a locked logo", () => {
    const cfg = defaultConfig();
    cfg.logo.locked = true;
    expect(dragTarget2(cfg, { left: false, center: false }, "logo")).toBeNull();
  });

});

const m = (text: string, size: number) => text.length * size;

describe("custom qr layer", () => {
  const base: CustomQrLayer = {
    id: "custom-qr1", name: "Custom QR", type: "qr",
    value: "https://lolev.beer/beer/test",
    size: 40, qrStyle: "square",
    position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
    style: { fill: "#000000", layer: "white" },
  };

  it("defaults to EC M: differs from an explicit L plan, matches an explicit M plan", () => {
    const cfgDefault = defaultConfig();
    cfgDefault.customLayers = [base];
    const cfgL = defaultConfig();
    cfgL.customLayers = [{ ...base, ecLevel: "L" }];
    const cfgM = defaultConfig();
    cfgM.customLayers = [{ ...base, ecLevel: "M" }];

    const fillPaths = (cfg: typeof cfgDefault) =>
      planLabel(cfg, m).filter((r): r is PlacedPaths => r.kind === "paths" && r.id === "custom-qr1");

    const def = fillPaths(cfgDefault);
    const l = fillPaths(cfgL);
    const mLevel = fillPaths(cfgM);
    expect(def).toEqual(mLevel);
    expect(def).not.toEqual(l);

    // Sanity: this is really EC-driven, not a fluke — qrShapes/qrPath for the
    // same payload at M and L differ (M adds codewords -> a bigger matrix).
    const shapesL = qrShapes(base.value, { style: "square", ecLevel: "L" });
    const shapesM = qrShapes(base.value, { style: "square", ecLevel: "M" });
    expect(qrPath(shapesM, base.size)).not.toBe(qrPath(shapesL, base.size));
  });

  it("emits a stroke-underlay path when styled with a stroke", () => {
    const cfg = defaultConfig();
    cfg.customLayers = [{ ...base, style: { ...base.style, stroke: "#ffffff", strokeWidth: 20 } }];
    const items = planLabel(cfg, m).filter((r): r is PlacedPaths => r.kind === "paths" && r.id === "custom-qr1");
    expect(items).toHaveLength(2);
  });
});

describe("custom barcode layer", () => {
  const base: CustomBarcodeLayer = {
    id: "custom-bc1", name: "Custom Barcode", type: "barcode",
    symbology: "code-128", value: "LOLEV-123",
    h: 30, moduleW: 1,
    position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
    style: { fill: "#000000", layer: "white" },
  };

  it("digits obey showDigits: default plans digits, false plans none", () => {
    const cfgDefault = defaultConfig();
    cfgDefault.customLayers = [base];
    const withDigits = planLabel(cfgDefault, m)
      .find((r): r is PlacedBarcode => r.kind === "barcode" && r.id === "custom-bc1");
    expect(withDigits).toBeDefined();
    expect(withDigits!.digits.length).toBeGreaterThan(0);

    const cfgNoDigits = defaultConfig();
    cfgNoDigits.customLayers = [{ ...base, showDigits: false }];
    const noDigits = planLabel(cfgNoDigits, m)
      .find((r): r is PlacedBarcode => r.kind === "barcode" && r.id === "custom-bc1");
    expect(noDigits).toBeDefined();
    expect(noDigits!.digits).toHaveLength(0);
  });

  it("an invalid payload emits nothing", () => {
    const cfg = defaultConfig();
    cfg.customLayers = [{ ...base, symbology: "upc-a", value: "not-a-upc" }];
    const item = planLabel(cfg, m).find((r) => r.id === "custom-bc1");
    expect(item).toBeUndefined();
  });

  // Regression: barcodeDigitsFor's `measure` must be in MODULE units (it has
  // no `mod` to convert with — see its own comment); the caller here was
  // passing raw points, double-scaling an edge digit's (dir +-1) offset by
  // moduleW a second time once `center` gets multiplied back by moduleW.
  // Centered groups (dir 0, e.g. code-128's single group) never combine
  // measure with the anchor, so only an edge digit — ean-13's leading digit
  // here — exercises this: its offset FROM the module anchor is a pure
  // points quantity (half the digit's measured width) and must stay the same
  // in points whatever moduleW scales the anchor itself by.
  it("keeps an edge digit's measure-based offset in points, independent of moduleW", () => {
    const ean13Base: CustomBarcodeLayer = {
      ...base, symbology: "ean-13", value: "4006381333931",
    };
    const build = (moduleW: number) => {
      const cfg = defaultConfig();
      cfg.customLayers = [{ ...ean13Base, moduleW }];
      return planLabel(cfg, m)
        .find((r): r is PlacedBarcode => r.kind === "barcode" && r.id === "custom-bc1")!;
    };
    const guides = labelGuides();
    const textSize = ean13Base.h * (10 / 15); // layer.h * fontSize:barH ratio, matching plan.ts
    const ptsWidth = m("4", textSize); // leading digit's measured width in points
    for (const moduleW of [1, 2]) {
      const item = build(moduleW);
      const lead = item.digits[0];
      expect(lead.text).toBe("4");
      // The layer's box now includes the quiet zone the leading digit sits in
      // (see customBarcodeBox), so the -quiet module anchor lands exactly on
      // the box's own left edge whatever moduleW is; the measure/2 term must
      // still not scale — it's a fixed points offset either way.
      const expectedX = guides.left + ptsWidth / 2;
      expect(lead.x).toBeCloseTo(expectedX, 10);
    }
  });

  // Final fix wave (C1/I1): the template barcode is laid out sideways
  // (modules along Y) and rotates every digit glyph 90°; a custom barcode
  // layer is laid out upright (modules along X) and must NOT rotate its
  // digits, or they collide with the bars. PlacedBarcode.rotated is what
  // tells each backend which of the two placements to draw.
  it("is laid out upright: rotated is false, unlike the template's true", () => {
    const cfg = defaultConfig();
    cfg.customLayers = [base];
    const custom = planLabel(cfg, m)
      .find((r): r is PlacedBarcode => r.kind === "barcode" && r.id === "custom-bc1")!;
    expect(custom.rotated).toBe(false);

    const template = barcodeItem(cfg, m);
    expect(template.rotated).toBe(true);
  });

  // I1: the white-ink footprint used to cover the bars only — the digits'
  // ink had no plate underneath it. It now adds one pill per digit group.
  it("footprint includes one digit pill per digit group, in the upright layout, when showDigits is on", () => {
    const cfg = defaultConfig();
    cfg.customLayers = [base];
    const withDigits = planLabel(cfg, m)
      .find((r): r is PlacedBarcode => r.kind === "barcode" && r.id === "custom-bc1")!;
    expect(withDigits.digits.length).toBeGreaterThan(0);
    expect(withDigits.footprint.length).toBe(withDigits.geo.bars.length + withDigits.digits.length);

    const cfgNoDigits = defaultConfig();
    cfgNoDigits.customLayers = [{ ...base, showDigits: false }];
    const noDigits = planLabel(cfgNoDigits, m)
      .find((r): r is PlacedBarcode => r.kind === "barcode" && r.id === "custom-bc1")!;
    expect(noDigits.digits).toHaveLength(0);
    expect(noDigits.footprint.length).toBe(noDigits.geo.bars.length);

    // The pill's rect matches the hand-computed upright formula: x spans the
    // run's centered width, yTop/h span the font box (FONT_ASC/FONT_DESC at
    // the item's own textSize) around the baseline, each outset by S.
    const d = withDigits.digits[0];
    const pill = withDigits.footprint[withDigits.geo.bars.length];
    const S = withDigits.S;
    const x0 = d.x - d.w / 2 - S;
    const x1 = d.x + d.w / 2 + S;
    const y0 = d.y - FONT_ASC * withDigits.textSize - S;
    const y1 = d.y + FONT_DESC * withDigits.textSize + S;
    expect(pill.x).toBeCloseTo(x0, 10);
    expect(pill.w).toBeCloseTo(x1 - x0, 10);
    expect(pill.yTop).toBeCloseTo(y0, 10);
    expect(pill.h).toBeCloseTo(y1 - y0, 10);
  });
});

describe("no custom layers -> byte-identical pre-feature plan", () => {
  it("matches a plan built with customLayers entirely absent", () => {
    const cfgAbsent = defaultConfig();
    const cfgEmpty = defaultConfig();
    cfgEmpty.customLayers = [];
    expect(planLabel(cfgEmpty, m)).toEqual(planLabel(cfgAbsent, m));
  });
});

describe("custom layer order is z-order (Task 4)", () => {
  it("custom layer order is z-order: a later layer plans on top", () => {
    const cfg = defaultConfig();
    const layer = (id: `custom-${string}`, text: string) => ({
      id, name: text, type: "text" as const, size: 10,
      position: { anchor: "left" as const, vAnchor: "top" as const, offsetX: 0, offsetY: 0 },
      line: { text, fill: "#000000" as const, layer: "white" as const },
    });
    cfg.customLayers = [layer("custom-a", "A"), layer("custom-b", "B")];
    const ids = (c: LabelConfig) =>
      planLabel(c, m).filter((p) => p.id.startsWith("custom-")).map((p) => p.id);
    expect(ids(cfg)).toEqual(["custom-a", "custom-b"]);
    const swapped = structuredClone(cfg);
    swapped.customLayers = [cfg.customLayers[1], cfg.customLayers[0]];
    expect(ids(swapped)).toEqual(["custom-b", "custom-a"]);
  });
});

describe("minModuleWarning (P4)", () => {
  it("fires under 0.72pt and stays quiet at 1pt", () => {
    expect(minModuleWarning("code-128", 0.5)).toMatch(/module/i);
    expect(minModuleWarning("code-128", 1)).toBeNull();
  });
});
