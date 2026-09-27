// field-input-dom.test.tsx — scrub rate changes and ordinary pasted hex colors.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ScrubField } from "../src/components/ScrubField";
import { ColorField } from "../src/components/ColorField";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("modifier changes affect only new scrub travel (#303)", () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); const change = vi.fn();
  try {
    act(() => root.render(createElement(ScrubField, { id: "n", label: "N", unit: "mm", value: 0, min: -1000, max: 1000, step: 1, onChange: change })));
    const label = host.querySelector("label")!;
    label.setPointerCapture = vi.fn();
    act(() => label.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 0 })));
    for (const [clientX, shiftKey, expected] of [[40, false, 20], [40, true, 20], [42, true, 30], [42, false, 30], [44, false, 31]] as const) {
      act(() => label.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX, shiftKey })));
      expect(change).toHaveBeenLastCalledWith(expected);
    }
  } finally { act(() => root.unmount()); host.remove(); }
});
/** Types `typed` into the ColorField's hex box the way a keystroke does. */
function typeHex(input: HTMLInputElement, typed: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, typed);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function mountColor() {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); const change = vi.fn();
  act(() => root.render(createElement(ColorField, { value: "#000000", onChange: change })));
  const input = host.querySelector("input")!;
  return { input, change, done: () => { act(() => root.unmount()); host.remove(); } };
}
it.each([["FF0000", "#ff0000"], ["#f00", "#ff0000"], ["abc", "#aabbcc"]])("normalizes hex %s on commit (#315)", (typed, expected) => {
  const { input, change, done } = mountColor();
  try {
    typeHex(input, typed);
    act(() => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(change).toHaveBeenLastCalledWith(expected);
    expect(input.getAttribute("aria-invalid")).toBeNull();
  } finally { done(); }
});
// Every 6-digit hex starts with a valid 3-digit one: committing it per
// keystroke flashed #11ff22 while typing #1f2a3b, and left it applied if the
// entry was abandoned at 4-5 digits.
it("applies a full #rrggbb as it is typed, a 3-digit hex only on commit", () => {
  const { input, change, done } = mountColor();
  try {
    typeHex(input, "#1f2");
    expect(change).not.toHaveBeenCalled();
    typeHex(input, "#1f2a3b");
    expect(change).toHaveBeenLastCalledWith("#1f2a3b");
    expect(change).toHaveBeenCalledTimes(1);
    typeHex(input, "#abc");
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(change).toHaveBeenLastCalledWith("#aabbcc");
  } finally { done(); }
});
// Delete on the last saved swatch moved focus to the Save button while it was
// still disabled (this very hex was saved), so focus fell to <body>.
it("keeps focus in the swatch row when the last swatch is deleted", async () => {
  const { setSwatches } = await import("../src/settings");
  setSwatches(() => ["#000000"]);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    act(() => root.render(createElement(ColorField, { value: "#000000", onChange: vi.fn() })));
    const trigger = host.querySelector('[aria-label="Pick color"]') as HTMLButtonElement;
    await act(async () => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
        trigger.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
      trigger.click();
    });
    // Browsers refuse focus to a disabled button; happy-dom does not, so say so.
    const focus = HTMLButtonElement.prototype.focus;
    vi.spyOn(HTMLButtonElement.prototype, "focus").mockImplementation(function (this: HTMLButtonElement) {
      if (!this.disabled) focus.call(this);
    });
    const chip = document.querySelector('button[aria-label="#000000"]') as HTMLButtonElement;
    chip.focus();
    act(() => { chip.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })); });
    expect(document.querySelector('button[aria-label="#000000"]')).toBeNull();
    const active = document.activeElement as HTMLElement;
    expect(active.tagName).toBe("BUTTON");
    expect(active.textContent).toBe("Save");
  } finally { vi.restoreAllMocks(); act(() => root.unmount()); host.remove(); setSwatches(() => []); }
});
