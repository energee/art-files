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

  it("stays up while WebKit's null-relatedTarget dragleave crosses elements (#122)", () => {
    // WebKit reports relatedTarget null on every dragleave, including moves
    // between elements inside the window. Only the last leave (depth 0) is
    // the pointer actually leaving the window.
    const inner = document.createElement("div");
    document.body.appendChild(inner);
    const overlay = () => document.querySelector(".fixed");
    fileDrag("dragenter", png);
    fileDrag("dragover", png);
    expect(overlay()).not.toBeNull();
    fileDrag("dragenter", png, inner);
    fileDrag("dragleave", png);          // leaving body for inner
    expect(overlay()).not.toBeNull();
    fileDrag("dragleave", png, inner);   // leaving inner, then the window
    expect(overlay()).toBeNull();
    inner.remove();
  });

  it("keeps its depth across a pass over a field (#122)", () => {
    const field = fieldWell(FILE_DROP_ATTR);
    const inner = document.createElement("div");
    document.body.appendChild(inner);
    const overlay = () => document.querySelector(".fixed");
    fileDrag("dragenter", png);
    fileDrag("dragenter", png, field);
    fileDrag("dragleave", png);
    fileDrag("dragover", png, field);    // over the field: overlay yields
    expect(overlay()).toBeNull();
    fileDrag("dragenter", png, inner);
    fileDrag("dragleave", png, field);
    fileDrag("dragover", png, inner);    // back on the canvas: re-armed
    fileDrag("dragenter", png);
    fileDrag("dragleave", png, inner);   // crossing, not leaving
    expect(overlay()).not.toBeNull();
    fileDrag("drop", png);
    expect(overlay()).toBeNull();
    field.remove();
    inner.remove();
  });

  it("yields field drops to the field", () => {
    const field = fieldWell(FILE_DROP_ATTR);
    expect(fileDrag("dragover", png, field).defaultPrevented).toBe(false);
    expect(fileDrag("drop", png, field).defaultPrevented).toBe(false);
    expect(onTexture).not.toHaveBeenCalled();
    field.remove();
  });
});
