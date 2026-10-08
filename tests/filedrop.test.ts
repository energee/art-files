// filedrop.test.ts — global asset routing and the Tauri DOM-drop boundary.
import { describe, expect, it } from "vitest";
import { globalAssetKind } from "../src/components/AssetDropOverlay";
import { mimeFor } from "../src/collab";
import tauri from "../src-tauri/tauri.conf.json";

describe("global asset drops", () => {
  it("routes PNGs by viewport half and JPEGs to the texture", () => {
    expect(globalAssetKind({ name: "rock.png", type: "image/png" }, 100, 1000)).toBe("texture");
    expect(globalAssetKind({ name: "foil.png", type: "image/png" }, 900, 1000)).toBe("mask");
    expect(globalAssetKind({ name: "rock.jpg", type: "image/jpeg" }, 900, 1000)).toBe("texture");
  });

  it("recognizes image extensions when the OS omits a MIME type", () => {
    expect(globalAssetKind({ name: "FOIL.PNG", type: "" }, 900, 1000)).toBe("mask");
    expect(globalAssetKind({ name: "rock.webp", type: "" }, 100, 1000)).toBe("texture");
    expect(globalAssetKind({ name: "logo.svg", type: "image/svg+xml" }, 100, 1000)).toBeNull();
  });

  it("routes a WebP by viewport half, like a PNG", () => {
    expect(globalAssetKind({ name: "rock.webp", type: "image/webp" }, 100, 1000)).toBe("texture");
    expect(globalAssetKind({ name: "foil.webp", type: "image/webp" }, 900, 1000)).toBe("mask");
  });
});

describe("Tauri file-drop integration", () => {
  it("leaves DOM drag events enabled for the React drop targets", () => {
    expect(tauri.app.windows[0].dragDropEnabled).toBe(false);
  });
});

describe("mimeFor", () => {
  it("names WebP as WebP, so a reopened .webp asset decodes as one", () => {
    expect(mimeFor("rock.webp")).toBe("image/webp");
    expect(mimeFor("rock.png")).toBe("image/png");
  });
});
