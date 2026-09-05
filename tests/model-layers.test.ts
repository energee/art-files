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
