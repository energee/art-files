// masterpicker-dom.test.tsx — DOM behavior of MasterPicker
// (src/components/MasterPicker.tsx): the Design sidebar's "Master: Lolev ▾"
// selector. Choosing another library master previews the rebind
// (model/rebindLayers.ts) — the counts of what would move to the bench — and
// must NOT call onMaster until the inline "Continue" is pressed.
// Scoped to a DOM environment per-file, matching tests/fieldlist-dom.test.ts's
// setup — no @testing-library/react in this repo, so this drives real DOM
// nodes through react-dom/client + act, the same as that suite.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MasterPicker } from "../src/components/MasterPicker";
import { lolevMaster } from "../src/model/lolevLayers";
import type { LabelFile, Master } from "../src/model/layers";

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

const label: LabelFile = {
  formatVersion: 3, masterId: "lolev", enabledVariants: ["collab"],
  values: { name: [{ text: "Peregrine", fill: "#F3CD80", layer: "metallic" }] },
};

function renderPicker(props: Partial<Parameters<typeof MasterPicker>[0]> = {}) {
  const full: Parameters<typeof MasterPicker>[0] = {
    master: lolevMaster(), label,
    library: { lolev: { name: "Lolev" }, other: { name: "Other Brewery" } },
    resolve: vi.fn().mockResolvedValue({ master: otherMaster, assets: {} }),
    onMaster: vi.fn(),
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
  Array.from(document.querySelectorAll<HTMLElement>("button, [role=option]"))
    .find((b) => (b.getAttribute("aria-label") ?? b.textContent)?.trim().startsWith(text)) as HTMLButtonElement | undefined;

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
    const resolve = vi.fn().mockResolvedValue({ master: otherMaster, assets: {} });
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
    expect(onMaster).toHaveBeenCalledWith(otherMaster, {});
  });

  it("offers nothing but the library — file verbs live in the File menu", () => {
    renderPicker();
    expect(itemStarting("Open Master")).toBeUndefined();
    expect(itemStarting("Duplicate as new master")).toBeUndefined();
  });
});
