// app-asset-reference.test.ts — pins assetStillReferenced (src/App.tsx),
// the guard finding #16's fix relies on before releasing a field image's
// previous asset id. This repo's convention is to exercise App.tsx's pure
// logic directly rather than mount App itself (see app-commit-rebind.test.ts/
// app-layer-doc.test.ts's own header for the same call).
// @vitest-environment happy-dom
// happy-dom, not node: importing App.tsx pulls in components (ColorField)
// that read `window` at module scope.
import { describe, expect, it } from "vitest";
import { assetStillReferenced } from "../src/App";
import { defaultConfig } from "../src/defaults";
import { lolevMaster } from "../src/model/lolev";
import type { CustomImageLayer } from "../src/types";

describe("assetStillReferenced", () => {
  it("is false for an asset id nothing in cfg points to", () => {
    const cfg = defaultConfig();
    expect(assetStillReferenced(lolevMaster(), cfg, "custom-asset-orphan")).toBe(false);
  });

  it("is true while an image field still holds the asset id", () => {
    const cfg = defaultConfig();
    (cfg.collabLeft as { image?: string }).image = "custom-asset-1";
    expect(assetStillReferenced(lolevMaster(), cfg, "custom-asset-1")).toBe(true);
  });

  // The exact case finding #16's fix depends on: the field about to be
  // overwritten still holds the OLD id in cfg at release time (the write
  // happens after the check), so without excluding its own path every
  // replace would read as "still referenced by itself" and nothing would
  // ever release.
  it("excludePath ignores the field's own (about-to-be-overwritten) path", () => {
    const cfg = defaultConfig();
    (cfg.collabLeft as { image?: string }).image = "custom-asset-1";
    expect(assetStillReferenced(lolevMaster(), cfg, "custom-asset-1", "collabLeft.image"))
      .toBe(false);
  });

  // The case the fix must NOT break: the same asset shared by a second
  // field (a partner's logo dropped into both collab slots) must survive —
  // releasing it here would corrupt the still-live reference.
  it("stays true when a DIFFERENT field shares the same asset id", () => {
    const cfg = defaultConfig();
    (cfg.collabLeft as { image?: string }).image = "custom-asset-1";
    (cfg.collabCenter as { image?: string }).image = "custom-asset-1";
    expect(assetStillReferenced(lolevMaster(), cfg, "custom-asset-1", "collabLeft.image"))
      .toBe(true);
  });

  it("is true when a custom image layer's asset matches, even excluding a field path", () => {
    const cfg = defaultConfig();
    const layer: CustomImageLayer = {
      id: "custom-a", name: "Logo", type: "image", asset: "custom-asset-1",
      w: 60, position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
      style: { fill: "none", layer: "white" },
    };
    cfg.customLayers = [layer];
    expect(assetStillReferenced(lolevMaster(), cfg, "custom-asset-1", "collabLeft.image"))
      .toBe(true);
  });
});
