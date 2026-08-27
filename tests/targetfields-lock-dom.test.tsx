// targetfields-lock-dom.test.tsx — DOM behavior of TargetFields' lock/unlock
// affordance (src/components/EditingTarget.tsx), the product rule on top of
// Task 5's brief: no field is ever read-only, but every field ships locked
// and unlocking is a per-visit UI gate, not a stored fact — see that file's
// header. Matches tests/editingtarget-dom.test.tsx's mount/act convention
// (see its header) — no @testing-library/react in this repo.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TargetFields } from "../src/components/EditingTarget";
import { lolevMaster } from "../src/model/lolev";

// React only honours act() when the environment opts in (see
// tests/editingtarget-dom.test.tsx for the same line).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

function renderFields(props: Partial<Parameters<typeof TargetFields>[0]> = {}) {
  const full: Parameters<typeof TargetFields>[0] = {
    master: lolevMaster(), target: "master",
    onRenameField: vi.fn(), onRemoveField: vi.fn(),
    ...props,
  };
  act(() => { root.render(createElement(TargetFields, full)); });
  return full;
}

// The shipped master's "name" field (model/lolev.ts: id "name", label
// "Beer name") — one row to drive lock/unlock/rename/remove against.
const lockBtn = () => container.querySelector("#field-lock-name") as HTMLButtonElement;
const nameInput = () => container.querySelector("#field-name-name") as HTMLInputElement | null;
const removeBtn = () => container.querySelector("#field-remove-name") as HTMLButtonElement | null;

function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el), "value",
  )!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("TargetFields lock/unlock", () => {
  it("ships every row locked: no rename field, no remove button", () => {
    renderFields();
    expect(nameInput()).toBeNull();
    expect(removeBtn()).toBeNull();
    expect(lockBtn().getAttribute("aria-label")).toBe("Unlock Beer name");
  });

  it("unlocking a row reveals the inline rename field and remove button", () => {
    renderFields();
    act(() => { lockBtn().click(); });
    expect(nameInput()).not.toBeNull();
    expect(nameInput()!.value).toBe("Beer name");
    expect(removeBtn()).not.toBeNull();
    expect(lockBtn().getAttribute("aria-label")).toBe("Lock Beer name");
  });

  it("re-locking hides them again", () => {
    renderFields();
    act(() => { lockBtn().click(); }); // unlock
    act(() => { lockBtn().click(); }); // lock
    expect(nameInput()).toBeNull();
    expect(removeBtn()).toBeNull();
  });

  it("commits the inline rename on blur", () => {
    const onRenameField = vi.fn();
    renderFields({ onRenameField });
    act(() => { lockBtn().click(); });
    type(nameInput()!, "Product Name");
    act(() => { nameInput()!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(onRenameField).toHaveBeenCalledWith("name", "Product Name");
  });

  it("Enter blurs the rename field, committing it", () => {
    const onRenameField = vi.fn();
    renderFields({ onRenameField });
    act(() => { lockBtn().click(); });
    act(() => { nameInput()!.focus(); }); // .blur() below is a no-op unless focused first
    type(nameInput()!, "Product Name");
    act(() => {
      nameInput()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onRenameField).toHaveBeenCalledWith("name", "Product Name");
  });

  it("does not rename on blur when the text is unchanged or empty", () => {
    const onRenameField = vi.fn();
    renderFields({ onRenameField });
    act(() => { lockBtn().click(); });
    act(() => { nameInput()!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(onRenameField).not.toHaveBeenCalled();
    type(nameInput()!, "   ");
    act(() => { nameInput()!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(onRenameField).not.toHaveBeenCalled();
  });

  it("removing an unlocked field calls onRemoveField with its id", () => {
    const onRemoveField = vi.fn();
    renderFields({ onRemoveField });
    act(() => { lockBtn().click(); });
    act(() => { removeBtn()!.click(); });
    expect(onRemoveField).toHaveBeenCalledWith("name");
  });

  it("a locked field can still be read — the value just isn't editable inline", () => {
    renderFields();
    const row = lockBtn().closest("li")!;
    expect(row.textContent).toContain("Beer name");
    expect(row.textContent).toContain("text");
  });
});
