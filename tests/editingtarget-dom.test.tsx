// editingtarget-dom.test.tsx — DOM behavior of EditingTarget
// (src/components/EditingTarget.tsx): the Design sidebar's "Editing: Master ▾"
// selector and the read-only field list it scopes. Scoped to a DOM
// environment per-file, matching tests/fieldlist-dom.test.ts's convention
// (see its header) — no @testing-library/react in this repo, so this drives
// real DOM nodes through react-dom/client + act, the same as that suite.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditingTarget, TargetFields } from "../src/components/EditingTarget";
import { lolevMaster } from "../src/model/lolev";
import type { Master } from "../src/model/types";

// React only honours act() when the environment opts in (see
// tests/fieldlist-dom.test.ts for the same line).
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

function renderTarget(props: Partial<Parameters<typeof EditingTarget>[0]> = {}) {
  const full: Parameters<typeof EditingTarget>[0] = {
    master: lolevMaster(), target: "master",
    onTarget: vi.fn(), onNewVariant: vi.fn(), dirty: false,
    ...props,
  };
  act(() => { root.render(createElement(EditingTarget, full)); });
  return full;
}

/** TargetFields is its own export so App can render it UNDER the layers list,
 *  where the spec puts the current target's fields — see EditingTarget.tsx's
 *  header. Same file, same data, separate element. */
function renderFields(props: Parameters<typeof TargetFields>[0]) {
  act(() => { root.render(createElement(TargetFields, props)); });
}

const trigger = () => container.querySelector("#editing-target") as HTMLButtonElement;
const openMenu = () => act(() => { trigger().click(); });
/** The menu item (or any button) whose visible text is exactly `text`. */
const itemNamed = (text: string) =>
  Array.from(container.querySelectorAll("button"))
    .find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

function type(el: Element, value: string) {
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input), "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(el: Element, key: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

/** The shipped master with a single field declared on its collab variant —
 *  the shipped variant declares none until Task 5c, and the scoping assertion
 *  needs a variant that actually has one. */
function masterWithCollabField(): Master {
  const m = lolevMaster();
  return {
    ...m,
    variants: m.variants.map((v) => v.id === "collab"
      ? { ...v, fields: [{ id: "pairing", label: "Pairing", kind: "text" as const, path: "description" }] }
      : v),
  };
}

describe("EditingTarget", () => {
  it("names the current target on the trigger", () => {
    renderTarget();
    expect(trigger().textContent).toContain("Master");
  });

  it("picks a variant from the dropdown", () => {
    const onTarget = vi.fn();
    renderTarget({ onTarget });
    openMenu();
    act(() => { itemNamed("Collab")!.click(); });
    expect(onTarget).toHaveBeenCalledWith({ variant: "collab" });
  });

  it("creates a variant from the inline input on Enter, and cancels on Escape", () => {
    const onNewVariant = vi.fn();
    renderTarget({ onNewVariant });
    openMenu();
    act(() => { itemNamed("New variant…")!.click(); });
    const input = container.querySelector("#editing-target-name") as HTMLInputElement;
    expect(input).not.toBeNull();
    type(input, "Winter");
    press(input, "Enter");
    expect(onNewVariant).toHaveBeenCalledWith("Winter");

    // Escape hides the input without creating anything.
    onNewVariant.mockClear();
    openMenu();
    act(() => { itemNamed("New variant…")!.click(); });
    const again = container.querySelector("#editing-target-name") as HTMLInputElement;
    type(again, "Summer");
    press(again, "Escape");
    expect(onNewVariant).not.toHaveBeenCalled();
    expect(container.querySelector("#editing-target-name")).toBeNull();
  });

  it("shows a dot on the trigger while the master has unsaved edits", () => {
    renderTarget({ dirty: true });
    expect(trigger().textContent).toContain("•");
  });

  it("scopes the field list to the current target", () => {
    renderFields({ master: masterWithCollabField(), target: "master" });
    const fields = container.querySelector("#editing-target-fields")!;
    for (const label of ["Beer name", "Style", "ABV", "Description", "UPC"]) {
      expect(fields.textContent).toContain(label);
    }

    renderFields({ master: masterWithCollabField(), target: { variant: "collab" } });
    const variantFields = container.querySelector("#editing-target-fields")!;
    expect(variantFields.textContent).toContain("Pairing");
    // All five master labels, not a sample: the point of the assertion is
    // that a variant target shows its OWN fields and nothing inherited.
    for (const label of ["Beer name", "Style", "ABV", "Description", "UPC"]) {
      expect(variantFields.textContent).not.toContain(label);
    }
  });

  it("tells an empty target how to declare its first field", () => {
    renderFields({ master: lolevMaster(), target: { variant: "collab" } });
    expect(container.querySelector("#editing-target-fields")!.textContent)
      .toContain("No fields yet — select a layer and choose Make fillable.");
  });
});
