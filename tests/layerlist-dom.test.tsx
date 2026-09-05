// layerlist-dom.test.tsx — DOM behavior of LayerList (src/components/
// LayerList.tsx): the one flat Layers list of the master-as-layers redesign.
// Props-only component, so the rows are built straight from the Lolev v3
// master data (model/lolevLayers.ts) with the collab variant's three layers
// appended as variant-added rows — no resolver in the loop. Scoped to a DOM
// environment per-file, matching tests/layerspanel-dom.test.tsx's setup — no
// @testing-library/react in this repo, so this drives real DOM nodes through
// react-dom/client + act, the same as that suite.
// @vitest-environment happy-dom
import { act, createElement, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayerList, type LayerListProps, type LayerRow, type VariantChip } from "../src/components/LayerList";
import { SidebarProvider } from "../src/components/ui/sidebar";
import { lolevMaster } from "../src/model/lolevLayers";
import type { Layer } from "../src/model/layers";

// React only honours act() when the environment opts in (see
// tests/layerspanel-dom.test.tsx for the same line).
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

/** The Lolev master's layers in draw order, then the collab variant's three
 *  added layers badged with the variant (on or off). */
function lolevRows(collabOn = false): { rows: LayerRow[]; variants: VariantChip[] } {
  const m = lolevMaster();
  const collab = m.variants.find((v) => v.id === "collab")!;
  const variant: VariantChip = { id: collab.id, name: collab.name, enabled: collabOn };
  return {
    rows: [
      ...m.layers.map((layer) => ({ layer })),
      ...Object.values(collab.layers).map((l) => ({ layer: l as Layer, variant })),
    ],
    variants: [variant],
  };
}

function baseProps(over: Partial<LayerListProps> = {}): LayerListProps {
  const { rows, variants } = lolevRows();
  return {
    rows,
    selected: [],
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    onRename: vi.fn(),
    onReorder: vi.fn(),
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    editMaster: false,
    onEditMaster: vi.fn(),
    variants,
    onToggleVariant: vi.fn(),
    ...over,
  };
}

function render(props: LayerListProps) {
  // The rows lean on shadcn's Sidebar primitives (SidebarMenuButton reads a
  // SidebarProvider's context), so a real mount needs one, as App's does.
  act(() => { root.render(createElement(SidebarProvider, null, createElement(LayerList, props))); });
  return props;
}

const rowIds = () =>
  Array.from(container.querySelectorAll("[data-layer-id]")).map((li) => li.getAttribute("data-layer-id"));
const rowFor = (id: string) => container.querySelector(`[data-layer-id="${id}"]`) as HTMLLIElement;
const byLabel = (label: string) => container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
const click = (el: Element) => act(() => { (el as HTMLElement).click(); });
const keydown = (el: Element, key: string, init: KeyboardEventInit = {}) =>
  act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init })); });
const dblclick = (el: Element) =>
  act(() => { el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });

/** base-ui's menu trigger opens on mousedown, not click — send the whole
 *  press so the popup mounts (into document.body, through a portal). */
async function openMenu(trigger: Element) {
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
      trigger.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    (trigger as HTMLElement).click();
    await Promise.resolve();
  });
}
const menuItem = (text: string) =>
  Array.from(document.querySelectorAll('[role="menuitem"]'))
    .find((el) => el.textContent?.trim() === text) as HTMLElement;

describe("LayerList", () => {
  it("renders every row front to back in one flat list, background and mask last, no Document group", () => {
    const props = render(baseProps());
    expect(rowIds()).toEqual(props.rows.map((r) => r.layer.id).reverse());
    expect(rowIds().slice(-2)).toEqual(["mask", "background"]);
    expect(container.textContent).toContain("Layers");
    expect(container.textContent).not.toContain("Document");
    // No session-hide eye anywhere: enabled is the only visibility switch.
    expect(container.querySelector('[aria-label^="Hide "]')).toBeNull();
  });

  it("the power switch reports onToggle enabled, and a disabled layer renders dimmed", () => {
    const props = render(baseProps());
    const power = byLabel("Brand: enabled");
    expect(power.getAttribute("aria-pressed")).toBe("true");
    click(power);
    expect(props.onToggle).toHaveBeenCalledWith("wordmark", "enabled", false);
    // A switch never changes the selection.
    expect(props.onSelect).not.toHaveBeenCalled();

    const off = baseProps();
    off.rows = off.rows.map((r) =>
      r.layer.id === "wordmark" ? { layer: { ...r.layer, enabled: false } } : r);
    render(off);
    expect(byLabel("Brand: enabled").getAttribute("aria-pressed")).toBe("false");
    expect(rowFor("wordmark").querySelector(".opacity-50")).not.toBeNull();
    expect(rowFor("name").querySelector(".opacity-50")).toBeNull();
  });

  it("the lock switch reports onToggle with the flipped value", () => {
    const props = render(baseProps());
    click(byLabel("Brand: locked"));
    expect(props.onToggle).toHaveBeenCalledWith("wordmark", "locked", true);
  });

  it("badges a variant-added row with the variant's name and dims it while the variant is off", () => {
    render(baseProps());
    const lead = rowFor("collabLead");
    expect(lead.textContent).toContain("Lead-in");
    expect(lead.textContent).toContain("Collab");
    expect(lead.querySelector(".opacity-50")).not.toBeNull();

    const on = lolevRows(true);
    render(baseProps({ rows: on.rows, variants: on.variants }));
    expect(rowFor("collabLead").textContent).toContain("Collab");
    expect(rowFor("collabLead").querySelector(".opacity-50")).toBeNull();
    // A master row never carries a badge.
    expect(rowFor("wordmark").textContent).not.toContain("Collab");
  });

  it("no row has a fillable switch; every row has power and lock", () => {
    render(baseProps());
    expect(container.querySelectorAll('[aria-label$=": fillable"]')).toHaveLength(0);
    expect(byLabel("Background: enabled")).not.toBeNull();
    expect(byLabel("Brand: locked")).not.toBeNull();
  });

  it("clicking a row selects it with the modifier keys", () => {
    const props = render(baseProps());
    click(rowFor("wordmark").querySelector("button")!);
    expect(props.onSelect).toHaveBeenCalledWith("wordmark", { shift: false, meta: false });
    act(() => {
      rowFor("name").querySelector("button")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true, ctrlKey: true }));
    });
    expect(props.onSelect).toHaveBeenLastCalledWith("name", { shift: true, meta: true });
  });

  it("double-click renames inline: Enter commits through onRename, Escape cancels", () => {
    const props = render(baseProps());
    const nameSpan = rowFor("wordmark").querySelector("button span")!;
    expect(nameSpan.textContent).toBe("Brand");
    dblclick(nameSpan);
    const input = rowFor("wordmark").querySelector('input[aria-label="Rename Brand"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    input.value = "Renamed";
    keydown(input, "Enter");
    expect(props.onRename).toHaveBeenCalledWith("wordmark", "Renamed");
    expect(rowFor("wordmark").querySelector("input")).toBeNull();

    dblclick(rowFor("wordmark").querySelector("button span")!);
    const again = rowFor("wordmark").querySelector("input") as HTMLInputElement;
    again.value = "Should not stick";
    keydown(again, "Escape");
    expect(props.onRename).toHaveBeenCalledTimes(1);
    expect(rowFor("wordmark").querySelector("input")).toBeNull();
    expect(rowFor("wordmark").textContent).toContain("Brand");
  });

  it("Add layer → Text calls onAdd(\"text\")", async () => {
    const props = render(baseProps());
    await openMenu(byLabel("Add layer"));
    const item = menuItem("Text");
    expect(item).toBeDefined();
    await act(async () => { item.click(); await Promise.resolve(); });
    expect(props.onAdd).toHaveBeenCalledWith("text");
  });

  it("adds a layer directly to a variant without an editing mode", async () => {
    const props = render(baseProps());
    await openMenu(byLabel("Add layer"));
    const variant = menuItem("Collab");
    await act(async () => { variant.click(); await Promise.resolve(); });
    const textItems = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .filter((el) => el.textContent?.trim() === "Text");
    await act(async () => { (textItems.at(-1) as HTMLElement).click(); });
    expect(props.onAdd).toHaveBeenCalledWith("text", "collab");
  });

  it("the row menu's Remove calls onRemove", async () => {
    const props = render(baseProps());
    await openMenu(byLabel("Brand actions"));
    const item = menuItem("Remove");
    expect(item).toBeDefined();
    await act(async () => { item.click(); await Promise.resolve(); });
    expect(props.onRemove).toHaveBeenCalledWith("wordmark");
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("drags across multiple rows in one reorder and removes the arrow buttons", () => {
    const props = render(baseProps({ selected: ["wordmark"] }));
    expect(byLabel("Bring Brand forward")).toBeNull();
    const source = rowFor("wordmark").querySelector("button")!;
    source.setPointerCapture = vi.fn();
    const target = rowFor("barcode");
    const hit = vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 20, height: 20 } as DOMRect);
    const pointer = (type: string, y: number) => act(() => {
      source.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientY: y }));
    });
    try {
      pointer("pointerdown", 100);
      pointer("pointermove", 21);
      expect(props.onReorder).not.toHaveBeenCalled();
      pointer("pointerup", 21);
      const peers = props.rows.filter((r) => !r.variant);
      const distance = peers.findIndex((r) => r.layer.id === "barcode") - peers.findIndex((r) => r.layer.id === "wordmark");
      expect(props.onReorder).toHaveBeenCalledTimes(1);
      expect(props.onReorder).toHaveBeenCalledWith("wordmark", distance);
      // A drop outside the owning variant and a cancelled drag are no-ops.
      hit.mockReturnValue(rowFor("collabLeft"));
      pointer("pointerdown", 100);
      pointer("pointermove", 21);
      pointer("pointerup", 21);
      hit.mockReturnValue(target);
      pointer("pointerdown", 100);
      pointer("pointermove", 21);
      pointer("pointercancel", 21);
      pointer("pointerup", 21);
      expect(props.onReorder).toHaveBeenCalledTimes(1);
    } finally { vi.restoreAllMocks(); }
  });

  it("Delete and ⌥↑/⌥↓ on a selected row's button act on it; on an unselected row they do nothing", () => {
    const props = render(baseProps({ selected: ["wordmark"] }));
    const selectedButton = rowFor("wordmark").querySelector("button")!;
    keydown(selectedButton, "Delete");
    expect(props.onRemove).toHaveBeenCalledWith("wordmark");
    keydown(selectedButton, "ArrowUp", { altKey: true });
    expect(props.onReorder).toHaveBeenCalledWith("wordmark", 1);
    keydown(selectedButton, "ArrowDown", { altKey: true });
    expect(props.onReorder).toHaveBeenCalledWith("wordmark", -1);

    const other = rowFor("name").querySelector("button")!;
    keydown(other, "Delete");
    keydown(other, "ArrowUp", { altKey: true });
    expect(props.onRemove).toHaveBeenCalledTimes(1);
    expect(props.onReorder).toHaveBeenCalledTimes(2);
  });

  it("header chips: Edit master and one toggle per variant", () => {
    const props = render(baseProps());
    const toggle = byLabel("Edit master")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    click(toggle);
    expect(props.onEditMaster).toHaveBeenCalledWith(true);

    const chip = byLabel("Collab variant");
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    click(chip);
    expect(props.onToggleVariant).toHaveBeenCalledWith("collab");
  });

  it("every interactive control has an accessible name (a11y lens)", () => {
    // A selected row shows the most controls (reorder arrows included) and
    // an overridden master row adds the dot.
    const props = baseProps({ selected: ["wordmark"] });
    props.rows = props.rows.map((r) => r.layer.id === "logo" ? { ...r, overridden: true } : r);
    render(props);
    const controls = Array.from(container.querySelectorAll('button, input, [role="img"]'));
    expect(controls.length).toBeGreaterThan(20);
    for (const el of controls) {
      const name = el.getAttribute("aria-label") ?? el.getAttribute("aria-labelledby")
        ?? el.textContent?.trim();
      expect(name, `${el.tagName} ${el.className}`).toBeTruthy();
    }
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Overridden");
  });
});

it("measures repeated pointer moves over the same drop position", () => {
  const commits = vi.fn();
  const props = baseProps();
  act(() => root.render(createElement(SidebarProvider, null,
    createElement(Profiler, { id: "layers", onRender: commits }, createElement(LayerList, props)))));
  const source = rowFor("wordmark").querySelector("button")!;
  source.setPointerCapture = vi.fn();
  const target = rowFor("barcode");
  vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 20, height: 20 } as DOMRect);
  try {
    act(() => source.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientY: 100 })));
    commits.mockClear();
    const started = performance.now();
    for (let n = 0; n < 100; n++) act(() => source.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, pointerId: 1, clientY: 21 + n % 4,
    })));
    console.log("PERF layer drag", JSON.stringify({ moves: 100, commits: commits.mock.calls.length, ms: performance.now() - started }));
    expect(commits.mock.calls.length).toBe(1);
  } finally { vi.restoreAllMocks(); }
});

describe("ownership vs override", () => {
  it("a master layer an enabled variant overrides still reorders among master rows", () => {
    // layerRows sets `variant` on an overridden master layer too; that must
    // not move it into the variant's peer group (ultrareview finding, 2026-09-05).
    const { rows, variants } = lolevRows(true);
    const [collab] = variants;
    const overridden = rows.map((r) =>
      r.layer.id === "wordmark" ? { ...r, variant: collab, overridden: true } : r);
    const props = render(baseProps({ rows: overridden, variants, selected: ["wordmark"] }));
    const button = rowFor("wordmark").querySelector("button")!;
    keydown(button, "ArrowUp", { altKey: true });
    keydown(button, "ArrowDown", { altKey: true });
    // wordmark is neither front nor back of the master group, so both fire.
    expect(props.onReorder).toHaveBeenCalledWith("wordmark", 1);
    expect(props.onReorder).toHaveBeenCalledWith("wordmark", -1);
  });
});
