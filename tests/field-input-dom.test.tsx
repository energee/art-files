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
