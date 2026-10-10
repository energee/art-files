import { describe, expect, it } from "vitest";
import { parseMaster } from "../src/model/layers";
import { lolevMaster } from "../src/model/lolevLayers";

describe("v3 master model", () => {
  it("the Lolev master parses", () => {
    expect(() => parseMaster(lolevMaster())).not.toThrow();
  });
  it("every Lolev element is a layer, background and mask at the bottom", () => {
    const ids = lolevMaster().layers.map((l) => l.id);
    expect(ids.slice(0, 2)).toEqual(["background", "mask"]);
    for (const id of ["volume", "abv", "description", "wordmark", "logo", "name", "styleLine",
      "handleAddress", "warning", "storeCold", "qr", "barcode"]) expect(ids).toContain(id);
  });
  it("collab is a variant diff that adds three bound layers", () => {
    const v = lolevMaster().variants[0];
    expect(Object.keys(v.layers)).toEqual(["collabLead", "collabLeft", "collabCenter"]);
    expect(v.layers.collabLeft!.y).toEqual({ below: "collabLead", gap: 8 - 0.35 * 9 });
  });
  it("rejects a cyclic binding", () => {
    const m = lolevMaster();
    (m.layers.find((l) => l.id === "abv")! as { y: unknown }).y = { below: "volume", gap: 0 };
    (m.layers.find((l) => l.id === "volume")! as { y: unknown }).y = { below: "abv", gap: 0 };
    expect(() => parseMaster(m)).toThrow(/cyclic/);
  });
  it("rejects a binding to a missing layer, in a variant too", () => {
    const m = lolevMaster();
    (m.variants[0].layers.collabCenter as { y: unknown }).y = { below: "nope", gap: 0 };
    expect(() => parseMaster(m)).toThrow(/missing layer "nope"/);
  });
  it("rejects an incomplete variant-added layer", () => {
    const m = lolevMaster();
    m.variants[0].layers.extra = { name: "Extra" };
    expect(() => parseMaster(m)).toThrow(/unknown kind/);
  });
  it("rejects enabled layers bound below disabled targets", () => {
    const m = lolevMaster();
    m.layers.find((l) => l.id === "description")!.enabled = false;
    expect(() => parseMaster(m)).toThrow(/disabled layer "description"/);
  });
  it("validates variant overrides as complete resolved layers", () => {
    const m = lolevMaster();
    Object.assign(m.variants[0].layers, { logo: { y: { gap: 2 } } });
    expect(() => parseMaster(m)).toThrow(/invalid y/);
    m.variants[0].layers.logo = { kind: "text" };
    expect(() => parseMaster(m)).toThrow(/missing lines/);
  });

});

it("round-trips guide anchors and rejects simultaneous guide/layer binding", () => {
  const m = lolevMaster();
  m.layers[2] = { ...m.layers[2], guideY: "middle", y: -6 };
  expect(parseMaster(JSON.parse(JSON.stringify(m))).layers[2]).toMatchObject({ guideY: "middle", y: -6 });
  m.layers[2].y = { below: "description", gap: 0 };
  expect(() => parseMaster(m)).toThrow(/both a guide and a layer/);
});

it("validates mixed-axis binding chains, references and persistence", () => {
  const m = lolevMaster();
  const a = m.layers.find((l) => l.id === "name")!;
  const b = m.layers.find((l) => l.id === "volume")!;
  a.binding = { to: b.id, side: "right", gap: 8 };
  expect(parseMaster(JSON.parse(JSON.stringify(m))).layers.find((l) => l.id === a.id)!.binding).toEqual(a.binding);
  b.binding = { to: a.id, side: "top", gap: 0 };
  expect(() => parseMaster(m)).toThrow(/cyclic/);
  b.binding = null;
  a.binding.to = "missing";
  expect(() => parseMaster(m)).toThrow(/missing layer/);
  a.binding = { to: b.id, side: "right", gap: NaN };
  expect(() => parseMaster(m)).toThrow(/invalid binding/);
});

// docs/plans/choice-input.md, Task 1. `choices` is not an input MODE — it is a
// key any fillable layer may carry, because the barcode case needs a list AND
// `code` validation at once. It lives on LayerBase so the barcode kind, which
// has its own `value` rather than an `input`, gets it too.
describe("choices", () => {
  const withLayer = (patch: Record<string, unknown>, id = "styleLine") => {
    const m = lolevMaster();
    return { ...m, layers: m.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) };
  };
  const styles = [
    { value: "Ultra Hopped Ale" },
    { title: "Hazy IPA", value: "Hazy India Pale Ale" },
  ];

  it("round-trips a vocabulary and a title", () => {
    const m = withLayer({ choices: styles, title: "Style" });
    const back = parseMaster(JSON.parse(JSON.stringify(m)));
    const layer = back.layers.find((l) => l.id === "styleLine") as
      { choices?: unknown; title?: string };
    expect(layer.choices).toEqual(styles);
    expect(layer.title).toBe("Style");
  });

  it("rides on a barcode layer, which has a value rather than an input", () => {
    const m = withLayer({ choices: [{ title: "Tier 1", value: "850051366040" }] }, "barcode");
    expect(() => parseMaster(JSON.parse(JSON.stringify(m)))).not.toThrow();
  });

  it("names the layer when a choice has no value to draw", () => {
    expect(() => parseMaster(withLayer({ choices: [{ title: "Tier 1" }] })))
      .toThrow(/styleLine.*choice/i);
    expect(() => parseMaster(withLayer({ choices: [{ value: "  " }] })))
      .toThrow(/styleLine.*choice/i);
    expect(() => parseMaster(withLayer({ choices: "IPA" })))
      .toThrow(/styleLine.*choices/i);
  });

  it("drops an empty list, so absent and [] are one state", () => {
    const back = parseMaster(withLayer({ choices: [] }));
    expect(back.layers.find((l) => l.id === "styleLine")).not.toHaveProperty("choices");
  });
});

describe("style colours", () => {
  const withStyle = (style: Record<string, unknown>) => {
    const m = lolevMaster();
    return { ...m, layers: m.layers.map((l) => (l.id === "name" ? { ...l, style: { ...l.style, ...style } } : l)) };
  };
  it("widens a 3-digit hex fill and stroke on read", () => {
    const name = parseMaster(withStyle({ fill: "#FFF", stroke: "#000" })).layers.find((l) => l.id === "name")!;
    expect(name.style).toMatchObject({ fill: "#ffffff", stroke: "#000000" });
  });
  it("names the layer and the colour it cannot print", () => {
    expect(() => parseMaster(withStyle({ fill: "gold" }))).toThrow(/layer "name".*fill "gold"/);
    expect(() => parseMaster(withStyle({ stroke: "red" }))).toThrow(/stroke "red"/);
    expect(() => parseMaster(withStyle({ layer: "silver" }))).toThrow(/layer "silver"/);
  });
  it("accepts \"none\" for fill and stroke", () => {
    expect(() => parseMaster(withStyle({ fill: "none", stroke: "none" }))).not.toThrow();
  });
});
