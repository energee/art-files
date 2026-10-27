// field-input-dom.test.tsx — scrub rate changes and ordinary pasted hex colors.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ScrubField } from "../src/components/ScrubField";
import { ColorField } from "../src/components/ColorField";
it("modifier changes affect only new scrub travel (#303)", async () => {
  // NumberField scrubs by movementX, one step per pixel (Shift = largeStep 10).
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); let value = 0;
  const change = vi.fn((v: number) => { value = v; });
  const field = () => createElement(ScrubField, { id: "n", label: "N", unit: "mm", value, min: -1000, max: 1000, step: 1, onChange: change });
  try {
    act(() => root.render(field()));
    const label = host.querySelector("label")!;
    const o = { bubbles: true, cancelable: true, pointerType: "mouse", button: 0, buttons: 1, pointerId: 1 };
    await act(async () => { label.dispatchEvent(new PointerEvent("pointerdown", o)); });
    for (const [movementX, shiftKey, expected] of [[20, false, 20], [0, true, 20], [2, true, 40], [0, false, 40], [1, false, 41]] as const) {
      await act(async () => { window.dispatchEvent(new PointerEvent("pointermove", { ...o, movementX, shiftKey })); });
      act(() => root.render(field()));  // controlled: feed the value back, as App does
      expect(value).toBe(expected);
    }
    await act(async () => { window.dispatchEvent(new PointerEvent("pointerup", { ...o, buttons: 0 })); });
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
  act(() => root.render(createElement(ColorField, { label: "Fill", value: "#000000", onChange: change })));
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
    act(() => root.render(createElement(ColorField, { label: "Fill", value: "#000000", onChange: vi.fn() })));
    const trigger = host.querySelector('[aria-label="Pick fill color"]') as HTMLButtonElement;
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
    const chip = document.querySelector('button[aria-label="Saved color #000000"]') as HTMLButtonElement;
    // The Delete gesture is announced, not only in the hover title (#425).
    expect(chip.getAttribute("aria-keyshortcuts")).toBe("Delete Backspace");
    chip.focus();
    act(() => { chip.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })); });
    expect(document.querySelector('button[aria-label="Saved color #000000"]')).toBeNull();
    const active = document.activeElement as HTMLElement;
    expect(active.tagName).toBe("BUTTON");
    expect(active.textContent).toBe("Save");
  } finally { vi.restoreAllMocks(); act(() => root.unmount()); host.remove(); setSwatches(() => []); }
});
// A held Delete auto-repeats onto the chip that takes the deleted one's place;
// without an e.repeat guard it swept the whole saved list (#425 review).
it("deletes one saved swatch per Delete press, not on auto-repeat", async () => {
  const { setSwatches } = await import("../src/settings");
  setSwatches(() => ["#000000", "#111111", "#222222"]);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    act(() => root.render(createElement(ColorField, { label: "Fill", value: "#ffffff", onChange: vi.fn() })));
    const trigger = host.querySelector('[aria-label="Pick fill color"]') as HTMLButtonElement;
    await act(async () => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
        trigger.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
      trigger.click();
    });
    const chip = document.querySelector('button[aria-label="Saved color #000000"]') as HTMLButtonElement;
    chip.focus();
    act(() => { chip.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })); });
    for (let i = 0; i < 2; i++) {
      const at = document.activeElement as HTMLElement;
      act(() => { at.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", repeat: true, bubbles: true })); });
    }
    const left = [...document.querySelectorAll('button[aria-label^="Saved color"]')].map((b) => b.getAttribute("aria-label"));
    expect(left).toEqual(["Saved color #111111", "Saved color #222222"]);
  } finally { act(() => root.unmount()); host.remove(); setSwatches(() => []); }
});
