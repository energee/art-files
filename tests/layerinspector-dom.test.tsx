// layerinspector-dom.test.tsx — DOM behavior of LayerInspector
// (src/components/LayerInspector.tsx), the v3 per-layer inspector: every
// control is controlled from the `layer` prop and writes one minimal
// DeepPartial<Layer> patch through onChange; Position switches between a
// numeric y (with the "Bind below…" picker) and a `below` binding (gap +
// Unbind → onUnbind); the Geometry section follows the layer's kind; the
// page-art image layers (role background/mask) keep only Fit; an overridden
// path shows a reset badge that calls onReset with that path. No
// @testing-library/react in this repo — mounted through react-dom/client +
// act, matching tests/styleproperties-inspector-dom.test.tsx's convention.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayerInspector } from "../src/components/LayerInspector";
import type {
  BarcodeLayer, ImageLayer, Layer, QrLayer, TextLayer,
} from "../src/model/layers";

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
  it("shows the layer's name and renames through onChange({ name })", () => {
    const { onChange } = render(text());
    const name = $("#name-name") as HTMLInputElement;
    expect(name.value).toBe("Name");
    type(name, "Beer name");
    expect(onChange).toHaveBeenLastCalledWith({ name: "Beer name" });
  });

  it("never commits an empty name", () => {
    const { onChange } = render(text());
    type($("#name-name")!, "");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("toggles enabled / locked as top-level patches", () => {
    const { onChange } = render(text());
    click(byLabel("Enabled")!);
    expect(onChange).toHaveBeenLastCalledWith({ enabled: false });
    click(byLabel("Locked")!);
    expect(onChange).toHaveBeenLastCalledWith({ locked: true });
    expect(byLabel("Fillable")).toBeNull();
  });

  it("renders the parent's content editor under a Content heading", () => {
    render(text(), { content: createElement("p", { id: "content-slot" }, "editor") });
    expect($("#content-slot")).not.toBeNull();
    expect(container.textContent).toContain("Content");
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
    const trigger = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("Bind to layer"))!;
    click(trigger);
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
    const select = byLabel("Binding side") as HTMLSelectElement;
    act(() => { select.value = "right"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(onBind).toHaveBeenLastCalledWith("description", "right");
  });

  it("migrates a legacy below binding when its side changes", () => {
    const { onBind } = render(text({ y: { below: "description", gap: 5 } }));
    const select = byLabel("Binding side") as HTMLSelectElement;
    expect(select.value).toBe("bottom");
    act(() => { select.value = "left"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(onBind).toHaveBeenCalledWith("description", "left");
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

  it("text: a cleared wrap width emits { width: undefined }", () => {
    const { onChange } = render(text({ width: 200 }));
    type($("#name-width")!, "");
    expect(onChange).toHaveBeenLastCalledWith({ width: undefined });
  });

  it("image: width, height, scale and tint; no text fields", () => {
    const { onChange } = render(image());
    expect($("#logo-w")).not.toBeNull();
    expect($("#logo-h")).not.toBeNull();
    expect($("#logo-scale")).not.toBeNull();
    expect(byLabel("Tint raster")).not.toBeNull();
    expect($("#logo-size")).toBeNull();
    type($("#logo-w")!, "40");
    expect(onChange).toHaveBeenLastCalledWith({ w: 40 });
    click(byLabel("Tint raster")!);
    expect(onChange).toHaveBeenLastCalledWith({ tintRaster: true });
  });

  it("background image layer keeps only Fit — no scale, tint, size or Style", () => {
    render(image({ id: "background", name: "Background", role: "background", fit: "cover" }));
    expect(byLabel("Fit")).not.toBeNull();
    expect($("#background-scale")).toBeNull();
    expect($("#background-w")).toBeNull();
    expect(byLabel("Tint raster")).toBeNull();
    expect($("#background-fill")).toBeNull();
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

  it("the plate toggle emits { style: { layer } }", () => {
    const { onChange } = render(text());
    click(byLabel("Metallic")!);
    expect(onChange).toHaveBeenLastCalledWith({ style: { layer: "white" } });
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

  it("colours the override mark info, not primary (docs/plans/template-switch.md, Task 3)", () => {
    render(text(), { overridden: from(["style.fill"]) });
    const badge = byLabel("Reset Fill to the master")!;
    expect(badge.className).toContain("text-info-text");
  });

  it("a bound y reports whichever leaf path the parent marked", () => {
    const { onReset } = render(
      text({ y: { below: "description", gap: 5 } }), { overridden: from(["y.gap"]) },
    );
    click(byLabel("Reset Gap to the master")!);
    expect(onReset).toHaveBeenCalledWith("y.gap", "variant");
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
  expect($("#name-placeholder")!.getAttribute("aria-describedby")).toBe("name-placeholder-hint");
  expect($("#name-placeholder-hint")!.textContent).toBe("Drawn while the layer is empty");
});


it("displays imported size precision cleanly without changing the stored layer", () => {
  const { onChange } = render(text({ size: 15.829999923706056 }));
  expect(($("#name-size") as HTMLInputElement).value).toBe("15.83");
  expect(onChange).not.toHaveBeenCalled();
  type($("#name-size")!, "16.25");
  expect(onChange).toHaveBeenLastCalledWith({ size: 16.25 });
});

it("converts dimensional edits from mm to points while keeping typography in points", () => {
  const onUnitChange = vi.fn();
  const { onChange } = render(text({ x: 72, y: -72, width: 144, size: 15.83 }), { unit: "mm", onUnitChange });
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
  click(byLabel("Points")!);
  expect(onUnitChange).toHaveBeenLastCalledWith("pt");
  render(text({ x: 72 }), { unit: "pt", onChange, onUnitChange });
  expect(($("#name-x") as HTMLInputElement).value).toBe("72");
  expect(onChange).not.toHaveBeenCalled();
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
