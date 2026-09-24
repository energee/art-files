// filedrop-dom.test.tsx — AssetDropOverlay's window drag/drop listeners:
// claimed images route to texture/mask, unclaimed files are left alone (the
// #121 navigation guard lives in TabsShell — tabsshell-drop-dom.test.tsx),
// and field drops yield to the field. No @testing-library/react in this repo —
// mounted through react-dom/client + act, matching tests/rulers-dom.test.tsx.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetDropOverlay } from "../src/components/AssetDropOverlay";
import { FILE_DROP_ATTR } from "../src/components/FileDrop";
import { fieldWell, fileDrag, label, pdf, png } from "./dom-drag";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onTexture = vi.fn();
const onMask = vi.fn();

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(createElement(AssetDropOverlay, { onTexture, onMask })); });
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  onTexture.mockReset();
  onMask.mockReset();
});

describe("AssetDropOverlay window drops", () => {
  it("does not route or arm for unclaimed file types", () => {
    for (const f of [pdf, label]) {
      fileDrag("dragover", f);
      fileDrag("drop", f);
    }
    expect(onTexture).not.toHaveBeenCalled();
    expect(onMask).not.toHaveBeenCalled();
    expect(document.querySelector(".fixed")).toBeNull();
  });

  it("routes a claimed image", () => {
    expect(fileDrag("drop", png).defaultPrevented).toBe(true);
    expect(onTexture).toHaveBeenCalledWith(png);
  });

  it("yields field drops to the field", () => {
    const field = fieldWell(FILE_DROP_ATTR);
    expect(fileDrag("dragover", png, field).defaultPrevented).toBe(false);
    expect(fileDrag("drop", png, field).defaultPrevented).toBe(false);
    expect(onTexture).not.toHaveBeenCalled();
    field.remove();
  });
});
