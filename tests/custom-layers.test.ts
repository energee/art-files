// custom-layers.test.ts — schema for the master-variation custom layers:
// CustomLayer (text/image) survives a JSON round-trip, and isCustomId
// distinguishes custom layer ids from the fixed ElementId set.
import { describe, expect, it } from "vitest";
import type { CustomLayer, CustomTextLayer } from "@/types";
import { defaultConfig } from "@/defaults";
import { isCustomId } from "@/elements";

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
