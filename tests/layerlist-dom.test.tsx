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
import { LayerList, type LayerListProps } from "../src/components/LayerList";
import type { LayerRow, VariantChip } from "../src/model/rows";
import { SidebarProvider } from "../src/components/ui/sidebar";
import { lolevMaster } from "../src/model/lolevLayers";
import type { Layer } from "../src/model/layers";

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
  const { rows } = lolevRows();
  return {
    rows,
    selected: [],
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    onRename: vi.fn(),
    onReorder: vi.fn(),
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    changedOnly: false,
    onChangedOnly: vi.fn(),
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

  it("Changed hides every row this label has not touched", () => {
    const base = baseProps();
    const rows = base.rows.map((r) => (r.layer.id === "name" ? { ...r, changed: true } : r));
    render({ ...base, rows, changedOnly: true });
    expect(rowIds()).toEqual(["name"]);
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
    // Dimmed with muted ink, not row opacity: opacity-50 multiplied into the
    // badge's own /70 and composited text under 4.5:1 (#440).
    expect(rowFor("wordmark").querySelector(".opacity-50")).toBeNull();
    expect(rowFor("wordmark").querySelector(".text-muted-foreground")).not.toBeNull();
    expect(rowFor("name").querySelector(".text-muted-foreground")).toBeNull();
  });

  it("keeps an inactive row's muted ink when it is selected or hovered (#440)", () => {
    const off = baseProps({ selected: ["wordmark"] });
    off.rows = off.rows.map((r) =>
      r.layer.id === "wordmark" ? { layer: { ...r.layer, enabled: false } } : r);
    render(off);
    const button = rowFor("wordmark").querySelector('[data-sidebar="menu-button"]')!;
    const row = button.parentElement!;
    for (const el of [row, button]) {
      expect(el.className).not.toMatch(/(^|\s)opacity-50/);
      expect(el.className).not.toMatch(/(^|\s)text-sidebar-accent-foreground/);
      expect(el.className).not.toMatch(/hover:text-sidebar-accent-foreground/);
      expect(el.className).toContain("text-muted-foreground");
    }
    expect(button.className).not.toMatch(/data-active:text-sidebar-accent-foreground/);
    expect(button.className).not.toMatch(/active:text-sidebar-accent-foreground/);
  });

  it("a locked row's lock unlocks it; the row menu locks one", async () => {
    const props = baseProps();
    props.rows = props.rows.map((r) => r.layer.id === "wordmark" ? { ...r, layer: { ...r.layer, locked: true } } : r);
    render(props);
    expect(byLabel("Brand: locked").title).toMatch(/Click to unlock\.$/);
    click(byLabel("Brand: locked"));
    expect(props.onToggle).toHaveBeenCalledWith("wordmark", "locked", false);
    // The lock goes away once unlocked; focus lands on the row's power.
    expect(document.activeElement).toBe(byLabel("Brand: enabled"));
    await act(async () => {
      rowFor("name").firstElementChild!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await act(async () => { menuItem("Lock").click(); await Promise.resolve(); });
    expect(props.onToggle).toHaveBeenCalledWith("name", "locked", true);
  });

  // #11: the lock is canvas-only, so the row must not promise "cannot be moved".
  it("titles a locked row's lock as canvas-only", () => {
    const props = baseProps();
    props.rows = props.rows.map((r) => r.layer.id === "wordmark" ? { ...r, layer: { ...r.layer, locked: true } } : r);
    render(props);
    expect(byLabel("Brand: locked").getAttribute("title"))
      .toBe("Locked on canvas: drag, resize and nudge are off. Typed values still apply. Click to unlock.");
  });

  it("badges a variant-added row with the variant's name and dims it while the variant is off", () => {
    render(baseProps());
    const lead = rowFor("collabLead");
    expect(lead.textContent).toContain("Lead-in");
    expect(lead.textContent).toContain("Collab");
    expect(lead.querySelector(".opacity-50")).toBeNull();
    expect(lead.querySelector(".text-muted-foreground")).not.toBeNull();

    const on = lolevRows(true);
    render(baseProps({ rows: on.rows }));
    expect(rowFor("collabLead").textContent).toContain("Collab");
    expect(rowFor("collabLead").querySelector(".text-muted-foreground")).toBeNull();
    // A master row never carries a badge.
    expect(rowFor("wordmark").textContent).not.toContain("Collab");
  });

  it("inks the variant badge with the row's muted colour while off, /70 while on, never struck through (#440)", () => {
    const badgeClass = () => Array.from(rowFor("collabLead").querySelectorAll("span[title]"))
      .find((el) => el.textContent === "Collab")!.className;
    render(baseProps());
    // Off: inherits the inactive row's muted ink, no extra alpha on top. The
    // dimmed row and its power-off icon already say "off"; a struck badge
    // read as "deleted".
    expect(badgeClass()).not.toContain("text-sidebar-foreground/70");
    expect(badgeClass()).not.toContain("/40");
    expect(badgeClass()).not.toContain("line-through");

    render(baseProps({ rows: lolevRows(true).rows }));
    expect(badgeClass()).toContain("text-sidebar-foreground/70");
  });

  it("titles the variant chip by what the variant does: adds the layer, or changes a master one", () => {
    // layerRows sets `variant` on BOTH a layer the variant adds and a master
    // layer it only overrides (then with `variantOverridden`); the chip said
    // "Added by" for both (#102).
    const on = lolevRows(true);
    const collab = on.variants[0];
    render(baseProps({ rows: on.rows.map((r) =>
      r.layer.id === "logo" ? { ...r, variant: collab, variantOverridden: collab } : r) }));
    const chipTitle = (id: string) => Array.from(rowFor(id).querySelectorAll("span[title]"))
      .find((el) => el.textContent === "Collab")?.getAttribute("title");
    expect(chipTitle("logo")).toBe("Changed by the Collab variant");
    expect(chipTitle("collabLead")).toBe("Added by the Collab variant");

    render(baseProps());
    expect(chipTitle("collabLead")).toBe("Added by the Collab variant (off)");
  });

  it("no row carries a fillable switch any more — every layer is fillable", () => {
    render(baseProps());
    expect(byLabel("Brand: fillable")).toBeNull();
    expect(byLabel("ABV: fillable")).toBeNull();
    expect(byLabel("Background: enabled")).not.toBeNull();
  });

  it("clicking a row selects it with the modifier keys", () => {
    const props = render(baseProps());
    click(rowFor("wordmark").querySelector("button")!);
    expect(props.onSelect).toHaveBeenCalledWith("wordmark", { shift: false, toggle: false });
    act(() => {
      rowFor("name").querySelector("button")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true, ctrlKey: true }));
    });
    expect(props.onSelect).toHaveBeenLastCalledWith("name", { shift: true, toggle: true });
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

  it("double-click renames even though pointerdown captured the pointer on the row button (#115)", () => {
    // In a real browser the row button's pointerdown calls setPointerCapture,
    // so the dblclick that follows is targeted at the BUTTON, never at the
    // name span inside it. happy-dom doesn't retarget, so pin that the button
    // is the capture target, then send the dblclick where Chrome sends it.
    render(baseProps());
    const button = rowFor("barcode").querySelector("button")!;
    button.setPointerCapture = vi.fn();
    act(() => { button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0 })); });
    expect(button.setPointerCapture).toHaveBeenCalledWith(1);
    dblclick(button);
    expect(rowFor("barcode").querySelector('input[aria-label="Rename Barcode"]')).not.toBeNull();
  });

  it("Add layer → Text calls onAdd(\"text\")", async () => {
    const props = render(baseProps());
    await openMenu(byLabel("Add layer"));
    const item = menuItem("Text");
    expect(item).toBeDefined();
    await act(async () => { item.click(); await Promise.resolve(); });
    expect(props.onAdd).toHaveBeenCalledWith("text");
  });

  it("has one Add layer, which targets whatever version the Select names", async () => {
    // It used to carry a submenu per variant. The master Select decides the
    // working version now, and App routes the add there.
    const props = render(baseProps());
    await openMenu(byLabel("Add layer"));
    expect(menuItem("Collab")).toBeUndefined();
    await act(async () => { menuItem("Text")!.click(); });
    expect(props.onAdd).toHaveBeenCalledWith("text");
  });

  it("the selected row's Remove button calls onRemove", () => {
    const props = render(baseProps({ selected: ["wordmark"] }));
    click(byLabel("Brand: remove"));
    expect(props.onRemove).toHaveBeenCalledWith("wordmark");
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("colours Remove destructive, not a solid fill (docs/plans/template-switch.md, Task 3)", () => {
    render(baseProps({ selected: ["wordmark"] }));
    expect(byLabel("Brand: remove").className).toContain("hover:text-destructive-text");
  });

  it("colours the overridden/changed marks info, not primary (docs/plans/template-switch.md, Task 3)", () => {
    const collab = { id: "collab", name: "Collab", enabled: true };
    const props = baseProps();
    props.rows = props.rows.map((r) =>
      r.layer.id === "logo" ? { ...r, variantOverridden: collab }
        : r.layer.id === "name" ? { ...r, changed: true } : r);
    render(props);
    const marks = Array.from(container.querySelectorAll('[role="img"]')) as HTMLElement[];
    const overridden = marks.find((el) => el.getAttribute("aria-label") === "Collab changes this layer")!;
    const changed = marks.find((el) => el.getAttribute("aria-label") === "Changed in this label")!;
    expect(overridden.className).toContain("text-info-text");
    expect(changed.className).toContain("text-info-text");
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

  it("header chips: Changed and one toggle per variant", () => {
    const props = render(baseProps());
    const filter = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Changed")!;
    expect(filter.getAttribute("aria-pressed")).toBe("false");
    click(filter);
    expect(props.onChangedOnly).toHaveBeenCalledWith(true);

    // The variant chips are gone: the master Select names the version, and
    // what it names is what the canvas draws.
    expect(byLabel("Collab variant")).toBeNull();
  });

  it("every interactive control has an accessible name (a11y lens)", () => {
    // A selected row shows the most controls (reorder arrows included); a row
    // a variant changes and one this label changed add their two marks.
    const props = baseProps({ selected: ["wordmark"] });
    const collab = { id: "collab", name: "Collab", enabled: true };
    props.rows = props.rows.map((r) =>
      r.layer.id === "logo" ? { ...r, variantOverridden: collab }
        : r.layer.id === "name" ? { ...r, changed: true } : r);
    render(props);
    const controls = Array.from(container.querySelectorAll('button, input, [role="img"]'));
    expect(controls.length).toBeGreaterThan(20);
    for (const el of controls) {
      const name = el.getAttribute("aria-label") ?? el.getAttribute("aria-labelledby")
        ?? el.textContent?.trim();
      expect(name, `${el.tagName} ${el.className}`).toBeTruthy();
    }
    // The two provenance marks name their source; the old single dot claimed
    // "Overridden by a variant" for a label edit too.
    const marks = Array.from(container.querySelectorAll('[role="img"]'))
      .map((el) => el.getAttribute("aria-label"));
    expect(marks).toContain("Collab changes this layer");
    expect(marks).toContain("Changed in this label");
  });
});

describe("sidebar UX pass (docs/plans/sidebar-ux.md)", () => {
  const rowBox = (id: string) => rowFor(id).firstElementChild as HTMLElement;

  it("marks the selected row with a primary tint, not the hover grey and no edge bar", () => {
    render(baseProps({ selected: ["name"] }));
    expect(rowBox("name").className).toContain("bg-sidebar-primary/15");
    expect(rowBox("name").className).not.toContain("shadow-");
    expect(rowBox("wordmark").className).not.toContain("bg-sidebar-primary/15");
    // The button must not paint the old accent over the row's tint.
    const button = rowFor("name").querySelector('[data-sidebar="menu-button"]')!;
    expect(button.className).toContain("data-active:bg-transparent");
    // Nor ring the name: the tint is the row's one mark.
    expect(button.className).toContain("focus-visible:ring-0");
  });

  it("shows the exception: power-off while off, the lock while locked, else only on hover", () => {
    const props = baseProps();
    props.rows = props.rows.map((r) =>
      r.layer.id === "wordmark" ? { layer: { ...r.layer, enabled: false, locked: true } } : r);
    render(props);
    const offPower = byLabel("Brand: enabled");
    expect(offPower.dataset.state).toBe("off");
    expect(offPower.className).not.toContain("opacity-0");
    expect(byLabel("Brand: locked").className).not.toContain("opacity-0");
    // A normal row's switches wait for hover or focus.
    expect(byLabel("Name: enabled").dataset.state).toBe("on");
    expect(byLabel("Name: enabled").className).toContain("opacity-0");
    // An unlocked row has no lock at all: lock from the inspector or the row menu.
    expect(byLabel("Name: locked")).toBeNull();
    // A variant-added row whose variant is off is off too.
    expect(byLabel("Lead-in: enabled").dataset.state).toBe("off");
    // Ink strength = on: the off icon wears the row's muted ink, even under
    // the pointer, so switching off never makes the icon darker.
    expect(offPower.className).toContain("text-muted-foreground");
    expect(offPower.className).toContain("hover:text-muted-foreground");
    expect(byLabel("Name: enabled").className).not.toContain("text-muted-foreground");
    expect(byLabel("Name: enabled").className).toMatch(/(^|\s)text-sidebar-foreground(\s|$)/);
  });

  it("sizes every row switch to a 24px target", () => {
    render(baseProps({ selected: ["name"] }));
    for (const label of ["Name: enabled", "Name: rename", "Name: remove"])
      expect(byLabel(label).className).toContain("size-6");
  });

  it("puts the Changed filter in the Layers header and drops the multi-select hint", () => {
    render(baseProps({ selected: ["name"] }));
    const header = container.querySelector('[data-slot="sidebar-group-label"]')!;
    expect(Array.from(header.querySelectorAll("button")).map((b) => b.textContent?.trim()))
      .toContain("Changed");
    expect(container.textContent).not.toMatch(/click for a range|Shift-click/);
  });

  it("scrolls a newly selected row into view", () => {
    const spy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      const props = render(baseProps());
      expect(spy).not.toHaveBeenCalled();
      render({ ...props, selected: ["name"] });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({ block: "nearest" });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("renames from the selected row's Rename button without reselecting", () => {
    const props = render(baseProps({ selected: ["wordmark"] }));
    click(byLabel("Brand: rename"));
    expect(rowFor("wordmark").querySelector('input[aria-label="Rename Brand"]')).not.toBeNull();
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  const controls = (id: string) => Array.from(rowBox(id).querySelectorAll(":scope > button[aria-label]"))
    .map((b) => b.getAttribute("aria-label"));

  it("shows Rename and Remove on the selected row only, always visible there; power at the right edge", () => {
    render(baseProps({ selected: ["name"] }));
    expect(controls("name")).toEqual(["Name: rename", "Name: remove", "Name: enabled"]);
    expect(byLabel("Name: rename").className).not.toContain("opacity-0");
    // Its power is shown at full ink too, never fainter than an off icon.
    expect(byLabel("Name: enabled").className).not.toMatch(/opacity-(0|40)(\s|$)/);
    expect(byLabel("Name: remove").className).not.toContain("opacity-0");
    // Hovering any other row shows just its power.
    expect(controls("wordmark")).toEqual(["Brand: enabled"]);
  });

  it("opens Rename / Remove on right-click", async () => {
    const props = render(baseProps());
    await act(async () => {
      rowBox("wordmark").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
      await Promise.resolve();
    });
    expect(menuItem("Rename")).toBeDefined();
    await act(async () => { menuItem("Remove").click(); await Promise.resolve(); });
    expect(props.onRemove).toHaveBeenCalledWith("wordmark");
  });

  // Light theme: muted on primary/20 is 4.29:1, under #440's 4.5:1 floor.
  it("holds an off row's selected tint on hover, so its muted ink keeps 4.5:1 (#440)", () => {
    const props = baseProps({ selected: ["wordmark", "name"] });
    props.rows = props.rows.map((r) =>
      r.layer.id === "wordmark" ? { layer: { ...r.layer, enabled: false } } : r);
    render(props);
    expect(rowBox("wordmark").className).toContain("hover:bg-sidebar-primary/15");
    expect(rowBox("wordmark").className).not.toContain("hover:bg-sidebar-primary/20");
    expect(rowBox("name").className).toContain("hover:bg-sidebar-primary/20");
  });

  it("the Remove button hands focus on like the Delete key, not to the page", async () => {
    const { rows } = lolevRows();
    const two = rows.slice(0, 2);
    const props = baseProps({ rows: two, selected: [two[1].layer.id] });
    props.onRemove = vi.fn(() => render({ ...props, rows: [two[0]], selected: [] }));
    render(props);
    const remove = byLabel(`${two[1].layer.name}: remove`);
    remove.focus();
    click(remove);
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(rowFor(two[0].layer.id).querySelector('[data-slot="sidebar-menu-button"]'));
  });

  it("right-click in the rename field keeps editing; no row menu opens over it", async () => {
    const props = render(baseProps({ selected: ["wordmark"] }));
    click(byLabel("Brand: rename"));
    const input = rowFor("wordmark").querySelector("input")!;
    await act(async () => {
      input.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(menuItem("Rename")).toBeUndefined();
    expect(rowFor("wordmark").querySelector("input")).not.toBeNull();
    expect(props.onRename).not.toHaveBeenCalled();
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
    // A "nested-update" is a layout-effect re-render inside the same commit
    // (Base UI 1.8 adds one); the guard is one top-level commit per position.
    expect(commits.mock.calls.filter((c) => c[1] !== "nested-update").length).toBe(1);
  } finally { vi.restoreAllMocks(); }
});

describe("ownership vs override", () => {
  it("a master layer an enabled variant overrides still reorders among master rows", () => {
    // layerRows sets `variant` on an overridden master layer too; that must
    // not move it into the variant's peer group (ultrareview finding, 2026-09-05).
    const { rows, variants } = lolevRows(true);
    const [collab] = variants;
    const overridden = rows.map((r) =>
      r.layer.id === "wordmark" ? { ...r, variant: collab, variantOverridden: collab } : r);
    const props = render(baseProps({ rows: overridden, selected: ["wordmark"] }));
    const button = rowFor("wordmark").querySelector("button")!;
    keydown(button, "ArrowUp", { altKey: true });
    keydown(button, "ArrowDown", { altKey: true });
    // wordmark is neither front nor back of the master group, so both fire.
    expect(props.onReorder).toHaveBeenCalledWith("wordmark", 1);
    expect(props.onReorder).toHaveBeenCalledWith("wordmark", -1);
  });
});

// Every workspace tab mounts its own LayerList, so a document-wide lookup for
// "Add layer" found the FIRST tab's (hidden) button, not this list's.
it("Delete of the only row focuses this list's Add layer, not another tab's", async () => {
  const decoy = document.createElement("button");
  decoy.setAttribute("aria-label", "Add layer");
  document.body.prepend(decoy);
  try {
    const { rows } = lolevRows();
    const only = [rows[0]];
    const props = baseProps({ rows: only, selected: [only[0].layer.id] });
    props.onRemove = vi.fn(() => render({ ...props, rows: [], selected: [] }));
    render(props);
    const button = rowFor(only[0].layer.id).querySelector("button")!;
    button.focus();
    keydown(button, "Delete");
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(byLabel("Add layer"));
  } finally { decoy.remove(); }
});

// A live region only speaks when its text changes: a second identical
// "moved forward" was silent.
it("announces each of two identical reorders", () => {
  render(baseProps({ selected: ["wordmark"] }));
  const status = container.querySelector('[role="status"]')!;
  const button = rowFor("wordmark").querySelector("button")!;
  keydown(button, "ArrowUp", { altKey: true });
  const first = status.textContent;
  keydown(button, "ArrowUp", { altKey: true });
  expect(first).toContain("moved forward");
  expect(status.textContent).toContain("moved forward");
  expect(status.textContent).not.toBe(first);
});
