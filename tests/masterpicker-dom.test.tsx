// masterpicker-dom.test.tsx — DOM behavior of MasterPicker
// (src/components/MasterPicker.tsx): the Design sidebar's "Master: Lolev ▾"
// selector. It lists only THIS master, its variants and New Variant — no
// library, no rebind preview (that moved to File → Open Master, App.tsx).
// Scoped to a DOM environment per-file, matching tests/fieldlist-dom.test.ts's
// setup — no @testing-library/react in this repo, so this drives real DOM
// nodes through react-dom/client + act, the same as that suite.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MasterPicker } from "../src/components/MasterPicker";
import { lolevMaster } from "../src/model/lolevLayers";

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

// React only honours act() when the environment opts in (see
// fieldlist-dom.test.ts for the same line).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderPicker(props: Partial<Parameters<typeof MasterPicker>[0]> = {}) {
  const full: Parameters<typeof MasterPicker>[0] = {
    master: lolevMaster(), onNewVariant: vi.fn(), version: null, onVersion: vi.fn(),
    mode: "label", onMode: vi.fn(),
    ...props,
  };
  act(() => { root.render(createElement(MasterPicker, full)); });
  return full;
}

const trigger = () => container.querySelector("#master-picker") as HTMLButtonElement;
const openMenu = () => act(() => { trigger().click(); });
const itemStarting = (text: string) =>
  Array.from(document.querySelectorAll<HTMLElement>("button, [role=option]"))
    .find((b) => (b.getAttribute("aria-label") ?? b.textContent)?.trim().startsWith(text)) as HTMLButtonElement | undefined;

describe("MasterPicker", () => {
  it("names the current master on the trigger", () => {
    renderPicker();
    expect(trigger().textContent).toContain("Lolev");
  });

  it("names the version being edited on the trigger", () => {
    renderPicker({ version: "collab" });
    expect(trigger().textContent).toContain("Collab");
  });

  it("renders the master, its variants and New Variant — nothing else", () => {
    renderPicker();
    openMenu();
    const options = document.querySelectorAll("[role=option]");
    // lolevMaster() has exactly one variant ("collab"): master + variant +
    // New Variant = 3 rows. No library rows, ever.
    expect(options.length).toBe(3);
    expect(itemStarting("Lolev")).toBeDefined();
    expect(itemStarting("Collab")).toBeDefined();
    expect(itemStarting("New Variant")).toBeDefined();
  });

  it("picking a variant calls onVersion with its id", () => {
    const onVersion = vi.fn();
    renderPicker({ onVersion });
    openMenu();
    act(() => { itemStarting("Collab")!.click(); });
    expect(onVersion).toHaveBeenCalledWith("collab");
  });

  it("picking the master row calls onVersion(null)", () => {
    const onVersion = vi.fn();
    renderPicker({ version: "collab", onVersion });
    openMenu();
    act(() => { itemStarting("Lolev")!.click(); });
    expect(onVersion).toHaveBeenCalledWith(null);
  });

  it("picking New Variant calls onNewVariant", () => {
    const onNewVariant = vi.fn();
    renderPicker({ onNewVariant });
    openMenu();
    act(() => { itemStarting("New Variant")!.click(); });
    expect(onNewVariant).toHaveBeenCalled();
  });
});

// The switch (docs/plans/template-switch.md, Task 5): This label / Template,
// under the Select. Single-select ToggleGroup; ignore a re-click of the
// already-active item (base-ui reports that as an empty group value) so a
// mode is always set — the same rule LayerInspector's Segmented follows.
describe("the mode switch", () => {
  const editingGroup = () => container.querySelector('[aria-label="Editing"]') as HTMLElement;
  const item = (text: string) =>
    Array.from(editingGroup().querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

  it("renders both items", () => {
    renderPicker();
    expect(item("This label")).toBeDefined();
    expect(item("Template")).toBeDefined();
  });

  it("reflects the label mode as pressed on \"This label\"", () => {
    renderPicker({ mode: "label" });
    expect(item("This label").getAttribute("aria-pressed")).toBe("true");
    expect(item("Template").getAttribute("aria-pressed")).toBe("false");
  });

  it("reflects template mode as pressed on \"Template\"", () => {
    renderPicker({ mode: "template" });
    expect(item("Template").getAttribute("aria-pressed")).toBe("true");
    expect(item("This label").getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking Template calls onMode(\"template\")", () => {
    const onMode = vi.fn();
    renderPicker({ mode: "label", onMode });
    act(() => { item("Template").click(); });
    expect(onMode).toHaveBeenCalledWith("template");
  });

  it("clicking the active item does not call onMode", () => {
    const onMode = vi.fn();
    renderPicker({ mode: "label", onMode });
    act(() => { item("This label").click(); });
    expect(onMode).not.toHaveBeenCalled();
  });

  it("carries data-mode on the root, for later styling", () => {
    renderPicker({ mode: "template" });
    expect(editingGroup().getAttribute("data-mode")).toBe("template");
  });
});
