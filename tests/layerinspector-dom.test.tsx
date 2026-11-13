// layerinspector-dom.test.tsx — DOM behavior of LayerInspector
// (src/components/LayerInspector.tsx), the v3 per-layer inspector: every
// control is controlled from the `layer` prop and writes one minimal
// DeepPartial<Layer> patch through onChange; Position switches between a
// numeric y (with the "Bind below…" picker) and a `below` binding (gap +
// Unbind → onUnbind); the Geometry section follows the layer's kind; the
// page-art image layers (role background/mask) show no Position; an overridden
// path shows a reset badge that calls onReset with that path. No
// @testing-library/react in this repo — mounted through react-dom/client +
// act, matching tests/styleproperties-inspector-dom.test.tsx's convention.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayerInspector } from "../src/components/LayerInspector";
import { FieldPair, Row } from "../src/components/LayerInspectorControls";
import { ScrubField } from "../src/components/ScrubField";
import type {
  BarcodeLayer, ImageLayer, Layer, QrLayer, TextLayer,
} from "../src/model/layers";

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

const STYLE = { fill: "#F3CD80", layer: "metallic" } as const;

const text = (over: Partial<TextLayer> = {}): TextLayer => ({
  id: "name", name: "Name", kind: "text", enabled: true, x: 100, anchor: "center", y: 20,
  lines: [{ text: "Hazy", ...STYLE }], size: 15.83, align: "center", style: STYLE, ...over,
});
const image = (over: Partial<ImageLayer> = {}): ImageLayer => ({
  id: "logo", name: "Logo", kind: "image", enabled: true, x: 100, anchor: "center", y: 40,
  asset: "builtin:logo", w: 33.5, style: STYLE, ...over,
});
const barcode = (over: Partial<BarcodeLayer> = {}): BarcodeLayer => ({
  id: "barcode", name: "Barcode", kind: "barcode", enabled: true, x: 500, anchor: "left", y: 200,
  symbology: "upc-a", value: "850051366224", h: 15, moduleW: 1.03, style: STYLE, ...over,
});
const qr = (over: Partial<QrLayer> = {}): QrLayer => ({
  id: "qr", name: "QR", kind: "qr", enabled: true, x: 24, anchor: "left", y: 280,
  value: "https://lolev.beer", size: 59, qrStyle: "square", style: STYLE, ...over,
});

const NAMES = [
  { id: "name", name: "Name" },
  { id: "description", name: "Description" },
  { id: "logo", name: "Logo" },
];

function render(layer: Layer, over: Partial<Parameters<typeof LayerInspector>[0]> = {}) {
  const props: Parameters<typeof LayerInspector>[0] = {
    layer, layerNames: NAMES, overridden: { variant: new Set<string>(), label: new Set<string>() },
    onChange: vi.fn(), onReset: vi.fn(), onUnbind: vi.fn(), onBind: vi.fn(),
    ...over,
  };
  act(() => { root.render(createElement(LayerInspector, props)); });
  return props;
}

const $ = (sel: string) => container.querySelector(sel);
/** Any button anywhere (menus portal into document.body) by aria-label. */
const byLabel = (label: string) =>
  document.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;

function type(el: Element, value: string) {
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const click = (el: Element) =>
  act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

describe("LayerInspector header", () => {
  // The name box commits like the Layers row's rename: Enter or leaving the
  // box writes it once (one undo step), Escape puts the old name back.
  const keydown = (el: Element, key: string) =>
    act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
  const blur = (el: Element) =>
    act(() => { el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });

  it("shows the layer's name and renames once, on Enter, trimmed", () => {
    const { onChange } = render(text());
    const name = $("#name-name") as HTMLInputElement;
    expect(name.value).toBe("Name");
    type(name, "Beer");
    type(name, "Beer name ");
    expect(onChange).not.toHaveBeenCalled();
    keydown(name, "Enter");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ name: "Beer name" });
  });

  it("renames on blur, and not at all when the name is unchanged", () => {
    const { onChange } = render(text());
    const name = $("#name-name") as HTMLInputElement;
    type(name, "Title");
    blur(name);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ name: "Title" });
    const again = render(text());
    blur($("#name-name")!);
    keydown($("#name-name")!, "Enter");
    expect(again.onChange).not.toHaveBeenCalled();
  });

  it("Escape restores the previous name and commits nothing", () => {
    const { onChange } = render(text());
    const name = $("#name-name") as HTMLInputElement;
    type(name, "Oops");
    keydown(name, "Escape");
    expect(name.value).toBe("Name");
    blur(name);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("never commits an empty name; leaving the box restores it", () => {
    const { onChange } = render(text());
    const name = $("#name-name") as HTMLInputElement;
    type(name, "  ");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    keydown(name, "Enter");
    blur(name);
    expect(onChange).not.toHaveBeenCalled();
    expect(name.value).toBe("Name");
  });

  // Power and lock are header icon toggles (the row's icons), not rows.
  it("toggles enabled / locked from header icon buttons as top-level patches", () => {
    const { onChange } = render(text());
    const power = byLabel("Enabled")!;
    const lock = byLabel("Locked")!;
    expect(power.tagName).toBe("BUTTON");
    expect(power.getAttribute("aria-pressed")).toBe("true");
    expect(lock.getAttribute("aria-pressed")).toBe("false");
    // Same line as the name box and the close button.
    expect(power.parentElement).toBe($("#name-name")!.parentElement);
    expect(lock.parentElement).toBe($("#name-name")!.parentElement);
    click(power);
    expect(onChange).toHaveBeenLastCalledWith({ enabled: false });
    click(lock);
    expect(onChange).toHaveBeenLastCalledWith({ locked: true });
    const locked = render(text({ locked: true }));
    expect(byLabel("Locked")!.getAttribute("aria-pressed")).toBe("true");
    click(byLabel("Locked")!);
    expect(locked.onChange).toHaveBeenLastCalledWith({ locked: false });
    expect(byLabel("Fillable")).toBeNull();
  });

  // The header is the selection's action bar: Show (the list's eye, not a
  // second icon for the same setting), Lock and Remove.
  it("shows the list's eye for power, and removes from a header button", () => {
    const { onRemove } = render(text(), { onRemove: vi.fn() });
    const power = byLabel("Enabled")!;
    expect(power.getAttribute("title")).toBe("Hide from preview and exports");
    expect(power.querySelector("svg")!.getAttribute("class")).toContain("lucide-eye");
    render(text({ enabled: false }), { onRemove });
    expect(byLabel("Enabled")!.getAttribute("title")).toBe("Show in preview and exports");
    expect(byLabel("Enabled")!.querySelector("svg")!.getAttribute("class")).toContain("lucide-eye-off");
    const remove = byLabel("Remove layer")!;
    expect(remove.parentElement).toBe($("#name-name")!.parentElement);
    click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
    // No handler, no button.
    render(text());
    expect(byLabel("Remove layer")).toBeNull();
  });

  // Page art can't be dragged, so a lock would do nothing there.
  it("offers no lock on page art", () => {
    render(image({ id: "background", name: "Background", role: "background", fit: "cover", locked: true }));
    expect(byLabel("Enabled")).not.toBeNull();
    expect(byLabel("Locked")).toBeNull();
    render(image({ id: "mask", name: "Mask", role: "mask", fit: "cover" }));
    expect(byLabel("Locked")).toBeNull();
  });

  // With several layers selected the sheet shows only what they share, and
  // every control it shows writes to all of them (src/model/multiEdit.ts).
  it("heads a multi-selection with its count, in place of the rename box", () => {
    render(text(), { others: [{ layer: image() }, { layer: qr() }] });
    const heading = $("#name-name")!;
    expect(heading.tagName).toBe("H2");
    expect(heading.textContent).toBe("3 layers");
    expect(byLabel("Layer name")).toBeNull();
    render(text());
    expect(($("#name-name") as HTMLInputElement).value).toBe("Name");
  });

  it("hides what belongs to one layer: content, binding and template settings", () => {
    const bound = text({ y: { below: "logo", gap: 4 } });
    render(bound, { content: createElement("p", { id: "content" }, "content"), others: [{ layer: text({ id: "tagline" }) }] });
    expect($("#content")).toBeNull();
    expect(container.textContent).not.toContain("Template field settings");
    expect(container.textContent).not.toContain("Unbind");
    expect(byLabel("Bind to layer…")).toBeNull();
    // Same kind, so Typography stays.
    expect(container.textContent).toContain("Typography");
    expect(container.textContent).toContain("Color");
  });

  it("shows a kind's section only when every selected layer is that kind", () => {
    render(text(), { others: [{ layer: barcode() }] });
    expect(container.textContent).not.toContain("Typography");
    expect(container.textContent).toContain("Position");
    expect(container.textContent).toContain("Color");
  });

  it("marks a control the selected layers differ on, and a click matches them", () => {
    const other = text({ id: "tagline", size: 9 });
    const { onChange } = render(text(), { others: [{ layer: other }] });
    const marks = [...container.querySelectorAll("[data-mixed]")];
    expect(marks.map((m) => m.getAttribute("aria-label")))
      .toEqual(["Selected layers differ. Click to set Size on all of them."]);
    click(marks[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ size: 15.83 });
    // One layer selected: nothing to differ from.
    render(text());
    expect($("[data-mixed]")).toBeNull();
  });

  // #2: a layer only an OFF variant adds is not drawn, and edits to it are
  // dropped — the switch must read Off, and turning it on enables it.
  it("reads Off for a layer an off variant adds, and turning it on sends enabled:true", () => {
    const { onChange } = render(image(), { offVariant: "Collab" });
    const toggle = byLabel("Enabled")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    click(toggle);
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true });
    // Other fields stay editable (no read-only fields).
    expect(($("#logo-x") as HTMLInputElement).disabled).toBe(false);
    render(image());
    expect(byLabel("Enabled")!.getAttribute("aria-pressed")).toBe("true");
  });


  // One app-wide unit (rulers, View → Units) converts the length fields; the
  // inspector spends no row on it. Fixed-unit fields say why they don't follow.
  it("has no Lengths in row, and titles the fixed-unit addons", () => {
    render(text({ style: { ...STYLE, stroke: "#000000" } }), { unit: "mm" });
    expect(byLabel("Lengths in")).toBeNull();
    expect(container.textContent).not.toContain("Lengths in");
    const addonTitle = (id: string) =>
      $(`#${id}`)!.closest("[data-slot=input-group]")!.querySelector("[title]")?.getAttribute("title");
    expect(addonTitle("name-size")).toBe("Type size is always points");
    expect(addonTitle("name-tracking")).toBe("Letter spacing is always points");
    expect(addonTitle("name-stroke-width")).toBe("Stroke width is pixels at 600 DPI");
    render(image({ id: "background", name: "Background", role: "background", fit: "cover" }), { unit: "mm" });
    expect(byLabel("Lengths in")).toBeNull();
  });

  // The editor's own caption names it, so there is no "Content" heading.
  it("renders the parent's content editor with no Content heading", () => {
    render(text(), { content: createElement("p", { id: "content-slot" }, "editor") });
    expect($("#content-slot")).not.toBeNull();
    expect([...container.querySelectorAll("h2")].map((h) => h.textContent)).not.toContain("Content");
  });
});

describe("LayerInspector position", () => {
  it("editing x emits { x }", () => {
    const { onChange } = render(text());
    type($("#name-x")!, "30");
    expect(onChange).toHaveBeenLastCalledWith({ x: 30 });
  });

  it("editing a numeric y emits { y }", () => {
    const { onChange } = render(text());
    type($("#name-y")!, "12");
    expect(onChange).toHaveBeenLastCalledWith({ y: 12 });
  });

  it("the rotation toggle emits { rotation: 90 } and back to 0", () => {
    const { onChange } = render(text());
    click(byLabel("Rotate 90°")!);
    expect(onChange).toHaveBeenLastCalledWith({ rotation: 90 });
    render(text({ rotation: 90 }), { onChange });
    click(byLabel("Rotate 90°")!);
    expect(onChange).toHaveBeenLastCalledWith({ rotation: 0 });
  });

  it("edits the fill contract — placeholder always, range only for a number", () => {
    const { onChange } = render(text({ placeholder: "Name" }));
    const box = $("#name-placeholder") as HTMLInputElement;
    expect(box.value).toBe("Name");
    type(box, "Beer name");
    expect(onChange).toHaveBeenLastCalledWith({ placeholder: "Beer name" });
    // Range is meaningless for rich text and hidden until the input is one.
    expect($("#name-min")).toBeNull();
    render(text({ input: "number", min: 0, max: 20 }), { onChange });
    expect(($("#name-min") as HTMLInputElement).value).toBe("0");
    expect($("#name-suffix")).not.toBeNull();
  });

  it("offers no rotation toggle on an image layer — no backend rotates raster art", () => {
    render(image());
    expect(byLabel("Rotate 90°")).toBeNull();
    render(qr());
    expect(byLabel("Rotate 90°")).not.toBeNull();
  });

  it.each(["top", "left", "right", "bottom"] as const)("binds to the %s of another layer", (side) => {
    const { onBind } = render(text());
    click(byLabel("Bind to layer…")!);
    expect(byLabel("Bind to Name")).toBeNull();
    click(byLabel("Bind to Description")!);
    click(byLabel(`Bind to ${side} of Description`)!);
    expect(onBind).toHaveBeenCalledWith("description", side);
  });

  it.each(["top", "left", "right", "bottom"] as const)("edits a %s binding and leaves the other axis usable", (side) => {
    const binding = { to: "description", side, gap: 4 };
    const { onChange, onBind } = render(text({ binding }));
    const horizontal = side === "left" || side === "right";
    expect(!!$("#name-x")).toBe(!horizontal);
    expect(!!$("#name-y")).toBe(horizontal);
    type($("#name-gap")!, "9");
    expect(onChange).toHaveBeenLastCalledWith({ binding: { ...binding, gap: 9 } });
    click(byLabel("Binding side")!);
    const option = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent === "Right")!;
    act(() => option.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" })));
    click(option);
    expect(onBind).toHaveBeenLastCalledWith("description", "right");
  });

  it("migrates a legacy below binding when its side changes", () => {
    const { onBind } = render(text({ y: { below: "description", gap: 5 } }));
    expect(byLabel("Binding side")!.textContent).toContain("Bottom");
    click(byLabel("Binding side")!);
    const option = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent === "Left")!;
    act(() => option.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" })));
    click(option);
    expect(onBind).toHaveBeenCalledWith("description", "left");
  });

  // Compact Position (plan inspector-density, decisions 5/7/13): pairs, and
  // Bind as an icon button on Rotation's row.
  const pairOf = (el: Element | null) => el?.closest(".grid-cols-2") ?? null;

  it("puts X and Y in one pair, and the two guides in another", () => {
    render(text());
    const xy = pairOf($("#name-x"));
    expect(xy).not.toBeNull();
    expect(xy!.contains($("#name-y"))).toBe(true);
    const guides = pairOf(byLabel("Horizontal guide"));
    expect(guides).not.toBeNull();
    expect(guides).not.toBe(xy);
    expect(guides!.contains(byLabel("Vertical guide"))).toBe(true);
  });

  it("renders the remaining axis alone when a binding hides the other", () => {
    render(text({ binding: { to: "description", side: "left", gap: 4 } }));
    expect($("#name-x")).toBeNull();
    expect(pairOf($("#name-y"))).toBeNull();
    render(text({ binding: { to: "description", side: "top", gap: 4 } }));
    expect($("#name-y")).toBeNull();
    expect(pairOf($("#name-x"))).toBeNull();
  });

  it("Bind is an icon button on the rotation row, named Bind to layer…", () => {
    render(text());
    const bind = byLabel("Bind to layer…")!;
    expect(bind.tagName).toBe("BUTTON");
    expect(bind.textContent?.trim()).toBe("");
    expect(bind.parentElement!.contains(byLabel("Rotate 90°"))).toBe(true);
    click(bind);
    expect(byLabel("Bind to Description")).not.toBeNull();
  });

  it("a bound layer keeps Bound to, Side, Gap and Unbind, and no Bind button", () => {
    render(text({ binding: { to: "description", side: "top", gap: 4 } }));
    expect(container.textContent).toContain("Bound to");
    expect(byLabel("Binding side")).not.toBeNull();
    expect($("#name-gap")).not.toBeNull();
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.trim() === "Unbind")).toBe(true);
    expect(byLabel("Bind to layer…")).toBeNull();
    expect(byLabel("Rotate 90°")).not.toBeNull();
  });

  it("a bound layer shows the bound name and gap, and Unbind calls onUnbind", () => {
    const { onChange, onUnbind } = render(text({ y: { below: "description", gap: 5 } }));
    expect(container.textContent).toContain("Description");
    expect($("#name-y")).toBeNull();
    const gap = $("#name-gap") as HTMLInputElement;
    expect(gap.value).toBe("5");
    type(gap, "8");
    expect(onChange).toHaveBeenLastCalledWith({ y: { below: "description", gap: 8 } });
    const unbind = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Unbind")!;
    click(unbind);
    expect(onUnbind).toHaveBeenCalledTimes(1);
  });
});

describe("LayerInspector geometry follows the kind", () => {
  it("text: size, leading, align, wrap width, uppercase", () => {
    const { onChange } = render(text());
    expect($("#name-size")).not.toBeNull();
    expect($("#name-leading")).not.toBeNull();
    expect(byLabel("Justify")).not.toBeNull();
    expect($("#name-width")).not.toBeNull();
    expect($("#name-w")).toBeNull();
    type($("#name-size")!, "18");
    expect(onChange).toHaveBeenLastCalledWith({ size: 18 });
    click(byLabel("Align left")!);
    expect(onChange).toHaveBeenLastCalledWith({ align: "left" });
    click(byLabel("Uppercase")!);
    expect(onChange).toHaveBeenLastCalledWith({ style: { uppercase: true } });
  });

  it("after blur a field shows exactly the number it applied (#135)", () => {
    // #135: the field kept "1e2" on screen after applying 100. NumberField
    // now owns the text: it rejects what doesn't parse and reformats on blur.
    const blur = (el: Element) =>
      act(() => { el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    const props = render(text({ width: 200 }));
    const size = $("#name-size") as HTMLInputElement;
    type(size, "1e2");
    expect(props.onChange).not.toHaveBeenCalled();
    blur(size);
    expect(size.value).toBe("15.83");
    const width = $("#name-width") as HTMLInputElement;
    type(width, "300");
    expect(props.onChange).toHaveBeenLastCalledWith({ width: 300 });
    render(text({ width: 300 }), { onChange: props.onChange });
    blur(width);
    expect(width.value).toBe("300");
  });

  it("arrow keys step a wrap width by the drag step, like X, Y and W", () => {
    // BlankableField used to step by the typed precision (0.01pt) while its
    // neighbours stepped by PT.dragStep; both now share unitProps.
    const { onChange } = render(text({ width: 200 }));
    const width = $("#name-width") as HTMLInputElement;
    act(() => {
      width.focus();
      width.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith({ width: 200.5 });
  });

  it("text: a cleared wrap width emits { width: undefined }", () => {
    const { onChange } = render(text({ width: 200 }));
    type($("#name-width")!, "");
    expect(onChange).toHaveBeenLastCalledWith({ width: undefined });
  });

  // No Scale: Width and Height are the drawn size (an old file's scale is
  // folded into them when it is read).
  it("image: width, height and tint; no scale, no text fields", () => {
    const { onChange } = render(image(), { rasterArt: true });
    expect($("#logo-w")).not.toBeNull();
    expect($("#logo-h")).not.toBeNull();
    expect($("#logo-scale")).toBeNull();
    expect(container.textContent).not.toContain("Scale");
    expect(byLabel("Tint raster")).not.toBeNull();
    expect($("#logo-size")).toBeNull();
    type($("#logo-w")!, "40");
    expect(onChange).toHaveBeenLastCalledWith({ w: 40 });
    click(byLabel("Tint raster")!);
    expect(onChange).toHaveBeenLastCalledWith({ tintRaster: true });
  });

  // An SVG already takes the fill, so Tint raster would do nothing on it.
  it("image: no Tint raster on SVG art", () => {
    render(image(), { rasterArt: false });
    expect($("#logo-w")).not.toBeNull();
    expect(byLabel("Tint raster")).toBeNull();
  });

  it("background image layer fills the page without ineffective geometry controls", () => {
    render(image({ id: "background", name: "Background", role: "background", fit: "cover" }));
    expect(byLabel("Fit")).toBeNull();
    expect($("#background-scale")).toBeNull();
    expect($("#background-w")).toBeNull();
    expect(byLabel("Tint raster")).toBeNull();
    expect($("#background-fill")).toBeNull();
  });

  // #10: the renderer ignores x/y on page art, so Position is not offered.
  it("page art (background and mask) shows no Position", () => {
    render(image({ id: "background", name: "Background", role: "background", fit: "cover" }));
    expect(container.textContent).not.toContain("Position");
    expect($("#background-x")).toBeNull();
    render(image({ id: "mask", name: "Mask", role: "mask", fit: "cover" }));
    expect($("#mask-x")).toBeNull();
    expect($("#mask-y")).toBeNull();
  });

  it("barcode: symbology, module width, height, digits", () => {
    const { onChange } = render(barcode());
    expect(byLabel("Symbology")).not.toBeNull();
    expect($("#barcode-modulew")).not.toBeNull();
    expect($("#barcode-h")).not.toBeNull();
    type($("#barcode-modulew")!, "0.9");
    expect(onChange).toHaveBeenLastCalledWith({ moduleW: 0.9 });
    click(byLabel("Show digits")!);
    expect(onChange).toHaveBeenLastCalledWith({ showDigits: false });
  });

  it("qr: size, style, error correction", () => {
    const { onChange } = render(qr());
    expect($("#qr-size")).not.toBeNull();
    expect(byLabel("QR style")).not.toBeNull();
    expect(byLabel("Error correction")).not.toBeNull();
    expect(byLabel("Symbology")).toBeNull();
    type($("#qr-size")!, "64");
    expect(onChange).toHaveBeenLastCalledWith({ size: 64 });
  });
});

describe("LayerInspector style", () => {
  it("a fill change emits { style: { fill } }", () => {
    const { onChange } = render(text());
    type($("#name-fill")!, "#112233");
    expect(onChange).toHaveBeenLastCalledWith({ style: { fill: "#112233" } });
  });

  it("gives fill and enabled stroke controls distinct accessible names", () => {
    render(text({ style: { ...STYLE, stroke: "#000000" } }));
    expect($("#name-fill")!.getAttribute("aria-label")).toBe("Fill color");
    expect(byLabel("Pick fill color")).not.toBeNull();
    expect($("#name-stroke-color")!.getAttribute("aria-label")).toBe("Stroke color");
    expect(byLabel("Pick stroke color")).not.toBeNull();
  });

  it("the plate toggle emits { style: { layer } }", () => {
    const { onChange } = render(text());
    click(byLabel("Metallic")!);
    expect(onChange).toHaveBeenLastCalledWith({ style: { layer: "white" } });
  });

  // No ink leaves nothing to plate, so the toggle is disabled (not hidden).
  it("disables the plate toggle while Fill is no ink", () => {
    render(text());
    expect((byLabel("Metallic") as HTMLButtonElement).disabled).toBe(false);
    render(text({ style: { ...STYLE, fill: "none" } }));
    expect((byLabel("Metallic") as HTMLButtonElement).disabled).toBe(true);
  });

  it("switching the stroke on writes a colour; the width then patches style.strokeWidth", () => {
    const { onChange } = render(text());
    expect($("#name-stroke-width")).toBeNull();
    click(byLabel("Outer stroke")!);
    expect(onChange).toHaveBeenLastCalledWith({ style: { stroke: "#000000" } });
    render(text({ style: { ...STYLE, stroke: "#000000" } }), { onChange });
    type($("#name-stroke-width")!, "20");
    expect(onChange).toHaveBeenLastCalledWith({ style: { strokeWidth: 20 } });
  });

  it("codes switch the stroke on as a white halo", () => {
    const { onChange } = render(barcode());
    click(byLabel("Outer stroke")!);
    expect(onChange).toHaveBeenLastCalledWith({ style: { stroke: "#FFFFFF" } });
  });

  it("a stroked barcode can turn on a solid background; other kinds cannot", () => {
    render(barcode());
    expect(byLabel("Solid background")).toBeNull();
    const { onChange } = render(barcode({ style: { ...STYLE, stroke: "#FFFFFF" } }));
    click(byLabel("Solid background")!);
    expect(onChange).toHaveBeenLastCalledWith({ solidBackground: true });
    render(qr({ style: { ...STYLE, stroke: "#FFFFFF" } }));
    expect(byLabel("Solid background")).toBeNull();
  });

  // Raster art prints on solid white ink whatever its plate says (the mask
  // paints its whole footprint), so the Metallic toggle would do nothing.
  it("shows the plate toggle inert on raster image art, with the reason; SVG art can use it", () => {
    const { onChange } = render(image({ asset: "img-1" }), { rasterArt: true });
    const toggle = byLabel("Metallic")!;
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(toggle.getAttribute("aria-describedby")!)!.textContent)
      .toBe("Raster art always prints on white ink. Use an SVG for metallic.");
    click(toggle);
    expect(onChange).not.toHaveBeenCalled();
    render(image());
    expect(byLabel("Metallic")!.getAttribute("aria-disabled")).toBeNull();
  });

  it("tracking is offered for text only", () => {
    render(text());
    expect($("#name-tracking")).not.toBeNull();
    render(image());
    expect($("#logo-tracking")).toBeNull();
  });
});

describe("LayerInspector override badges", () => {
  const from = (variant: string[], label: string[] = [], variantName?: string) =>
    ({ variant: new Set(variant), label: new Set(label), ...(variantName ? { variantName } : {}) });

  it("shows a reset badge only for an overridden path and calls onReset with it", () => {
    const { onReset } = render(text(), { overridden: from(["style.fill"]) });
    expect(byLabel("Reset X to the master")).toBeNull();
    const badge = byLabel("Reset Fill to the master");
    expect(badge).not.toBeNull();
    click(badge!);
    expect(onReset).toHaveBeenCalledWith("style.fill", "variant");
  });

  // A reset is offered on demand, not as a standing mark: it shows while its
  // row is hovered or holds focus, and an unchanged field reserves no slot.
  it("hides a reset until its row is hovered or focused, and names the field", () => {
    render(text(), { overridden: from([], ["size"]) });
    const reset = byLabel("Reset Size to this label's master value")!;
    expect(reset.getAttribute("title")).toBe("Reset Size");
    expect(reset.className).toContain("opacity-0");
    expect(reset.className).toContain("group-hover/reset:opacity-100");
    expect(reset.className).toContain("group-focus-within/reset:opacity-100");
    expect(reset.closest(".group\\/reset")).not.toBeNull();
    // Every reset sits in a row that reveals it.
    render(text({ style: { ...STYLE, stroke: "#000000" } }), { overridden: from([], [
      "enabled", "locked", "x", "y", "guideX", "guideY", "rotation", "fontFamily", "size", "align", "width",
      "leading", "headerScale", "style.letterSpacing", "style.uppercase", "style.fill", "style.layer",
      "style.stroke", "style.strokeLayer", "style.strokeWidth",
    ]) });
    const resets = [...container.querySelectorAll('[aria-label^="Reset "]')];
    expect(resets.length).toBeGreaterThanOrEqual(20);
    for (const el of resets) expect(el.closest(".group\\/reset"), el.getAttribute("aria-label")!).not.toBeNull();
    // The slot beside an unchanged full-width field holds no width open.
    render(text());
    expect($("#name-size")!.closest(".group\\/reset")!.innerHTML).not.toContain("min-w-6");
  });

  // A touch screen has no hover, so a reset is never hidden there: it shows
  // wherever its field is overridden, as a 44px button in space of its own,
  // so a first tap into a field cannot land on it and reset the value.
  it("gives a touch screen a visible 44px reset with no invisible reach", () => {
    render(text(), { overridden: from([], ["size", "x"]) });
    for (const name of ["Size", "X"]) {
      const reset = byLabel(`Reset ${name} to this label's master value`)!;
      const classes = reset.className.split(" ");
      expect(classes).toContain("touch:size-tap");
      expect(classes).toContain("touch:opacity-100");
      // Shown, so tappable: nothing turns its pointer events off, on touch or not.
      expect(reset.className).not.toContain("pointer-events-none");
      // Its box is its target: no touch-only hit area or margin reaching
      // over a neighbouring input (Task 2.6's mistake).
      expect(reset.className).not.toContain("touch:after:");
      // A mouse still waits for hover or focus.
      expect(classes).toContain("opacity-0");
      expect(classes).toContain("group-hover/reset:opacity-100");
      expect(reset.parentElement!.className).not.toMatch(/(^|\s)(touch:)?-?m[trblxy]?-/);
    }
  });

  it("colours the override mark info, not primary (docs/plans/template-switch.md, Task 3)", () => {
    render(text(), { overridden: from(["style.fill"]) });
    const badge = byLabel("Reset Fill to the master")!;
    expect(badge.className).toContain("text-info-text");
  });

  it("a bound y is one path, so the Gap badge resets the whole y", () => {
    const { onReset } = render(
      text({ y: { below: "description", gap: 5 } }), { overridden: from(["y"]) },
    );
    click(byLabel("Reset Gap to the master")!);
    expect(onReset).toHaveBeenCalledWith("y", "variant");
  });

  it("an edge binding is one path, so the Gap badge resets the whole binding (#92)", () => {
    const { onReset } = render(
      text({ binding: { to: "description", side: "bottom", gap: 5 } }), { overridden: from(["binding"]) },
    );
    click(byLabel("Reset Gap to the master")!);
    expect(onReset).toHaveBeenCalledWith("binding", "variant");
  });

  it("marks a variant's change and this label's separately, each resetting its own", () => {
    // One merged badge used to mean the same click could clear your own edit
    // or rewrite the shipped variant, depending on state you could not see.
    const { onReset } = render(text(), { overridden: from(["style.fill"], ["style.fill"], "Collab") });
    const variantMark = byLabel("Reset Fill to the master")!;
    const labelMark = byLabel("Reset Fill to this label's master value")!;
    expect(variantMark.getAttribute("title")).toContain("Collab sets Fill");
    click(labelMark);
    expect(onReset).toHaveBeenLastCalledWith("style.fill", "label");
    click(variantMark);
    expect(onReset).toHaveBeenLastCalledWith("style.fill", "variant");
  });

  // #22: one reset per state — the heading badge while stroke is off, the
  // colour-row badge while it is on.
  it("shows exactly one Stroke reset whether the stroke is on or off", () => {
    const resets = () => container.querySelectorAll('[aria-label^="Reset Stroke"]:not([aria-label^="Reset Stroke Width"]):not([aria-label^="Reset Stroke Plate"])');
    render(text(), { overridden: from(["style.stroke"]) });
    expect(resets()).toHaveLength(1);
    render(text({ style: { ...STYLE, stroke: "#000000" } }), { overridden: from(["style.stroke"]) });
    expect(resets()).toHaveLength(1);
  });

  // Page art hides Position, but a stale x/y override must still be clearable.
  it("page art with an x/y override still offers the X and Y resets", () => {
    const bg = image({ id: "background", name: "Background", role: "background", fit: "cover" });
    const { onReset } = render(bg, { overridden: from(["x"], ["y"]) });
    expect($("#background-x")).toBeNull();
    click(byLabel("Reset X to the master")!);
    expect(onReset).toHaveBeenLastCalledWith("x", "variant");
    click(byLabel("Reset Y to this label's master value")!);
    expect(onReset).toHaveBeenLastCalledWith("y", "label");
    // A guide or binding override, set before Position was hidden, too.
    const guides = render(bg, { overridden: from(["guideX"], ["binding"]) });
    click(byLabel("Reset Horizontal guide to the master")!);
    expect(guides.onReset).toHaveBeenLastCalledWith("guideX", "variant");
    click(byLabel("Reset Binding to this label's master value")!);
    expect(guides.onReset).toHaveBeenLastCalledWith("binding", "label");
    render(bg);
    expect(container.textContent).not.toContain("Position");
    expect(container.textContent).not.toContain("Unused position override");
  });

  it("a label-only change shows just the label mark", () => {
    render(text(), { overridden: from([], ["x"]) });
    expect(byLabel("Reset X to the master")).toBeNull();
    expect(byLabel("Reset X to this label's master value")).not.toBeNull();
  });
});

it("one control per axis: picking a guide anchors that edge on it with offset 0", () => {
  const { onChange } = render(text());
  click(byLabel("Anchor to middle guide")!);
  expect(onChange).toHaveBeenLastCalledWith({ guideY: "middle", y: 0, vAnchor: "top" });
  click(byLabel("Anchor to bottom guide")!);
  expect(onChange).toHaveBeenLastCalledWith({ guideY: "bottom", y: 0, vAnchor: "bottom" });
  click(byLabel("Anchor to left guide")!);
  expect(onChange).toHaveBeenLastCalledWith({ guideX: "left", x: 0, anchor: "left" });
  click(byLabel("Anchor to center guide")!);
  expect(onChange).toHaveBeenLastCalledWith({ guideX: "center", x: 0, anchor: "center" });
  click(byLabel("Anchor to right guide")!);
  expect(onChange).toHaveBeenLastCalledWith({ guideX: "right", x: 0, anchor: "right" });
  // The old anchor / edge / detach controls are gone.
  expect(byLabel("Anchor right")).toBeNull();
  expect(byLabel("Y places the top edge")).toBeNull();
  expect(byLabel("Detach from guide")).toBeNull();
  expect(byLabel("Detach from horizontal guide")).toBeNull();
});

// docs/plans/choice-input.md, Task 6. Authoring the vocabulary a filler picks
// from: a caption for the field and the list itself. Both are fill-contract
// keys, so they route to the master (MASTER_PATHS) — the inspector only has to
// emit them, and it emits `choices` as the WHOLE array, which is also how the
// override badge sees it (leafPaths treats an array as one leaf).
describe("LayerInspector fill vocabulary", () => {
  const STYLES = [
    { value: "Ultra Hopped Ale" },
    { title: "Hazy IPA", value: "Hazy India Pale Ale" },
  ];

  it("captions the field through title", () => {
    const { onChange } = render(text());
    type($("#name-title") as HTMLInputElement, "Style");
    expect(onChange).toHaveBeenLastCalledWith({ title: "Style" });
  });

  it("lists each choice's title and value", () => {
    render(text({ choices: STYLES }));
    expect(($("#name-choice-0-value") as HTMLInputElement).value).toBe("Ultra Hopped Ale");
    expect(($("#name-choice-1-title") as HTMLInputElement).value).toBe("Hazy IPA");
    expect(($("#name-choice-1-value") as HTMLInputElement).value).toBe("Hazy India Pale Ale");
  });

  it("edits one choice and emits the whole list", () => {
    const { onChange } = render(text({ choices: STYLES }));
    type($("#name-choice-0-value") as HTMLInputElement, "Pale Ale");
    expect(onChange).toHaveBeenLastCalledWith({
      choices: [{ value: "Pale Ale" }, STYLES[1]],
    });
  });

  // Emptying the box to retype must not push a blank at the model: parseMaster
  // refuses a choice with no value, App catches the throw into the menu-bar
  // alert, and the field sprang back with a red banner that stayed up.
  it("lets a value box go empty while retyping without emitting a blank", () => {
    const { onChange } = render(text({ choices: STYLES }));
    const box = $("#name-choice-0-value") as HTMLInputElement;
    type(box, "");
    expect(box.value).toBe("");
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
    type(box, "Pale Ale");
    expect(onChange).toHaveBeenLastCalledWith({
      choices: [{ value: "Pale Ale" }, STYLES[1]],
    });
  });

  // An appended choice must arrive VALID: parseMaster rejects a blank value
  // ("has a choice with no value") and App discards the whole edit, so an
  // empty new row would never reach the screen to be typed into.
  it("appends a usable choice, and drops the title when it is blanked", () => {
    const { onChange } = render(text({ choices: STYLES }));
    click(byLabel("Add choice")!);
    expect(onChange).toHaveBeenLastCalledWith({ choices: [...STYLES, { value: "New choice" }] });

    type($("#name-choice-1-title") as HTMLInputElement, "");
    expect(onChange).toHaveBeenLastCalledWith({
      choices: [STYLES[0], { value: "Hazy India Pale Ale" }],
    });
  });

  it("numbers each further choice so no two arrive with the same value", () => {
    const { onChange } = render(text({ choices: [{ value: "New choice" }] }));
    click(byLabel("Add choice")!);
    expect(onChange).toHaveBeenLastCalledWith({
      choices: [{ value: "New choice" }, { value: "New choice 2" }],
    });
  });

  it("removes a choice, and the last one takes the whole key with it", () => {
    const { onChange } = render(text({ choices: STYLES }));
    click(byLabel("Remove choice 1")!);
    expect(onChange).toHaveBeenLastCalledWith({ choices: [STYLES[1]] });

    const one = render(text({ choices: [STYLES[0]] }));
    click(byLabel("Remove choice 1")!);
    expect(one.onChange).toHaveBeenLastCalledWith({ choices: undefined });
  });

  it("offers the same editor on a barcode, which has a value and no input", () => {
    const { onChange } = render(barcode({ choices: [{ title: "Tier 1", value: "850051366040" }] }));
    expect(($("#barcode-choice-0-title") as HTMLInputElement).value).toBe("Tier 1");
    click(byLabel("Add choice")!);
    expect(onChange).toHaveBeenLastCalledWith({
      choices: [{ title: "Tier 1", value: "850051366040" }, { value: "New choice" }],
    });
  });
});


it("keeps typography together and template-only settings in a closed disclosure", () => {
  render(text({ placeholder: "Name", choices: [{ value: "Ale" }] }));
  const details = $("details") as HTMLDetailsElement;
  expect(details.open).toBe(false);
  expect(details.querySelector("summary")?.textContent).toContain("Template field settings");
  expect(details.querySelector("#name-placeholder")).not.toBeNull();
  expect(details.querySelector("#name-choice-0-value")).not.toBeNull();
  expect($("#name-size")!.parentElement?.closest("details")).toBeNull();
  expect(Array.from(container.querySelectorAll("h2")).map((el) => el.textContent))
    .toEqual(["Typography", "Position", "Color", "Stroke"]);
});


it("displays imported size precision cleanly without changing the stored layer", () => {
  const { onChange } = render(text({ size: 15.829999923706056 }));
  expect(($("#name-size") as HTMLInputElement).value).toBe("15.83");
  expect(onChange).not.toHaveBeenCalled();
  type($("#name-size")!, "16.25");
  expect(onChange).toHaveBeenLastCalledWith({ size: 16.25 });
});

it("converts dimensional edits from mm to points while keeping typography in points", () => {
  const { onChange } = render(text({ x: 72, y: -72, width: 144, size: 15.83 }), { unit: "mm" });
  expect(($("#name-x") as HTMLInputElement).value).toBe("25.4");
  expect(($("#name-y") as HTMLInputElement).value).toBe("-25.4");
  expect(($("#name-width") as HTMLInputElement).value).toBe("50.8");
  expect(($("#name-size") as HTMLInputElement).value).toBe("15.83");
  expect(onChange).not.toHaveBeenCalled();
  type($("#name-x")!, "12.7");
  expect(onChange).toHaveBeenLastCalledWith({ x: 36 });
  type($("#name-width")!, "25.4");
  expect(onChange).toHaveBeenLastCalledWith({ width: 72 });
  type($("#name-width")!, "");
  expect(onChange).toHaveBeenLastCalledWith({ width: undefined });
  vi.mocked(onChange).mockClear();
  render(text({ x: 72 }), { unit: "pt", onChange });
  expect(($("#name-x") as HTMLInputElement).value).toBe("72");
  expect(onChange).not.toHaveBeenCalled();
});

// The same conversion in inches and in output pixels (600 DPI by default),
// which the rulers and the drag readout already spoke.
it("converts lengths in inches and pixels, keeping the model in points", () => {
  const { onChange } = render(text({ x: 72, width: 144, size: 15.83 }), { unit: "in" });
  expect(($("#name-x") as HTMLInputElement).value).toBe("1");
  expect(($("#name-width") as HTMLInputElement).value).toBe("2");
  expect(($("#name-size") as HTMLInputElement).value).toBe("15.83");
  const addon = (id: string) =>
    $(`#${id}`)!.closest("[data-slot=input-group]")!.querySelector("[data-slot=input-group-addon]")!.textContent;
  expect(addon("name-x")).toBe("in");
  expect(addon("name-size")).toBe("pt");
  type($("#name-x")!, "0.5");
  expect(onChange).toHaveBeenLastCalledWith({ x: 36 });
  act(() => { $("#name-x")!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
  // 1pt needs four decimals of an inch to store back as 1pt.
  render(text({ x: 1 }), { unit: "in", onChange });
  expect(($("#name-x") as HTMLInputElement).value).toBe("0.0139");
  render(qr({ size: 72 }), { unit: "px", onChange });
  expect(($("#qr-size") as HTMLInputElement).value).toBe("600");
  expect(addon("qr-size")).toBe("px");
  type($("#qr-size")!, "300");
  expect(onChange).toHaveBeenLastCalledWith({ size: 36 });
});

// #131: a millimetre value is stored at the model's 0.01pt, and that stored
// point read back at 0.001mm is off by the rounding — 50 came back as 49.999.
// The field shows the shortest reading that stores the same points.
it("shows a typed millimetre value back as typed (#131)", () => {
  const { onChange } = render(text({ x: 72, width: 144 }), { unit: "mm" });
  const stored: Record<string, number> = {};
  for (const mm of ["50", "10", "-500"]) {
    type($("#name-x")!, mm);
    stored[mm] = (vi.mocked(onChange).mock.lastCall?.[0] as { x: number }).x;
  }
  type($("#name-width")!, "50");
  const width = (vi.mocked(onChange).mock.lastCall?.[0] as { width: number }).width;
  // Blur drops each field's typed draft, so what follows reads the stored value.
  for (const id of ["#name-x", "#name-width"])
    act(() => { $(id)!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
  for (const mm of ["50", "10", "-500"]) {
    render(text({ x: stored[mm], width }), { unit: "mm" });
    expect(($("#name-x") as HTMLInputElement).value).toBe(mm);
    expect(($("#name-width") as HTMLInputElement).value).toBe("50");
  }
  // A value that needs the third decimal still gets it: 1pt is 0.353mm, and
  // 0.35mm would store 0.99pt.
  render(text({ x: 1 }), { unit: "mm" });
  expect(($("#name-x") as HTMLInputElement).value).toBe("0.353");
});

it("converts image dimensions and binding gaps in mm without losing optional height or bounds", () => {
  const { onChange } = render(image({ w: 72, h: 144, binding: { to: "name", side: "bottom", gap: -72 } }), { unit: "mm" });
  expect(($("#logo-w") as HTMLInputElement).value).toBe("25.4");
  expect(($("#logo-h") as HTMLInputElement).value).toBe("50.8");
  expect(($("#logo-gap") as HTMLInputElement).value).toBe("-25.4");
  type($("#logo-gap")!, "-12.7");
  expect(onChange).toHaveBeenLastCalledWith({ binding: { to: "name", side: "bottom", gap: -36 } });
  type($("#logo-h")!, "");
  expect(onChange).toHaveBeenLastCalledWith({ h: undefined });
  type($("#logo-w")!, "0");
  expect(onChange).toHaveBeenLastCalledWith({ w: 1 });
});

it("converts barcode and QR dimensions while preserving their point-based model", () => {
  const { onChange } = render(barcode({ h: 72 }), { unit: "mm" });
  expect(($("#barcode-h") as HTMLInputElement).value).toBe("25.4");
  type($("#barcode-modulew")!, "0.5");
  expect(vi.mocked(onChange).mock.lastCall?.[0]).toMatchObject({ moduleW: expect.closeTo(0.5 * 72 / 25.4) });
  render(qr({ size: 72 }), { unit: "mm", onChange });
  expect(($("#qr-size") as HTMLInputElement).value).toBe("25.4");
  type($("#qr-size")!, "12.7");
  expect(onChange).toHaveBeenLastCalledWith({ size: 36 });
});

it("changes only the selected layer's font and offers inheritance", async () => {
  const { onChange } = render(text());
  expect(byLabel("Font")!.textContent).toContain("Default (Poppins)");
  click(byLabel("Font")!);
  const option = Array.from(document.querySelectorAll('[role="option"]')).find((el) => el.textContent?.includes("Barlow Condensed"));
  expect(option).toBeDefined();
  act(() => { option!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" })); });
  click(option!);
  expect(onChange).toHaveBeenLastCalledWith({ fontFamily: "barlow-condensed" });
  render(text({ fontFamily: "barlow-condensed" }), { onChange });
  click(byLabel("Font")!);
  const inherit = Array.from(document.querySelectorAll('[role="option"]')).find((el) => el.textContent?.includes("Default (Poppins)"));
  act(() => { inherit!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" })); });
  click(inherit!);
  expect(onChange).toHaveBeenLastCalledWith({ fontFamily: undefined });
});

describe("LayerInspector dropdown triggers show the option label (#232)", () => {
  // The closed trigger's displayed value, without its chevron.
  const shown = (label: string) =>
    byLabel(label)!.querySelector('[data-slot="select-value"]')!.textContent;

  it("Input and the fill-contract Symbology", () => {
    render(text());
    expect(shown("Input")).toBe("Rich text");
    render(text({ input: "code", symbology: "ean-13" }));
    expect(shown("Input")).toBe("Code");
    expect(shown("Symbology")).toBe("EAN-13");
  });

  it("barcode Symbology", () => {
    render(barcode());
    expect(shown("Symbology")).toBe("UPC-A");
  });

  it("image Fit", () => {
    render(image({ fit: "cover" }));
    expect(shown("Fit")).toBe("Cover");
  });

  it("QR style and Error correction", () => {
    render(qr({ qrStyle: "rounded" }));
    expect(shown("QR style")).toBe("Rounded");
    expect(shown("Error correction")).toBe("L (default)");
  });
});

// The numeric fields are Base UI NumberFields (ScrubField.tsx). These pin the
// behaviour the hand-rolled fields had, which NumberField's defaults changed.
describe("LayerInspector numeric fields (NumberField)", () => {
  const blur = (el: Element) =>
    act(() => { el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
  const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(() => {
    (el as HTMLElement).focus();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  });

  it("focusing and leaving an off-grid imported value writes nothing", () => {
    const { onChange } = render(text({ size: 15.829999923706056, width: 141.733333 }));
    for (const sel of ["#name-size", "#name-width"]) {
      const el = $(sel) as HTMLInputElement;
      act(() => { el.focus(); });
      blur(el);
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Home and End move the caret instead of jumping to min or max", () => {
    const { onChange } = render(text({ width: 200 }));
    const width = $("#name-width")!;
    key(width, "Home");
    key(width, "End");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Alt+arrow steps finely even when a tenth of the step is below the shown precision", () => {
    const { onChange } = render(text({ leading: 1.2 }));
    key($("#name-leading")!, "ArrowUp", { altKey: true });
    expect(onChange).toHaveBeenLastCalledWith({ leading: 1.21 });
  });

  it("an unparseable half-typed draft reverts to the applied value on blur", () => {
    render(text({ x: 100 }), { unit: "pt" });
    const x = $("#name-x") as HTMLInputElement;
    act(() => { x.focus(); });
    type(x, "-");
    blur(x);
    expect(($("#name-x") as HTMLInputElement).value).toBe("100");
  });

  it("blur does not re-send a typed value the parent has since replaced", () => {
    const props = render(text({ width: 200 }));
    const width = $("#name-width") as HTMLInputElement;
    act(() => { width.focus(); });
    type(width, "250");
    expect(props.onChange).toHaveBeenCalledTimes(1);
    render(text({ width: 260 }), { onChange: props.onChange });
    blur(width);
    expect(props.onChange).toHaveBeenCalledTimes(1);
  });

  it("a typed reading past the shown precision shows the applied value after blur (#135)", () => {
    const props = render(text({ width: 200 }));
    const width = $("#name-width") as HTMLInputElement;
    act(() => { width.focus(); });
    type(width, "300.456");
    expect(props.onChange).toHaveBeenLastCalledWith({ width: 300.46 });
    render(text({ width: 300.46 }), { onChange: props.onChange });
    blur(width);
    expect(width.value).toBe("300.46");
  });

  it("a scrub moves one step per pixel whatever the event size, so dragging back restores the start", async () => {
    // Base UI's default 2px sensitivity applied only the triggering event's
    // movement, so small and large pointer events moved at different rates.
    let tracking = 0;
    const onChange = vi.fn((p: { style?: { letterSpacing?: number } }) => {
      tracking = p.style?.letterSpacing ?? tracking;
    });
    render(text(), { onChange });
    const label = container.querySelector('label[for="name-tracking"]')!;
    const scrub = async (moves: number[]) => {
      const o = { bubbles: true, cancelable: true, pointerType: "mouse", button: 0, buttons: 1, pointerId: 1 };
      await act(async () => { label.dispatchEvent(new PointerEvent("pointerdown", o)); });
      for (const movementX of moves) {
        await act(async () => { window.dispatchEvent(new PointerEvent("pointermove", { ...o, movementX })); });
        // Controlled field: feed each applied value back, as App does.
        render(text({ style: { ...STYLE, letterSpacing: tracking } }), { onChange });
      }
      await act(async () => { window.dispatchEvent(new PointerEvent("pointerup", { ...o, buttons: 0 })); });
    };
    await scrub([3, 3, 3, 3, 3]);             // 15px in big events
    expect(tracking).toBe(1.5);
    await scrub(Array(15).fill(-1));           // 15px back in single pixels
    expect(tracking).toBe(0);
  });

  it("arrow keys in mm step by the pt drag step converted, not a fixed 0.1mm", () => {
    const { onChange } = render(barcode({ moduleW: 1 }), { unit: "mm" });
    key($("#barcode-modulew")!, "ArrowUp");
    // 0.05pt is 0.018mm; 0.1mm would land at 1.28pt.
    expect(onChange).toHaveBeenLastCalledWith({ moduleW: 1.05 });
  });
});

describe("FieldPair", () => {
  /** The input a label's text names, as getByLabelText resolves it. */
  const byLabelText = (text: string) => {
    const label = [...container.querySelectorAll("label")].find((l) => l.textContent === text);
    return label ? document.getElementById(label.htmlFor) : null;
  };

  it("puts two compact fields in one grid row, each label tied to its input", () => {
    // Each cell is a Row (field + badge slot), as the inspector sections use it.
    const field = (id: string, label: string) => createElement(Row, null, createElement(ScrubField, {
      id, label, unit: "pt", value: 1, min: 0, max: 10, step: 1, compact: true, onChange: vi.fn(),
    }));
    act(() => {
      root.render(createElement(FieldPair, null, field("pair-x", "X"), field("pair-y", "Y")));
    });
    const x = byLabelText("X")!;
    const y = byLabelText("Y")!;
    expect(x.id).toBe("pair-x");
    expect(y.id).toBe("pair-y");
    const row = container.firstElementChild!;
    expect(row.className).toContain("grid-cols-2");
    expect(row.children).toHaveLength(2);
    expect(row.contains(x) && row.contains(y)).toBe(true);
    // Compact: the input group fills its cell, not a fixed w-24/w-28.
    const group = x.parentElement!;
    expect(group.className).not.toMatch(/\bw-2[48]\b/);
  });
});

describe("on a touch screen", () => {
  const overridden = { variant: new Set<string>(), label: new Set(["x"]) };
  const resetX = () => $(`button[aria-label="Reset X to this label's master value"]`) as HTMLButtonElement;

  // Review Focus 4
  it("a reset acts on a click, never on a press that scrolls away", () => {
    const { onReset } = render(text(), { overridden });
    act(() => {
      resetX().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
      resetX().dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerType: "touch" }));
    });
    expect(onReset).not.toHaveBeenCalled();
    click(resetX());
    expect(onReset).toHaveBeenCalledWith("x", "label");
  });

  // Review Focus 4
  it("on touch a stacked row's reset sits beside its field, not over it", () => {
    act(() => { root.render(createElement(Row, { badge: createElement("button", { id: "b" }), children: createElement("div", { id: "field" }) })); });
    const classes = $("#field")!.parentElement!.className.split(" ");
    for (const c of ["touch:flex", "touch:items-end", "touch:[&>:first-child]:min-w-0", "touch:[&>:first-child]:flex-1"]) {
      expect(classes).toContain(c);
    }
    // Ungated, it would change the desktop.
    expect(classes).not.toContain("flex");
    const wrapper = $("#field")!.parentElement!;
    // The badge's own span (BadgeSlot's sits inside it).
    expect(wrapper.lastElementChild!.className).toBe("absolute right-0 top-0 touch:static");
  });

  it("stacks a field pair into one column on touch and reserves a 44px badge column", () => {
    render(text(), { overridden });
    const pair = $("#name-x")!.closest(".grid")!.className.split(" ");
    expect(pair).toContain("grid-cols-2");
    expect(pair).toContain("touch:grid-cols-1");
    expect(pair).not.toContain("grid-cols-1");
    expect(resetX().closest(".min-w-6")!.className).toContain("touch:min-w-tap");
  });

  // Base UI's scrub area blocks scrolling on any one-finger touchstart, so on
  // touch the name takes no pointer input and the finger reaches the panel.
  // A mouse still scrubs: see "a scrub moves one step per pixel…" above.
  it("lets a finger scroll the inspector from a field's name", () => {
    render(text());
    const classes = ($('label[for="name-size"]') as HTMLElement).className.split(" ");
    expect(classes).toContain("touch:pointer-events-none");
    expect(classes).not.toContain("pointer-events-none");
    expect(classes).toContain("cursor-ew-resize");
  });

  it("gives the differ mark a 44px target on touch, kept apart from the reset beside it", () => {
    render(text(), { overridden: { variant: new Set<string>(), label: new Set(["size"]) }, others: [{ layer: text({ id: "tagline", size: 9 }) }] });
    const mixed = $("[data-mixed]")!;
    expect(mixed.className).toContain("touch:size-tap");
    // Two always-shown 44px targets doing different edits: a gap on touch only.
    const slot = mixed.parentElement!;
    expect(slot.contains(byLabel("Reset Size to this label's master value"))).toBe(true);
    const classes = slot.className.split(" ");
    expect(classes).toContain("touch:gap-1");
    expect(classes.some((c) => /^gap-/.test(c))).toBe(false);
  });
});
