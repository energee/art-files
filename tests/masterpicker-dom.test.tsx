// masterpicker-dom.test.tsx — DOM behavior of MasterPicker
// (src/components/MasterPicker.tsx): the Design sidebar's "Master: Lolev ▾"
// selector. Choosing another library master previews the rebind
// (model/rebind.ts) — the counts of what would move to the bench — and must
// NOT call onMaster until the inline "Continue" is pressed (Task 4b brief).
// Scoped to a DOM environment per-file, matching tests/fieldlist-dom.test.ts's
// setup — no @testing-library/react in this repo, so this drives real DOM
// nodes through react-dom/client + act, the same as that suite.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MasterPicker } from "../src/components/MasterPicker";
import { lolevMaster } from "../src/model/lolev";
import type { LabelFileV2, Master } from "../src/model/types";

// React only honours act() when the environment opts in (see
// fieldlist-dom.test.ts for the same line).
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

/** A different brewery's master: no variants, so binding onto it always
 *  benches the shipped master's "collab" variant — a guaranteed non-empty
 *  preview for the assertion below. */
const otherMaster: Master = { ...lolevMaster(), id: "other", name: "Other Brewery", variants: [] };

const label: LabelFileV2 = {
  formatVersion: 2, masterId: "lolev", enabledVariants: ["collab"],
  values: { name: "Peregrine" },
};

function renderPicker(props: Partial<Parameters<typeof MasterPicker>[0]> = {}) {
  const full: Parameters<typeof MasterPicker>[0] = {
    master: lolevMaster(), label,
    library: { lolev: { name: "Lolev" }, other: { name: "Other Brewery" } },
    resolve: vi.fn().mockResolvedValue(otherMaster),
    onMaster: vi.fn(), onOpenMaster: vi.fn(), onDuplicate: vi.fn(),
    ...props,
  };
  act(() => { root.render(createElement(MasterPicker, full)); });
  return full;
}

const trigger = () => container.querySelector("#master-picker") as HTMLButtonElement;
const openMenu = () => act(() => { trigger().click(); });
/** The menu item (or any button) whose visible text STARTS with `text` — the
 *  library rows may append an ellipsis while resolving. */
const itemStarting = (text: string) =>
  Array.from(container.querySelectorAll("button"))
    .find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement | undefined;

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

describe("MasterPicker", () => {
  it("names the current master on the trigger", () => {
    renderPicker();
    expect(trigger().textContent).toContain("Lolev");
  });

  it("previews the rebind and does not commit until Continue is pressed", async () => {
    const onMaster = vi.fn();
    const resolve = vi.fn().mockResolvedValue(otherMaster);
    renderPicker({ onMaster, resolve });
    openMenu();
    await act(async () => {
      itemStarting("Other Brewery")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(resolve).toHaveBeenCalledWith("other");
    const preview = container.querySelector("#master-picker-preview");
    expect(preview).not.toBeNull();
    expect(preview!.textContent).toContain("variant");
    expect(onMaster).not.toHaveBeenCalled();

    act(() => {
      (container.querySelector("#master-picker-continue") as HTMLButtonElement).click();
    });
    expect(onMaster).toHaveBeenCalledWith(otherMaster);
  });

  it("calls onDuplicate with the typed name, and never touches onMaster", () => {
    const onDuplicate = vi.fn();
    const onMaster = vi.fn();
    renderPicker({ onDuplicate, onMaster });
    openMenu();
    act(() => { itemStarting("Duplicate as new master")!.click(); });
    const input = container.querySelector("#master-picker-duplicate-name") as HTMLInputElement;
    expect(input).not.toBeNull();
    type(input, "Lolev copy");
    press(input, "Enter");
    expect(onDuplicate).toHaveBeenCalledWith("Lolev copy");
    expect(onMaster).not.toHaveBeenCalled();
  });

  it("routes Open Master… to onOpenMaster", () => {
    const onOpenMaster = vi.fn();
    renderPicker({ onOpenMaster });
    openMenu();
    act(() => { itemStarting("Open Master")!.click(); });
    expect(onOpenMaster).toHaveBeenCalled();
  });
});
