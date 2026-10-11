// filedrop-dom.test.tsx — AssetDropOverlay's window drag/drop listeners:
// claimed images route to texture/mask, unclaimed files are left alone (the
// #121 navigation guard lives in TabsShell — tabsshell-drop-dom.test.tsx),
// and field drops yield to the field. No @testing-library/react in this repo —
// mounted through react-dom/client + act, matching tests/rulers-dom.test.tsx.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { AssetDropOverlay } from "../src/components/AssetDropOverlay";
import { FileDrop, FILE_DROP_ATTR } from "../src/components/FileDrop";
import { fieldWell, fileDrag, label, pdf, png } from "./dom-drag";

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

const overlay = () => document.querySelector(".fixed");

describe("AssetDropOverlay window drops", () => {
  it("does not route or arm for unclaimed file types", () => {
    for (const f of [pdf, label]) {
      fileDrag("dragover", f);
      fileDrag("drop", f);
    }
    expect(onTexture).not.toHaveBeenCalled();
    expect(onMask).not.toHaveBeenCalled();
    expect(overlay()).toBeNull();
  });

  it("routes a claimed image", () => {
    expect(fileDrag("drop", png).defaultPrevented).toBe(true);
    expect(onTexture).toHaveBeenCalledWith(png);
  });

  it("stays up while WebKit's null-relatedTarget dragleave crosses elements (#122)", () => {
    // WebKit reports relatedTarget null on every dragleave, including moves
    // between elements inside the window. Only the last leave (depth 0) is
    // the pointer actually leaving the window.
    const inner = document.body.appendChild(document.createElement("div"));
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
    const inner = document.body.appendChild(document.createElement("div"));
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

it("routes the first claimed file in a mixed drop (#325)", () => {
  const e = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", { value: { files: [pdf, png] } });
  Object.defineProperty(e, "clientX", { value: 10 });
  act(() => document.body.dispatchEvent(e));
  expect(e.defaultPrevented).toBe(true);
  expect(onTexture).toHaveBeenCalledWith(png);
});
it("explains rejected file types and multiple files (#323)", async () => {
  const onFile = vi.fn();
  act(() => root.render(createElement(FileDrop, { label: "Mask", accept: { "image/png": [".png"] }, onFile })));
  const well = container.querySelector(`[${FILE_DROP_ATTR}]`)!;
  for (const [files, message] of [[[pdf], ".png"], [[png, png], "Drop one file."]] as const) {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files, items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })) } });
    await act(async () => {
      well.dispatchEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(onFile).not.toHaveBeenCalled();
  }
});
// The rejection is about the drop that failed: once a file loads by another
// route (the window overlay, Open), the stale "Choose .png" must go.
it("drops a rejection once a different file is loaded", async () => {
  const props = { label: "Mask", accept: { "image/png": [".png"] }, onFile: vi.fn() };
  act(() => root.render(createElement(FileDrop, props)));
  const well = container.querySelector(`[${FILE_DROP_ATTR}]`)!;
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files: [pdf], items: [{ kind: "file", type: pdf.type, getAsFile: () => pdf }] } });
  await act(async () => {
    well.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  act(() => root.render(createElement(FileDrop, { ...props, fileName: "rock.png" })));
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

// #426: the X clears at once, so the well says how to get the file back —
// the caller's own undo when it returns one (texture/mask live outside
// history), otherwise the history's ⌘Z.
describe("FileDrop remove cue (#426)", () => {
  const props = { label: "Texture", accept: { "image/png": [".png"] }, onFile: vi.fn(), fileName: "rock.png" };
  const clickRemove = () => act(() => {
    (container.querySelector('[aria-label="Remove Texture"]') as HTMLButtonElement).click();
  });

  it("offers the caller's undo while the well is empty", () => {
    const undo = vi.fn();
    const onClear = vi.fn(() => undo);
    act(() => root.render(createElement(FileDrop, { ...props, onClear })));
    clickRemove();
    act(() => root.render(createElement(FileDrop, { ...props, onClear, fileName: undefined })));
    expect(container.querySelector('[role="status"]')!.textContent).toContain("Removed rock.png");
    const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Undo")!;
    act(() => button.click());
    expect(undo).toHaveBeenCalledOnce();
  });

  it("names ⌘Z when the clear is in history", () => {
    // isMacOS() reads the user agent; happy-dom's is Linux (Ctrl+Z).
    const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Macintosh");
    onTestFinished(() => ua.mockRestore());
    const onClear = vi.fn();
    act(() => root.render(createElement(FileDrop, { ...props, onClear })));
    clickRemove();
    act(() => root.render(createElement(FileDrop, { ...props, onClear, fileName: undefined })));
    const note = container.querySelector('[role="status"]')!.textContent!;
    expect(note).toContain("⌘Z");
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent === "Undo")).toBe(false);
  });

  it("names Ctrl+Z off macOS", () => {
    const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (X11; Linux x86_64)");
    onTestFinished(() => ua.mockRestore());
    const onClear = vi.fn();
    act(() => root.render(createElement(FileDrop, { ...props, onClear })));
    clickRemove();
    act(() => root.render(createElement(FileDrop, { ...props, onClear, fileName: undefined })));
    expect(container.querySelector('[role="status"]')!.textContent).toContain("Ctrl+Z brings it back");
  });

  it("keeps keyboard focus in the well across the X and its Undo", () => {
    const onClear = vi.fn(() => vi.fn());
    act(() => root.render(createElement(FileDrop, { ...props, onClear })));
    clickRemove();
    act(() => root.render(createElement(FileDrop, { ...props, onClear, fileName: undefined })));
    // The X unmounted with the file; focus went to its Undo, not <body>.
    expect(document.activeElement?.textContent).toBe("Undo");
    act(() => (document.activeElement as HTMLButtonElement).click());
    expect(document.activeElement?.hasAttribute(FILE_DROP_ATTR)).toBe(true);
  });

  it("returns focus to the well when the clear has no undo of its own", () => {
    const onClear = vi.fn();
    act(() => root.render(createElement(FileDrop, { ...props, onClear })));
    clickRemove();
    expect(document.activeElement?.hasAttribute(FILE_DROP_ATTR)).toBe(true);
  });

  it("drops the note once a file is loaded again", () => {
    const onClear = vi.fn();
    act(() => root.render(createElement(FileDrop, { ...props, onClear })));
    clickRemove();
    act(() => root.render(createElement(FileDrop, { ...props, onClear, fileName: "other.png" })));
    expect(container.querySelector('[role="status"]')!.textContent).toBe("");
    // Emptied by another route later (an Open without this asset): no stale note.
    act(() => root.render(createElement(FileDrop, { ...props, onClear, fileName: undefined })));
    expect(container.querySelector('[role="status"]')!.textContent).toBe("");
  });
});
