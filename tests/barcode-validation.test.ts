// barcode-validation.test.ts — issue #94: a barcode is validated on the value
// the renderer will actually draw (post-expansion), whichever tier supplied
// it, so an invalid code that reached the master (learned or promoted) still
// blocks export instead of silently vanishing from the PDF.
import { describe, expect, it } from "vitest";
import { applyPromotions, learnChoice, masterChanges, setContentIn } from "../src/model/edit";
import { lolevMaster } from "../src/model/lolevLayers";
import { resolveLayers } from "../src/model/resolveLayers";
import type { BarcodeLayer, LabelFile, Layer, Master, TextLine } from "../src/model/layers";
import { GOLD } from "../src/layout";

const line = (text: string): TextLine => ({ text, fill: GOLD, layer: "metallic" });
const newLabel = (master: Master): LabelFile =>
  ({ formatVersion: 3, masterId: master.id, enabledVariants: [], values: {} });
const barcodeOf = (layers: Layer[]) => layers.find((l) => l.id === "barcode") as BarcodeLayer;
const withBarcode = (value: string, enabled = true): Master => {
  const m = lolevMaster();
  Object.assign(barcodeOf(m.layers), { value, enabled });
  return m;
};

describe("barcode validation (#94)", () => {
  it("an invalid code promoted into the master is still an error", () => {
    const base = lolevMaster();
    const doc = setContentIn({ master: base, label: newLabel(base) }, "barcode", "12345");
    expect(resolveLayers(doc.master, [], doc.label.values).errors.barcode).toBeTruthy();
    const promote = masterChanges(base, doc.master, doc.label)
      .filter((c) => c.kind === "promote" && c.layerId === "barcode");
    expect(promote.length).toBe(1);
    const r = applyPromotions(doc.master, doc.label, promote);
    expect(barcodeOf(r.master.layers).value).toBe("12345");
    expect(resolveLayers(r.master, [], r.label.values).errors.barcode).toMatch(/UPC-A/);
  });

  it("an invalid master value is an error with no label value at all", () => {
    expect(resolveLayers(withBarcode("036000291453"), [], {}).errors.barcode).toBeTruthy();
  });

  it("a master template expanding to garbage is an error", () => {
    const r = resolveLayers(withBarcode("{name}"), [], { name: [line("Peregrine")] });
    expect(r.errors.barcode).toBeTruthy();
  });

  it("a label template expanding to a valid UPC is not an error", () => {
    const r = resolveLayers(lolevMaster(), [], { name: [line("036000291452")], barcode: "{name}" });
    expect(r.errors.barcode).toBeUndefined();
    expect(barcodeOf(r.layers).value).toBe("036000291452");
  });

  it("a blank or switched-off barcode draws nothing and blocks nothing", () => {
    expect(resolveLayers(withBarcode(""), [], {}).errors.barcode).toBeUndefined();
    expect(resolveLayers(withBarcode("garbage", false), [], {}).errors.barcode).toBeUndefined();
  });

  it("learnChoice does not teach a barcode an invalid code", () => {
    const m = lolevMaster();
    expect(learnChoice(m, "barcode", "12345")).toBe(m);
    expect(learnChoice(m, "barcode", "036000291452")).not.toBe(m);
  });
});
