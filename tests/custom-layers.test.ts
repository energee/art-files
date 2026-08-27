// custom-layers.test.ts — schema for the master-variation custom layers:
// CustomLayer (text/image) survives a JSON round-trip, and isCustomId
// distinguishes custom layer ids from the fixed ElementId set.
import { describe, expect, it } from "vitest";
import type {
  CustomBarcodeLayer, CustomImageLayer, CustomLayer, CustomQrLayer, CustomTextLayer,
} from "@/types";
import { defaultConfig } from "@/defaults";
import { dragTarget2, isCustomId } from "@/elements";
import { anchoredX, anchoredY } from "@/model/position";
import { labelGuides, planLabel, type PlacedBarcode, type PlacedImage, type PlacedPaths } from "@/plan";
import { minModuleWarning } from "@/model/fields";
import { qrShapes, qrPath } from "@/qr";

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
    cfg.collabEnabled = true;
    const t = dragTarget2(cfg, { left: false, center: false }, "logo");
    expect(t?.kind).toBe("offsetY");
    if (t?.kind !== "offsetY") throw new Error("expected offsetY form");
    expect(t.get()).toBe(cfg.logo.offsetY ?? 0);
  });

  it("returns null for logo when collab is off, same as the legacy dragTarget", () => {
    const cfg = defaultConfig();
    expect(dragTarget2(cfg, { left: false, center: false }, "logo")).toBeNull();
  });

  it("returns null for a locked logo even with collab on", () => {
    const cfg = defaultConfig();
    cfg.collabEnabled = true;
    cfg.logo.locked = true;
    expect(dragTarget2(cfg, { left: false, center: false }, "logo")).toBeNull();
  });

  it("keeps the offsetY form for logo when unlocked, same as before", () => {
    const cfg = defaultConfig();
    cfg.collabEnabled = true;
    const t = dragTarget2(cfg, { left: false, center: false }, "logo");
    expect(t?.kind).toBe("offsetY");
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
});

describe("no custom layers -> byte-identical pre-feature plan", () => {
  it("matches a plan built with customLayers entirely absent", () => {
    const cfgAbsent = defaultConfig();
    const cfgEmpty = defaultConfig();
    cfgEmpty.customLayers = [];
    expect(planLabel(cfgEmpty, m)).toEqual(planLabel(cfgAbsent, m));
  });
});

describe("minModuleWarning (P4)", () => {
  it("fires under 0.72pt and stays quiet at 1pt", () => {
    expect(minModuleWarning("code-128", 0.5)).toMatch(/module/i);
    expect(minModuleWarning("code-128", 1)).toBeNull();
  });
});
