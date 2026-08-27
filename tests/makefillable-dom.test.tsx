// makefillable-dom.test.tsx — DOM behavior of MakeFillable
// (src/components/StyleProperties.tsx): Task 5's inspector button that turns
// a selected layer's raw content into a declared field (spec: addField in
// model/document.ts). Mounted directly rather than through the whole
// Inspector, matching tests/overridebadge-dom.test.tsx's convention (see its
// header) — no @testing-library/react in this repo.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MakeFillable } from "../src/components/StyleProperties";

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

function renderButton(props: Partial<Parameters<typeof MakeFillable>[0]> = {}) {
  const full: Parameters<typeof MakeFillable>[0] = {
    id: "name", declaredPaths: new Set(), onMakeFillable: vi.fn(),
    ...props,
  };
  act(() => { root.render(createElement(MakeFillable, full)); });
  return full;
}

const button = (id: string) => container.querySelector(`#${id}`) as HTMLButtonElement | null;
const input = () => container.querySelector("#make-fillable-name") as HTMLInputElement | null;

function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el), "value",
  )!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(el: Element, key: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("MakeFillable", () => {
  it("shows the button for a text element with no declared field yet", () => {
    renderButton({ id: "name" });
    expect(button("make-fillable")).not.toBeNull();
  });

  it("renders nothing for an element with no config-backed content path", () => {
    // The laurel: elements.ts's editableText has no "logo" entry, and
    // FILLABLE doesn't either — the brief's own example of a button-less
    // layer.
    renderButton({ id: "logo" });
    expect(button("make-fillable")).toBeNull();
  });

  it("renders nothing for qr — its payload is derived, not stored", () => {
    renderButton({ id: "qr" });
    expect(button("make-fillable")).toBeNull();
  });

  it("renders nothing once the path is already declared", () => {
    renderButton({ id: "name", declaredPaths: new Set(["beerName"]) });
    expect(button("make-fillable")).toBeNull();
  });

  it("opens an inline name field prefilled with the layer's label", () => {
    renderButton({ id: "name" });
    act(() => { button("make-fillable")!.click(); });
    expect(input()).not.toBeNull();
    expect(input()!.value).toBe("Name");
    expect(button("make-fillable")).toBeNull(); // swapped out while naming
  });

  it("commits a text field on Enter, inferring kind/path from the layer", () => {
    const onMakeFillable = vi.fn();
    renderButton({ id: "name", onMakeFillable });
    act(() => { button("make-fillable")!.click(); });
    press(input()!, "Enter");
    expect(onMakeFillable).toHaveBeenCalledTimes(1);
    const decl = onMakeFillable.mock.calls[0][0];
    expect(decl).toMatchObject({ label: "Name", kind: "text", path: "beerName" });
    expect(decl.id).toMatch(/^field-/);
  });

  it("commits a typed label instead of the default", () => {
    const onMakeFillable = vi.fn();
    renderButton({ id: "name", onMakeFillable });
    act(() => { button("make-fillable")!.click(); });
    type(input()!, "Beer Name");
    act(() => { button("make-fillable-commit")!.click(); });
    expect(onMakeFillable).toHaveBeenCalledWith(expect.objectContaining({ label: "Beer Name" }));
  });

  it("infers the 'code' kind and a upc-a symbology for the barcode", () => {
    const onMakeFillable = vi.fn();
    renderButton({ id: "barcode", onMakeFillable });
    act(() => { button("make-fillable")!.click(); });
    press(input()!, "Enter");
    expect(onMakeFillable).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "code", path: "upc", symbology: "upc-a" }));
  });

  it("Escape cancels without committing", () => {
    const onMakeFillable = vi.fn();
    renderButton({ id: "name", onMakeFillable });
    act(() => { button("make-fillable")!.click(); });
    press(input()!, "Escape");
    expect(onMakeFillable).not.toHaveBeenCalled();
    expect(button("make-fillable")).not.toBeNull(); // back to the plain button
  });
});
