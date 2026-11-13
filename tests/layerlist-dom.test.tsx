// layerlist-dom.test.tsx — DOM behavior of LayerList (src/components/
// LayerList.tsx): the one flat Layers list of the master-as-layers redesign.
// Props-only component, so the rows are built straight from the Lolev v3
// master data (tests/fixtures/lolevMaster.ts) with the collab variant's three layers
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
import { lolevMaster } from "./fixtures/lolevMaster";
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
    onReset: vi.fn(),
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
  });

  // The list is for building a label: it does not report what the label
  // changed from its master (that is the Save Master review's job).
  it("carries no changed or variant-override mark, and no Changed filter", () => {
    const collab = { id: "collab", name: "Collab", enabled: true };
    const props = baseProps();
    props.rows = props.rows.map((r) =>
      r.layer.id === "logo" ? { ...r, variantOverridden: collab }
        : r.layer.id === "name" ? { ...r, overridden: true } : r);
    render(props);
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(0);
    const header = container.querySelector('[data-slot="sidebar-group-label"]')!;
    expect(Array.from(header.querySelectorAll("button")).map((b) => b.textContent?.trim())).toEqual(["Add layer"]);
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

  // A lock is a state mark: only a locked row shows one. Locking is in the
  // row menu and the inspector header.
  it("shows a lock only on a locked row; clicking it unlocks and keeps focus on the row", () => {
    const props = baseProps();
    props.rows = props.rows.map((row) => row.layer.id === "wordmark"
      ? { ...row, layer: { ...row.layer, locked: true } } : row.layer.id === "name"
        ? { ...row, layer: { ...row.layer, locked: false } } : row);
    props.onToggle = vi.fn((id, prop, value) => {
      props.rows = props.rows.map((row) => row.layer.id === id
        ? { ...row, layer: { ...row.layer, [prop]: value } } : row);
      render(props);
    });
    render(props);
    expect(byLabel("Name: locked")).toBeNull();
    const lock = byLabel("Brand: locked");
    expect(lock.getAttribute("aria-pressed")).toBe("true");
    lock.focus();
    click(lock);
    expect(props.onToggle).toHaveBeenCalledWith("wordmark", "locked", false);
    expect(byLabel("Brand: locked")).toBeNull();
    expect(document.activeElement).toBe(rowFor("wordmark").querySelector('[data-slot="sidebar-menu-button"]'));
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  // Page art can't be dragged, so a lock does nothing there: no lock icon
  // (the shipped background and mask are locked) and no Lock menu item.
  it("offers no lock on page art", async () => {
    render(baseProps());
    expect(byLabel("Background: locked")).toBeNull();
    expect(byLabel("Metallic mask: locked")).toBeNull();
    await act(async () => {
      rowFor("background").firstElementChild!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(menuItem("Rename")).toBeDefined();
    expect(menuItem("Lock")).toBeUndefined();
    expect(menuItem("Unlock")).toBeUndefined();
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
    expect(input.matches("[data-draft]")).toBe(true); // commitFieldDraft can reach it (#684)
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

  // Remove is one button for the whole selection, in the inspector header
  // (plus Delete and the row menu), not a trash on every selected row.
  it("has no Remove button on a selected row", () => {
    render(baseProps({ selected: ["wordmark", "name"] }));
    expect(byLabel("Brand: remove")).toBeNull();
    expect(container.querySelector('[aria-label$=": remove"]')).toBeNull();
  });

  // Message-toasts row 13: with the header pill gone, the invalid layer's row
  // is the standing sign that export is blocked — tinted, not just dotted.
  it("marks an invalid row red and names the reason", () => {
    render(baseProps({ invalid: new Map([["barcode", "Needs 12 digits"]]) }));
    const row = rowFor("barcode");
    const box = row.firstElementChild as HTMLElement;
    expect(row.hasAttribute("data-invalid")).toBe(true);
    expect(box.className).toContain("bg-destructive/10");
    expect(box.className).toContain("text-destructive-text");
    // The reason leads the name button's tooltip (the drag hint follows) and
    // is the dot's; the dot keeps its accessible name.
    expect(row.querySelector("button")!.getAttribute("title")).toMatch(/^Needs 12 digits/);
    const dot = row.querySelector('[role="img"][aria-label="Invalid value"]')!;
    expect(dot.getAttribute("title")).toBe("Needs 12 digits");

    // A valid row carries none of it.
    const valid = rowFor("name");
    expect(valid.hasAttribute("data-invalid")).toBe(false);
    expect((valid.firstElementChild as HTMLElement).className).not.toContain("destructive");
    expect(valid.querySelector("button")!.getAttribute("title")).not.toContain("Needs 12 digits");
    expect(valid.querySelector('[aria-label="Invalid value"]')).toBeNull();
  });

  // `title` is a mouse tooltip; assistive tech gets the reason and the drag hint
  // from a visually hidden element the name button points at (aria-describedby
  // replaces the title as the description, so it must carry both), outside the
  // button so they are not also read as part of its name. Each row owns its own.
  it("gives each invalid row's name button the reason and the drag hint as its accessible description", () => {
    render(baseProps({ invalid: new Map([["barcode", "Needs 12 digits"], ["name", "Too long"]]) }));
    /** What aria-describedby resolves to, the way assistive tech reads it. */
    const description = (el: Element) => (el.getAttribute("aria-describedby") ?? "")
      .split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
    const hint = /Drag to reorder · Alt\+↑\/↓ · .+ for a range, .+ to add$/;

    const barcode = rowFor("barcode").querySelector("button")!;
    const name = rowFor("name").querySelector("button")!;
    expect(description(barcode)).toMatch(/^Needs 12 digits · Drag to reorder/);
    expect(description(barcode)).toMatch(hint);
    expect(description(name)).toMatch(/^Too long · Drag to reorder/);
    expect(description(name)).toMatch(hint);
    // Two invalid rows, two descriptions: neither points at the other's.
    expect(barcode.getAttribute("aria-describedby")).not.toBe(name.getAttribute("aria-describedby"));
    expect(barcode.textContent).not.toContain("Needs 12 digits");
    expect(name.textContent).not.toContain("Too long");
    // The dot keeps its own "Invalid value" semantics.
    expect(barcode.querySelector('[role="img"][aria-label="Invalid value"]')).not.toBeNull();

    // A valid row has no description element; its title (the drag hint) is its description.
    const valid = rowFor("wordmark").querySelector("button")!;
    expect(valid.hasAttribute("aria-describedby")).toBe(false);
    expect(valid.getAttribute("title")).toMatch(hint);
  });

  it("keeps a selected invalid row distinct from an unselected one, and both inked red", () => {
    render(baseProps({ selected: ["barcode"], invalid: new Map([["barcode", "Needs 12 digits"], ["name", "Too long"]]) }));
    const selected = (rowFor("barcode").firstElementChild as HTMLElement).classList;
    const other = (rowFor("name").firstElementChild as HTMLElement).classList;
    // Selected: the hover tint plus a ring, so selection reads over the red
    // (a deeper tint would drop destructive-text under 4.5:1 in dark).
    expect(selected.contains("bg-destructive/15")).toBe(true);
    expect(selected.contains("ring-sidebar-primary")).toBe(true);
    expect(selected.contains("text-destructive-text")).toBe(true);
    expect(other.contains("bg-destructive/10")).toBe(true);
    expect(other.contains("text-destructive-text")).toBe(true);
    expect(other.contains("ring-sidebar-primary")).toBe(false);
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

  it("has no variant chips in the header", () => {
    render(baseProps());
    // The master Select names the version, and what it names is what the
    // canvas draws.
    expect(byLabel("Collab variant")).toBeNull();
  });

  it("every interactive control has an accessible name (a11y lens)", () => {
    const props = baseProps({ selected: ["wordmark"] });
    render(props);
    const controls = Array.from(container.querySelectorAll('button, input, [role="img"]'));
    expect(controls.length).toBeGreaterThan(20);
    for (const el of controls) {
      const name = el.getAttribute("aria-label") ?? el.getAttribute("aria-labelledby")
        ?? el.textContent?.trim();
      expect(name, `${el.tagName} ${el.className}`).toBeTruthy();
    }
  });
});

describe("sidebar UX pass (docs/plans/sidebar-ux.md)", () => {
  const rowBox = (id: string) => rowFor(id).firstElementChild as HTMLElement;


  it("keeps the multi-select hint out of the list", () => {
    render(baseProps({ selected: ["name"] }));
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


  const rightClick = (id: string) => act(async () => {
    rowBox(id).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    await Promise.resolve();
  });
  const menuItems = () => Array.from(document.querySelectorAll('[role="menuitem"]'))
    .map((el) => el.textContent?.trim());
  const pick = (text: string) => act(async () => {
    Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .find((el) => el.textContent?.trim().startsWith(text))!.click();
    await Promise.resolve();
  });

  // The row menu is the complete list of what you can do to a layer.
  it("right-click selects the row and lists every layer action", async () => {
    const props = render(baseProps());
    await rightClick("wordmark");
    expect(props.onSelect).toHaveBeenCalledWith("wordmark", {});
    expect(menuItems()).toEqual([
      "Rename", "Hide", "Lock", "Bring Forward⌥↑", "Send Backward⌥↓", "Reset to Master", "Remove⌫",
    ]);
    await pick("Remove");
    expect(props.onRemove).toHaveBeenCalledWith("wordmark");
  });

  it("right-click selects through the menu's opening, as a long-press does", async () => {
    const props = render(baseProps());
    await rightClick("wordmark");
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith("wordmark", {});
  });

  // Pins the outcome only: the real-browser failures (the closing menu's
  // focus return taking the box) don't happen in happy-dom; the CDP probe
  // in .agents/mockups/phone-touch-paths/ measures them.
  it("Rename from the menu leaves a focused rename box once the menu has closed", async () => {
    render(baseProps({ selected: ["barcode"] }));
    await rightClick("barcode");
    // A pointer reaches the item before it presses; a bare click() would
    // make it the active item there and then, which focuses it a frame later.
    // movementX: Base UI ignores a WebKit mousemove that does not move.
    const item = menuItem("Rename");
    for (const type of ["pointerover", "pointerenter", "pointermove", "mousemove"])
      act(() => { item.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "mouse", movementX: 1 })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    await pick("Rename");
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const input = rowFor("barcode").querySelector('input[aria-label="Rename Barcode"]');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("the row menu hides, locks, reorders and resets", async () => {
    const base = baseProps({ selected: ["name"] });
    const props = render({ ...base, rows: base.rows.map((r) =>
      r.layer.id === "name" ? { layer: { ...r.layer, locked: false }, overridden: true } : r) });
    await rightClick("name");
    await pick("Hide");
    expect(props.onToggle).toHaveBeenLastCalledWith("name", "enabled", false);
    await rightClick("name");
    await pick("Lock");
    expect(props.onToggle).toHaveBeenLastCalledWith("name", "locked", true);
    await rightClick("name");
    await pick("Bring Forward");
    expect(props.onReorder).toHaveBeenLastCalledWith("name", 1);
    await rightClick("name");
    await pick("Reset to Master");
    expect(props.onReset).toHaveBeenCalledWith("name");
  });

  it("Reset to Master is off for a layer this label has not restyled", async () => {
    const props = render(baseProps({ selected: ["name"] }));
    await rightClick("name");
    const reset = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .find((el) => el.textContent?.trim() === "Reset to Master")!;
    expect(reset.getAttribute("aria-disabled")).toBe("true");
    await act(async () => { reset.click(); await Promise.resolve(); });
    expect(props.onReset).not.toHaveBeenCalled();
  });

  // A right-click inside a multi-selection keeps it, and a name is one
  // layer's, so Rename is not offered.
  it("right-click on one of several selected rows keeps the selection and offers no Rename", async () => {
    const props = render(baseProps({ selected: ["wordmark", "name"] }));
    await rightClick("name");
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(menuItems()).not.toContain("Rename");
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

  it("right-click in the rename field keeps editing; no row menu opens over it", async () => {
    const props = render(baseProps({ selected: ["wordmark"] }));
    dblclick(rowFor("wordmark").querySelector("button span")!);
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

// A drag or scrub re-resolves every layer per move: the list must sit out
// whatever its rows do not draw, and take everything they do.
describe("what re-renders the list (#716)", () => {
  const { compare } = LayerList as unknown as { compare: (a: LayerListProps, b: LayerListProps) => boolean };
  const props = baseProps();
  const target = props.rows.find((row) => row.layer.kind === "text" && !row.layer.locked);
  const editing = (change: (row: LayerRow) => LayerRow) =>
    ({ ...props, rows: props.rows.map((row) => (row === target ? change(row) : { ...row, layer: { ...row.layer } })) });
  const layer = (over: object) => (row: LayerRow) => ({ ...row, layer: { ...row.layer, ...over } as Layer });

  it.each([
    ["position", { x: 12, y: 34 }], ["guide", { guideX: "left", anchor: "left" }], ["size", { size: 99, w: 99 }],
    ["style", { style: { fill: "#123456", layer: "white" } }], ["content", { lines: [], value: "1" }],
  ])("skips a change to the layer's %s", (_name, over) => {
    expect(compare(props, editing(layer(over)))).toBe(true);
  });

  const chip: VariantChip = { id: "collab", name: "Collab", enabled: true };
  it.each<[string, (row: LayerRow) => LayerRow]>([
    ["name", layer({ name: "Renamed" })], ["power", layer({ enabled: false })], ["lock", layer({ locked: true })],
    ["kind", layer({ kind: "qr" })], ["role", layer({ kind: "image", role: "mask" })],
    ["variant chip", (row) => ({ ...row, variant: chip })],
    ["variant override", (row) => ({ ...row, variantOverridden: chip })],
    ["label override", (row) => ({ ...row, overridden: true })],
  ])("redraws for the row's %s", (_name, change) => {
    expect(compare(props, editing(change))).toBe(false);
  });

  it("redraws when a chip's own state or the order changes", () => {
    const on = { ...props, rows: props.rows.map((row) => ({ ...row, variant: chip })) };
    const off = { ...props, rows: on.rows.map((row) => ({ ...row, variant: { ...chip, enabled: false } })) };
    expect(compare(on, off)).toBe(false);
    expect(compare(props, { ...props, rows: props.rows.slice().reverse() })).toBe(false);
  });
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

describe("on a touch screen", () => {
  const realMatchMedia = window.matchMedia.bind(window);
  beforeEach(() => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) => realMatchMedia(q === "(pointer: coarse)" ? "(min-width: 0px)" : q));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  const nameButton = (id: string) => rowFor(id).querySelector('[data-slot="sidebar-menu-button"]') as HTMLButtonElement;
  /** One finger's touch event; touchend lifts it. Base UI reads `touches`. */
  const finger = (el: Element, type: "touchstart" | "touchmove" | "touchend", x = 40, y = 40) => act(() => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: y }] });
    el.dispatchEvent(e);
  });
  const wait = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); await Promise.resolve(); });
  const press = (el: Element, type: string, y: number, pointerType = "touch") => act(() => {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: 40, clientY: y, pointerType }));
  });
  const menuItems = () => Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent?.trim());

  it("a long-press on a row selects it and opens its menu", async () => {
    const props = render(baseProps());
    finger(nameButton("wordmark"), "touchstart");
    await wait(499);
    expect(menuItems()).toEqual([]);
    await wait(1);
    expect(props.onSelect).toHaveBeenCalledWith("wordmark", {});
    expect(menuItems()).toContain("Rename");
  });

  // Review Focus 2
  it("a finger that moves 11px before the long-press delay opens no menu", async () => {
    const props = render(baseProps());
    finger(nameButton("wordmark"), "touchstart", 40, 40);
    finger(nameButton("wordmark"), "touchmove", 40, 51);
    await wait(600);
    expect(menuItems()).toEqual([]);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  // Review Focus 1
  it("a long-press held then dragged opens the menu and reorders nothing", async () => {
    const props = render(baseProps());
    const name = nameButton("wordmark");
    name.setPointerCapture = vi.fn();
    press(name, "pointerdown", 40);
    finger(name, "touchstart");
    await wait(500);
    press(name, "pointermove", 140);
    press(name, "pointerup", 140);
    finger(name, "touchend");
    expect(name.setPointerCapture).not.toHaveBeenCalled();
    expect(props.onReorder).not.toHaveBeenCalled();
    expect(menuItems()).toContain("Rename");
  });

  // The finger's lift after a long-press arrives as a click on the row: it
  // must not select again, nor reach the Layers overlay, which closes on a
  // row click.
  it("a click that follows a long-press neither selects again nor reaches the list", async () => {
    const outside = vi.fn();
    const props = baseProps();
    act(() => {
      root.render(createElement("div", { onClick: outside },
        createElement(SidebarProvider, null, createElement(LayerList, props))));
    });
    finger(nameButton("wordmark"), "touchstart");
    await wait(500);
    finger(nameButton("wordmark"), "touchend");
    click(nameButton("wordmark"));
    expect(outside).not.toHaveBeenCalled();
    expect(props.onSelect).toHaveBeenCalledTimes(1);
  });

  it("drags a row by its grip, and leaves its name to scroll the list", () => {
    const props = render(baseProps({ selected: ["wordmark"] }));
    const grip = rowFor("wordmark").querySelector("[data-grip]") as HTMLButtonElement;
    expect(grip.getAttribute("aria-label")).toBe("Reorder Brand");
    expect(grip.className).toContain("hidden touch:grid touch-none");
    expect(nameButton("wordmark").className).toContain("touch-none touch:touch-pan-y");
    grip.setPointerCapture = vi.fn();
    const target = rowFor("barcode");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 20, height: 20 } as DOMRect);
    press(grip, "pointerdown", 100);
    press(grip, "pointermove", 21);
    press(grip, "pointerup", 21);
    expect(grip.setPointerCapture).toHaveBeenCalledWith(1);
    expect(props.onReorder).toHaveBeenCalledTimes(1);
  });

  it("a mouse still drags a row by its name", () => {
    const props = render(baseProps({ selected: ["wordmark"] }));
    const name = nameButton("wordmark");
    name.setPointerCapture = vi.fn();
    const target = rowFor("barcode");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 20, height: 20 } as DOMRect);
    press(name, "pointerdown", 100, "mouse");
    press(name, "pointermove", 21, "mouse");
    press(name, "pointerup", 21, "mouse");
    expect(props.onReorder).toHaveBeenCalledTimes(1);
  });
});
