// formatbuilder-dom.test.tsx — DOM behavior of FormatBuilder
// (src/components/FormatBuilder.tsx): the chip-based editor for a custom
// barcode/QR layer's raw format-string value. Scoped to a DOM environment
// per-file and driven through react-dom/client + act, matching
// fieldlist-dom.test.ts's conventions — no @testing-library/react in this
// repo.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormatBuilder } from "../src/components/FormatBuilder";
import type { FieldDecl } from "../src/model/types";

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

const NAME_FIELD: FieldDecl = { id: "name", label: "Beer name", kind: "text", path: "beerName" };

function renderBuilder(props: Parameters<typeof FormatBuilder>[0]) {
  act(() => { root.render(createElement(FormatBuilder, props)); });
}

function change(el: Element, value: string) {
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input), "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("FormatBuilder", () => {
  it("renders a chip labeled with the field's label and its current transform selected", () => {
    renderBuilder({
      value: "{name|slug}", fields: [NAME_FIELD], preview: { name: "Hazy IPA" },
      onChange: vi.fn(),
    });
    expect(container.textContent).toMatch(/Beer name/);
    const select = container.querySelector('select[aria-label="name transform"]') as HTMLSelectElement;
    expect(select.value).toBe("slug");
  });

  it("changing the transform calls onChange with the ref rewritten in place", () => {
    const onChange = vi.fn();
    renderBuilder({
      value: "{name|slug}", fields: [NAME_FIELD], preview: { name: "Hazy IPA" },
      onChange,
    });
    const select = container.querySelector('select[aria-label="name transform"]') as HTMLSelectElement;
    act(() => {
      select.value = "upper";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("{name|upper}");
  });

  it("the Raw toggle swaps to a plain input that passes typed text through", () => {
    const onChange = vi.fn();
    renderBuilder({
      value: "{name|slug}", fields: [NAME_FIELD], preview: { name: "Hazy IPA" },
      onChange,
    });
    const toggle = [...container.querySelectorAll("button")]
      .find((b) => b.textContent === "Raw")!;
    act(() => { toggle.click(); });
    const rawInput = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(rawInput).toBeTruthy();
    change(rawInput, "plain text {oops");
    expect(onChange).toHaveBeenCalledWith("plain text {oops");
  });

  it("shows a live preview with missing refs left as literal braces", () => {
    renderBuilder({
      value: "{name|slug} {missing}", fields: [NAME_FIELD], preview: { name: "Hazy IPA" },
      onChange: vi.fn(),
    });
    expect(container.textContent).toMatch(/hazy-ipa \{missing\}/);
  });
});
