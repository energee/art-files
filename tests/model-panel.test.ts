import { describe, expect, it } from "vitest";
import { panelRows } from "../src/model/panel";
import { composeConfig } from "../src/model/document";
import { lolevMaster } from "../src/model/lolev";

const rowsFor = (enabled: string[]) => {
  const m = lolevMaster();
  const r = composeConfig(m, enabled, {}, undefined);
  return panelRows(m, r.layers, r.disabledLayers, r.config);
};

describe("panelRows", () => {
  it("lists master layers flat, front to back (reverse draw order)", () => {
    expect(rowsFor([]).map((r) => r.id).slice(0, 3)).toEqual(["barcode", "qr", "storeCold"]);
  });
  it("marks collab rows inactive and badged while the variant is off", () => {
    const lead = rowsFor([]).find((r) => r.id === "collabLead")!;
    expect(lead.inactive).toBe(true);
    expect(lead.variantName).toBe("Collab");
    expect(rowsFor(["collab"]).find((r) => r.id === "collabLead")!.inactive).toBe(false);
  });
  it("lists custom layers first, flagged and never inactive (they're always frontmost)", () => {
    const m = lolevMaster();
    const r = composeConfig(m, [], {}, undefined);
    const cfg = structuredClone(r.config);
    cfg.customLayers = [{
      id: "custom-a", name: "Note", type: "text", size: 10,
      position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
      line: { text: "hi", fill: "#000000", layer: "white" },
    }];
    const rows = panelRows(m, r.layers, r.disabledLayers, cfg);
    expect(rows[0]).toMatchObject({ id: "custom-a", name: "Note", custom: true, inactive: false });
  });
  it("reports the master's lock on a row", () => {
    const m = lolevMaster();
    const r = composeConfig(m, [], {}, undefined);
    expect(panelRows(m, r.layers, r.disabledLayers, r.config)
      .find((x) => x.id === "warning")!.locked).toBe(true);
  });
});
