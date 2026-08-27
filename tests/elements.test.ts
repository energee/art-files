import { describe, expect, it } from "vitest";
import {
  ELEMENTS, applyStyle, customElement, dragTarget, editableText, elementById, isDefaultStyle,
} from "../src/elements";
import { defaultConfig } from "../src/defaults";
import { GOLD } from "../src/layout";
import type {
  CustomBarcodeLayer, CustomImageLayer, CustomQrLayer, CustomTextLayer,
} from "../src/types";

describe("element registry", () => {
  it("covers every stylable element exactly once", () => {
    const ids = ELEMENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("name");
    expect(ids).toContain("storeCold");
    expect(ids).toContain("qr");
    expect(ids).toContain("barcode");
  });

  it("splits per-beer fields from set-once template fields", () => {
    const g = (id: string) => ELEMENTS.find((e) => e.id === id)!.group;
    expect(g("name")).toBe("beer");
    expect(g("styleLine")).toBe("beer");
    // Both codes change per release (QR payload follows the name, UPC digits
    // are per-beer), so neither belongs behind the brand-template disclosure.
    expect(g("qr")).toBe("beer");
    expect(g("barcode")).toBe("beer");
    expect(g("wordmark")).toBe("template");
    expect(g("storeCold")).toBe("template");
  });

  it("reads each element's live style out of the config", () => {
    const cfg = defaultConfig();
    cfg.nameStyle.fill = "#123456";
    expect(elementById("name").style(cfg).fill).toBe("#123456");
    cfg.qrFill = "#654321";
    cfg.qrLayer = "white";
    expect(elementById("qr").style(cfg).fill).toBe("#654321");
    expect(elementById("qr").style(cfg).layer).toBe("white");
    cfg.barcodeFill = "#222222";
    cfg.barcodeStroke = "#EEEEEE";
    cfg.barcodeStrokeLayer = "metallic";
    cfg.barcodeStrokeWidth = 22;
    const bc = elementById("barcode").style(cfg);
    expect(bc).toEqual({
      fill: "#222222", layer: "white", stroke: "#EEEEEE",
      strokeLayer: "metallic", strokeWidth: 22,
    });
  });

  it("writes back through applyStyle, including the flat QR fields", () => {
    const cfg = defaultConfig();
    applyStyle(cfg, "name", { fill: "#ABCDEF" });
    expect(cfg.nameStyle.fill).toBe("#ABCDEF");
    applyStyle(cfg, "qr", {
      fill: "#112233", layer: "white", strokeLayer: "metallic",
    });
    expect(cfg.qrFill).toBe("#112233");
    expect(cfg.qrLayer).toBe("white");
    expect(cfg.qrStrokeLayer).toBe("metallic");
  });

  it("routes every barcode field to its own flat config key, never the QR's", () => {
    const cfg = defaultConfig();
    const qrBefore = { ...elementById("qr").style(cfg) };
    applyStyle(cfg, "barcode", {
      fill: "#445566", layer: "metallic", stroke: "#778899",
      strokeLayer: "metallic", strokeWidth: 31,
    });
    expect(cfg.barcodeFill).toBe("#445566");
    expect(cfg.barcodeLayer).toBe("metallic");
    expect(cfg.barcodeStroke).toBe("#778899");
    expect(cfg.barcodeStrokeLayer).toBe("metallic");
    expect(cfg.barcodeStrokeWidth).toBe(31);
    // The two flat elements share one write path; this is the check that it
    // never crosses the wires between them.
    expect(elementById("qr").style(cfg)).toEqual(qrBefore);
  });

  it("recognises a gold element's default so deviations can be marked", () => {
    // The beer name ships gold/metallic over the black keyline every text
    // element in the left column now carries.
    const shipped = {
      fill: GOLD, layer: "metallic", stroke: "#000000",
      strokeLayer: "white", strokeWidth: 15,
    } as const;
    expect(isDefaultStyle("name", shipped)).toBe(true);
    expect(isDefaultStyle("name", { ...shipped, fill: "#FF0000" })).toBe(false);
    expect(isDefaultStyle("name", { ...shipped, layer: "white" })).toBe(false);
    expect(isDefaultStyle("name", { ...shipped, stroke: "#FFFFFF" })).toBe(false);
    expect(isDefaultStyle("name", { ...shipped, strokeLayer: "metallic" })).toBe(false);
    // Dropping the shipped keyline is a deviation, whether spelled as an
    // explicit "none" or by leaving the field out — the renderers read those
    // two the same way.
    expect(isDefaultStyle("name", { ...shipped, stroke: "none" })).toBe(false);
    expect(isDefaultStyle("name", { fill: GOLD, layer: "metallic" })).toBe(false);
  });

  // Regression: isDefaultStyle used to hardcode gold/metallic/no-stroke, so
  // every element that SHIPS off-gold read as permanently deviating, and
  // restyling the barcode to gold/metallic/no-stroke — the unscannable state
  // — read as "default", hiding the Reset that undoes it.
  it("treats every element's own shipped style as its default", () => {
    const cfg = defaultConfig();
    for (const e of ELEMENTS) {
      expect([e.id, isDefaultStyle(e.id, e.style(cfg))]).toEqual([e.id, true]);
    }
  });

  it("ships every element stroke on white/non-metallic", () => {
    const cfg = defaultConfig();
    for (const e of ELEMENTS)
      expect([e.id, e.style(cfg).strokeLayer]).toEqual([e.id, "white"]);
  });

  it("flags a gold/metallic barcode as a deviation, not as the default", () => {
    const cfg = defaultConfig();
    applyStyle(cfg, "barcode", { fill: GOLD, layer: "metallic", stroke: "none" });
    expect(isDefaultStyle("barcode", elementById("barcode").style(cfg))).toBe(false);
  });

  it("counts stroke layer, strokeWidth and bold, which Reset also restores", () => {
    const cfg = defaultConfig();
    applyStyle(cfg, "barcode", { strokeLayer: "metallic" });
    expect(isDefaultStyle("barcode", elementById("barcode").style(cfg))).toBe(false);
    applyStyle(cfg, "barcode", { strokeLayer: "white" });
    applyStyle(cfg, "barcode", { strokeWidth: 31 });
    expect(isDefaultStyle("barcode", elementById("barcode").style(cfg))).toBe(false);
    const cfg2 = defaultConfig();
    applyStyle(cfg2, "storeCold", { bold: false }); // ships bold: true
    expect(isDefaultStyle("storeCold", elementById("storeCold").style(cfg2))).toBe(false);
  });

  it("marks 'no ink' as illegal for both codes and nothing else", () => {
    for (const e of ELEMENTS) {
      expect(e.allowNone).toBe(e.id !== "qr" && e.id !== "barcode");
    }
  });

  it("clears a stale qrStrokeWidth when a patch explicitly carries strokeWidth: undefined (Reset path)", () => {
    const cfg = defaultConfig();
    applyStyle(cfg, "qr", { stroke: "#000000", strokeWidth: 40 });
    expect(cfg.qrStrokeWidth).toBe(40);
    // This is exactly the shape StyleProperties' reset() sends: every field
    // present, strokeWidth explicitly undefined because the shipped qr
    // default has no width. The "key absent" case (a plain `{ fill }`
    // patch from e.g. the Fill swatch) must NOT clear it — only a patch
    // that actually carries the key should.
    applyStyle(cfg, "qr", { fill: GOLD, layer: "metallic", stroke: "none", strokeWidth: undefined });
    expect(cfg.qrStrokeWidth).toBeUndefined();
    applyStyle(cfg, "qr", { fill: "#654321" });
    expect(cfg.qrStrokeWidth).toBeUndefined();
  });

  // An UNSET barcode strokeWidth is not cosmetic: it is what keeps a
  // migrated pre-style config's halo at L.BARCODE.stroke, the width measured
  // off the finished labels (drawBarcode). applyStyle must be able to both
  // hold a real width and clear one on an explicit undefined.
  it("clears a stale barcodeStrokeWidth on an explicit strokeWidth: undefined, and keeps it otherwise", () => {
    const cfg = defaultConfig();
    expect(cfg.barcodeStrokeWidth).toBe(20); // shipped default
    applyStyle(cfg, "barcode", { strokeWidth: 40 });
    expect(cfg.barcodeStrokeWidth).toBe(40);
    // Teeth: a patch with the key ABSENT must leave a real width alone. The
    // QR version of this test only checks that against an already-undefined
    // width, so it cannot fail — assert survival of a set value instead.
    applyStyle(cfg, "barcode", { fill: "#654321" });
    expect(cfg.barcodeStrokeWidth).toBe(40);
    // An explicit strokeWidth: undefined clears the key entirely (back to
    // the migrated-config fallback), rather than being silently ignored.
    applyStyle(cfg, "barcode", {
      fill: "#1A1A1A", layer: "white", stroke: "#FFFFFF", strokeWidth: undefined,
    });
    expect(cfg.barcodeStrokeWidth).toBeUndefined();
  });

  it("drops a bold patch for elements without hasBold, even though the type allows it", () => {
    const cfg = defaultConfig();
    applyStyle(cfg, "logo", { fill: "#111111", bold: true });
    expect(cfg.logo.fill).toBe("#111111");
    expect("bold" in cfg.logo).toBe(false);
    // The barcode's digits are drawn in one fixed face, so a stray bold must
    // not survive onto its flat config either.
    applyStyle(cfg, "barcode", { fill: "#222222", bold: true });
    expect(cfg.barcodeFill).toBe("#222222");
    expect("barcodeBold" in cfg).toBe(false);
    expect("bold" in cfg).toBe(false);
  });

  it("still writes bold for elements that have it", () => {
    const cfg = defaultConfig();
    expect(cfg.storeCold.bold).toBe(true);
    applyStyle(cfg, "storeCold", { bold: false });
    expect(cfg.storeCold.bold).toBe(false);
  });
});

describe("inline editable text", () => {
  it("round-trips every editable element's text through the config", () => {
    const cfg = defaultConfig();
    for (const [id, spec] of Object.entries(editableText)) {
      // editableText's index type now includes ElementId's `custom-${string}`
      // arm, which TS treats as an index signature (value type T | undefined)
      // rather than a finite set of known-present keys — but the entries
      // actually iterated here are only the fixed keys the object literal
      // defines, so they are always present.
      spec!.set(cfg, `edited ${id}`);
      expect(spec!.get(cfg)).toBe(`edited ${id}`);
    }
    // The accessors hit the real backing fields, flat and styled alike.
    expect(cfg.beerName).toBe("edited name");
    expect(cfg.abv).toBe("edited abv");
    expect(cfg.styleLine.text).toBe("edited styleLine");
    expect(cfg.volume.text).toBe("edited volume");
  });

  it("marks the ABV numeric-only, so its drawn unit text stays uneditable", () => {
    expect(editableText.abv?.numeric).toBe(true);
  });
});

describe("dragTarget", () => {
  it("logo drags only while collab is on (offsetY is ignored otherwise)", () => {
    const cfg = defaultConfig();
    const slots = { left: false, center: false };
    cfg.collabEnabled = false;
    expect(dragTarget(cfg, slots, "logo")).toBeNull();
    cfg.collabEnabled = true;
    const t = dragTarget(cfg, slots, "logo")!;
    expect(t.get()).toBe(cfg.logo.offsetY ?? 0);
    const next = structuredClone(cfg);
    t.set(next, 12.5);
    expect(next.logo.offsetY).toBe(12.5);
  });

  it("collab slots drag only when their art is loaded", () => {
    const cfg = defaultConfig();
    cfg.collabEnabled = true;
    expect(dragTarget(cfg, { left: false, center: false }, "collabLeft")).toBeNull();
    const t = dragTarget(cfg, { left: true, center: false }, "collabLeft")!;
    const next = structuredClone(cfg);
    t.set(next, -3);
    expect(next.collabLeft.offsetY).toBe(-3);
  });

  it("everything else is not draggable", () => {
    const cfg = defaultConfig();
    cfg.collabEnabled = true;
    for (const id of ["name", "description", "barcode", "qr", "warning"] as const)
      expect(dragTarget(cfg, { left: true, center: true }, id)).toBeNull();
  });

  it("writes a custom text layer's style patch into its own cfg entry, not a shared object", () => {
    const cfg = defaultConfig();
    const pos = { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 } as const;
    const layerA: CustomTextLayer = {
      id: "custom-a", name: "A", type: "text", size: 10, position: pos,
      line: { text: "hello", fill: "none", layer: "white" },
    };
    const layerB: CustomTextLayer = {
      id: "custom-b", name: "B", type: "text", size: 10, position: pos,
      line: { text: "world", fill: "none", layer: "white" },
    };
    cfg.customLayers = [layerA, layerB];

    applyStyle(cfg, "custom-a", { fill: "#ABCDEF" });

    expect(layerA.line.fill).toBe("#ABCDEF");
    // The second custom layer must be untouched — a shared BLANK_STYLE
    // singleton would have leaked the write onto it too.
    expect(layerB.line.fill).toBe("none");
    // A fresh elementById().style() call for either id must still read as
    // the untouched placeholder, not reflect the patch above.
    expect(elementById("custom-a").style(cfg)).toEqual({ fill: "none", layer: "white" });
  });
});

describe("customElement", () => {
  const pos = { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 } as const;

  it("labels a custom row with the layer's own name", () => {
    const cfg = defaultConfig();
    const textLayer: CustomTextLayer = {
      id: "custom-t1", name: "Tagline", type: "text", size: 12, position: pos,
      line: { text: "hi", fill: "none", layer: "white" },
    };
    cfg.customLayers = [textLayer];
    expect(customElement(cfg, "custom-t1").label).toBe("Tagline");
  });

  it("gives a custom text layer bold + tracking capability, images neither", () => {
    const cfg = defaultConfig();
    const textLayer: CustomTextLayer = {
      id: "custom-t1", name: "Tagline", type: "text", size: 12, position: pos,
      line: { text: "hi", fill: "none", layer: "white" },
    };
    const imageLayer: CustomImageLayer = {
      id: "custom-i1", name: "Art", type: "image", asset: "a1", w: 40, position: pos,
      style: { fill: "none", layer: "white" },
    };
    cfg.customLayers = [textLayer, imageLayer];
    const text = customElement(cfg, "custom-t1");
    expect(text.hasBold).toBe(true);
    expect(text.isText).toBe(true);
    expect(text.allowNone).toBe(true);
    const image = customElement(cfg, "custom-i1");
    expect(image.hasBold).toBe(false);
    expect(image.isText).toBe(false);
    expect(image.allowNone).toBe(true);
  });

  it("forbids no-ink on custom barcode/QR layers, same as the fixed codes", () => {
    const cfg = defaultConfig();
    const barcodeLayer: CustomBarcodeLayer = {
      id: "custom-b1", name: "Code", type: "barcode", symbology: "code-128",
      value: "X", h: 30, moduleW: 1, position: pos, style: { fill: "#000000", layer: "white" },
    };
    const qrLayer: CustomQrLayer = {
      id: "custom-q1", name: "QR", type: "qr", value: "x", size: 40, qrStyle: "square",
      position: pos, style: { fill: "#000000", layer: "white" },
    };
    cfg.customLayers = [barcodeLayer, qrLayer];
    expect(customElement(cfg, "custom-b1").allowNone).toBe(false);
    expect(customElement(cfg, "custom-q1").allowNone).toBe(false);
  });

  // Regression: applyStyle used to strip bold/tracking for EVERY custom id
  // (elementById's customFallback always reports hasBold/isText false), so a
  // custom text layer could never actually be made bold or tracked.
  it("applyStyle lands bold + tracking on a custom TEXT layer", () => {
    const cfg = defaultConfig();
    const textLayer: CustomTextLayer = {
      id: "custom-t1", name: "Tagline", type: "text", size: 12, position: pos,
      line: { text: "hi", fill: "none", layer: "white" },
    };
    cfg.customLayers = [textLayer];
    applyStyle(cfg, "custom-t1", { bold: true, letterSpacing: 1 });
    expect(textLayer.line.bold).toBe(true);
    expect(textLayer.line.letterSpacing).toBe(1);
  });

  it("applyStyle drops bold + tracking on a custom IMAGE layer", () => {
    const cfg = defaultConfig();
    const imageLayer: CustomImageLayer = {
      id: "custom-i1", name: "Art", type: "image", asset: "a1", w: 40, position: pos,
      style: { fill: "none", layer: "white" },
    };
    cfg.customLayers = [imageLayer];
    applyStyle(cfg, "custom-i1", { bold: true, letterSpacing: 1, fill: "#123456" });
    expect(imageLayer.style.fill).toBe("#123456");
    expect("bold" in imageLayer.style).toBe(false);
    expect("letterSpacing" in imageLayer.style).toBe(false);
  });
});
