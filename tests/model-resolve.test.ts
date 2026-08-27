import { describe, expect, it } from "vitest";
import { resolve } from "../src/model/resolve";
import type { Master } from "../src/model/types";

const master: Master = {
  formatVersion: 1, id: "m1", name: "Test",
  physical: { labelWidthIn: 8.125, labelHeightIn: 3.625, bleedIn: 0.125, canDiameterIn: 2.6 },
  defaults: { beerName: "DEFAULT", abv: "5" },
  guides: { left: 24.12, center: "auto", right: 24.12, top: 24.12, bottom: 24.12 },
  fields: [
    { id: "name", label: "Beer name", kind: "text", path: "beerName" },
    { id: "abv", label: "ABV", kind: "number", path: "abv", min: 0, max: 20 },
    { id: "style", label: "Style", kind: "text", path: "styleLine.text" },
  ],
  variations: [
    { id: "collab", name: "Collab", overrides: { collabEnabled: true }, layerOverrides: {},
      fields: [{ id: "partner", label: "Partner logo", kind: "image", path: "collabLeft.asset" }] },
    { id: "loud", name: "Loud", overrides: { abv: "9" }, layerOverrides: {}, fields: [] },
  ],
};

describe("resolve", () => {
  it("starts from defaults", () => {
    const r = resolve(master, [], {});
    expect(r.config.beerName).toBe("DEFAULT");
    expect(r.config.collabEnabled).toBe(false);   // defaultConfig()'s value
  });
  it("applies enabled variations in order, last wins", () => {
    expect(resolve(master, ["collab"], {}).config.collabEnabled).toBe(true);
    expect(resolve(master, ["loud"], {}).config.abv).toBe("9");
  });
  it("exposes variation fields only when enabled", () => {
    expect(resolve(master, [], {}).visibleFields.map((f) => f.id)).not.toContain("partner");
    expect(resolve(master, ["collab"], {}).visibleFields.map((f) => f.id)).toContain("partner");
  });
  it("applies valid values via dot paths", () => {
    const r = resolve(master, [], { name: "HAZY", style: "India Pale Ale" });
    expect(r.config.beerName).toBe("HAZY");
    expect(r.config.styleLine.text).toBe("India Pale Ale");
  });
  it("rejects invalid values into errors, keeping the prior value", () => {
    const r = resolve(master, [], { abv: "99" });
    expect(r.errors.abv).toMatch(/20/);
    expect(r.config.abv).toBe("5");
  });
  it("ignores dormant values for disabled variations", () => {
    const r = resolve(master, [], { partner: "x.png" });
    expect(r.errors.partner).toBeUndefined();   // dormant, not an error
  });
  it("warns on unknown variation ids", () => {
    expect(resolve(master, ["nope"], {}).warnings.join(" ")).toMatch(/nope/);
  });
  it("expands a field's format string", () => {
    const m: Master = { ...master, fields: [...master.fields,
      { id: "qr", label: "QR", kind: "text", path: "qrPayload", format: "https://x.co/{name|slug}" }] };
    const r = resolve(m, [], { name: "Hazy IPA" });
    expect((r.config as unknown as Record<string, unknown>).qrPayload).toBe("https://x.co/hazy-ipa");
  });
});
