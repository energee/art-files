// layerlist-dom.test.tsx — DOM behavior of LayerList (src/components/
// LayerList.tsx): the one flat Layers list of the master-as-layers redesign.
// Props-only component, so the rows are built straight from the Lolev v3
// master data (model/lolevLayers.ts) with the collab variant's three layers
// appended as variant-added rows — no resolver in the loop. Scoped to a DOM
// environment per-file, matching tests/layerspanel-dom.test.tsx's setup — no
// @testing-library/react in this repo, so this drives real DOM nodes through
// react-dom/client + act, the same as that suite.
// @vitest-environment happy-dom
import { act, createElement } from "react";
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
    selected: new Set<string>(),
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    onRename: vi.fn(),
    onReorder: vi.fn(),
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    fillableOnly: false,
    onFillableOnly: vi.fn(),
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

  it("Fillable only hides every row whose layer is not fillable", () => {
    const props = render(baseProps({ fillableOnly: true }));
    const fillable = props.rows.filter((r) => r.layer.fillable).map((r) => r.layer.id).reverse();
    expect(fillable).toContain("name");
    expect(fillable).not.toContain("wordmark");
    expect(rowIds()).toEqual(fillable);
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

  it("lock and fillable switches report onToggle with the flipped value", () => {
    const props = render(baseProps());
    click(byLabel("Brand: locked"));
    expect(props.onToggle).toHaveBeenCalledWith("wordmark", "locked", true);
    click(byLabel("ABV: fillable"));
    expect(props.onToggle).toHaveBeenCalledWith("abv", "fillable", false);
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

  it("the background and mask rows have no fillable switch; every other row does", () => {
    render(baseProps());
    expect(byLabel("Background: fillable")).toBeNull();
    expect(byLabel("Metallic mask: fillable")).toBeNull();
    expect(byLabel("Background: enabled")).not.toBeNull();
    expect(byLabel("Brand: fillable")).not.toBeNull();
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

  // Reorder arrows live on the selected row only. The list shows front to
  // back, so ▲ = +1 (toward the front, later in draw order) and ▼ = -1; the
  // ends of the DRAW order are read off every row, not the filtered view.
  it("shows reorder arrows on the selected row, disabled at the ends of the draw order", () => {
    const { rows } = lolevRows();
    const master = rows.filter((r) => !r.variant);
    let props = render(baseProps({ rows: master, variants: [], selected: new Set(["barcode"]) }));
    expect(byLabel("Bring Brand forward")).toBeNull();
    expect(byLabel("Bring Barcode forward")).toHaveProperty("disabled", true);
    expect(byLabel("Send Barcode backward")).toHaveProperty("disabled", false);
    click(byLabel("Send Barcode backward"));
    expect(props.onReorder).toHaveBeenCalledWith("barcode", -1);

    props = render(baseProps({ rows: master, variants: [], selected: new Set(["background"]) }));
    expect(byLabel("Send Background backward")).toHaveProperty("disabled", true);
    click(byLabel("Bring Background forward"));
    expect(props.onReorder).toHaveBeenCalledWith("background", 1);

    // Filtered view: Description is still mid-order, so both arrows work.
    props = render(baseProps({ rows: master, variants: [], fillableOnly: true, selected: new Set(["description"]) }));
    expect(byLabel("Bring Description forward")).toHaveProperty("disabled", false);
    expect(byLabel("Send Description backward")).toHaveProperty("disabled", false);
  });

  it("Delete and ⌥↑/⌥↓ on a selected row's button act on it; on an unselected row they do nothing", () => {
    const props = render(baseProps({ selected: new Set(["wordmark"]) }));
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

  it("header chips: Fillable only and one toggle per variant", () => {
    const props = render(baseProps());
    const filter = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Fillable only")!;
    expect(filter.getAttribute("aria-pressed")).toBe("false");
    click(filter);
    expect(props.onFillableOnly).toHaveBeenCalledWith(true);

    const chip = byLabel("Collab variant");
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    click(chip);
    expect(props.onToggleVariant).toHaveBeenCalledWith("collab");
  });

  it("every interactive control has an accessible name (a11y lens)", () => {
    // A selected row shows the most controls (reorder arrows included) and
    // an overridden master row adds the dot.
    const props = baseProps({ selected: new Set(["wordmark"]) });
    props.rows = props.rows.map((r) => r.layer.id === "logo" ? { ...r, overridden: true } : r);
    render(props);
    const controls = Array.from(container.querySelectorAll('button, input, [role="img"]'));
    expect(controls.length).toBeGreaterThan(20);
    for (const el of controls) {
      const name = el.getAttribute("aria-label") ?? el.getAttribute("aria-labelledby")
        ?? el.textContent?.trim();
      expect(name, `${el.tagName} ${el.className}`).toBeTruthy();
    }
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Overridden by a variant");
  });
});
