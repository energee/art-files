// filedrop-dom.test.tsx — window-level drag/drop behavior of AssetDropOverlay
// (src/components/AssetDropOverlay.tsx): any file drag outside a field must be
// defaultPrevented so the webview never navigates to the file and discards
// every tab (#121), while only claimed image types are routed or arm the
// overlay. No @testing-library/react in this repo — mounted through
// react-dom/client + act, matching tests/rulers-dom.test.tsx.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetDropOverlay } from "../src/components/AssetDropOverlay";
import { FILE_DROP_ATTR } from "../src/components/FileDrop";

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

/** happy-dom's DataTransfer can't carry OS files, so a minimal stand-in
 *  shaped like a Finder drag (types includes "Files") is attached. */
function fileDrag(type: "dragover" | "drop", file: File, target: EventTarget = document.body) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(e, "dataTransfer", {
    value: { types: ["Files"], items: [{ kind: "file", type: file.type }], files: [file] },
  });
  Object.defineProperty(e, "clientX", { value: 10 });
  act(() => { target.dispatchEvent(e); });
  return e;
}

const pdf = new File(["%PDF"], "art.pdf", { type: "application/pdf" });
const label = new File(["{}"], "beer.label", { type: "" });
const png = new File(["png"], "rock.png", { type: "image/png" });

describe("AssetDropOverlay window drops", () => {
  it("prevents navigation for unclaimed file types without routing them", () => {
    for (const f of [pdf, label]) {
      expect(fileDrag("dragover", f).defaultPrevented).toBe(true);
      expect(fileDrag("drop", f).defaultPrevented).toBe(true);
    }
    expect(onTexture).not.toHaveBeenCalled();
    expect(onMask).not.toHaveBeenCalled();
    // An unclaimed drag never arms the overlay.
    expect(document.querySelector(".fixed")).toBeNull();
  });

  it("still routes a claimed image", () => {
    expect(fileDrag("drop", png).defaultPrevented).toBe(true);
    expect(onTexture).toHaveBeenCalledWith(png);
  });

  it("yields field drops to the field", () => {
    const field = document.createElement("div");
    field.setAttribute(FILE_DROP_ATTR, "");
    document.body.appendChild(field);
    expect(fileDrag("dragover", png, field).defaultPrevented).toBe(false);
    expect(fileDrag("drop", png, field).defaultPrevented).toBe(false);
    expect(onTexture).not.toHaveBeenCalled();
    field.remove();
  });
});
