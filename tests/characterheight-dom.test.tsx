// characterheight-dom.test.tsx — asynchronous font loading, physical-size
// edits, and when the fontkit shaping behind them runs (#731).
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CharacterHeight } from "../src/components/CharacterHeight";
import { LayerInspector } from "../src/components/LayerInspector";
import type { TextLayer } from "../src/model/layers";

const shaped = vi.hoisted(() => ({ count: 0 }));
vi.mock("../src/textheight", () => ({
  loadTextChecks: async () => ({
    measure: (layer: TextLayer) => {
      shaped.count++;
      return layer.lines[0]?.text ? { min: layer.size / 10, max: layer.size / 5, cpi: 24.56 } : null;
    },
    missingGlyphs: (layer: TextLayer) => [...(layer.lines[0]?.text ?? "")].filter((ch) => ch === "→").map((ch) => ch.codePointAt(0)!),
  }),
  sizeForMinimum: (size: number, min: number, target: number) => size * target / min,
  describeCodepoints: (cps: number[]) => cps.map((cp) => `“${String.fromCodePoint(cp)}” (U+${cp.toString(16).toUpperCase()})`).join(", "),
}));

it("edits the minimum through point size, updates the maximum and handles empty text", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  const style = { fill: "#000000", layer: "white" } as const;
  const layer: TextLayer = { id: "t", name: "Text", kind: "text", enabled: true, x: 0, y: 0, anchor: "left", size: 10, align: "left", style, lines: [{ text: "Hx", ...style }] };
  const render = async (value: TextLayer) => {
    await act(async () => { root.render(createElement(CharacterHeight, { layer: value, family: "poppins", onChange })); });
  };
  try {
    await render(layer);
    // Dynamic import settles independently of the initial render.
    await vi.waitFor(async () => { await act(async () => {}); expect(container.querySelector("input")).not.toBeNull(); });
    const input = container.querySelector("input")!;
    expect(input.value).toBe("1");
    expect(container.textContent).toContain("Characters per inch: 24.6");
    expect(container.textContent).toContain("Tallest character: 2.00 mm");
    // #12: the mm/pt toggle does not convert this field, and its addon says so.
    expect(input.closest("[data-slot=input-group]")!.querySelector("[title]")?.getAttribute("title"))
      .toBe("Character height is always millimetres");
    // No explanation to hunt for: the caption names the number.
    expect(container.querySelector('[aria-label="About character height"]')).toBeNull();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(input, "2"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(onChange).toHaveBeenLastCalledWith(20);
    await render({ ...layer, size: 20 });
    expect(container.textContent).toContain("Tallest character: 4.00 mm");
    expect(container.textContent).not.toContain("cannot print");
    await render({ ...layer, lines: [{ text: "Hx →", ...style }] });
    expect(container.querySelector("[role=alert]")?.textContent).toContain("cannot print “→” (U+2192)");
    await render({ ...layer, lines: [] });
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).toContain("Add letters or numbers");
  } finally {
    act(() => root.unmount()); container.remove();
  }
});

it("shapes the text when it or its size changes, not on a wheel tick or a drag", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const style = { fill: "#000000", layer: "white" } as const;
  const layer: TextLayer = { id: "t", name: "Text", kind: "text", enabled: true, x: 0, y: 0, anchor: "left", size: 10, align: "left", style, lines: [{ text: "Hx", ...style }] };
  // Fresh closures and Sets on every call, the way App renders the inspector.
  const render = async (value: TextLayer) => {
    await act(async () => {
      root.render(createElement(LayerInspector, {
        layer: value, layerNames: [], overridden: { variant: new Set<string>(), label: new Set<string>() },
        onChange: vi.fn(), onReset: vi.fn(), onUnbind: vi.fn(),
      }));
    });
  };
  try {
    await render(layer);
    await vi.waitFor(async () => { await act(async () => {}); expect(container.textContent).toContain("Tallest character"); });
    const before = shaped.count;
    await render(layer);
    await render({ ...layer });
    await render({ ...layer, x: 40, y: 12 });
    expect(shaped.count).toBe(before);
    await render({ ...layer, x: 40, y: 12, lines: [{ text: "Hxy", ...style }] });
    expect(shaped.count).toBe(before + 1);
    await render({ ...layer, x: 40, y: 12, lines: [{ text: "Hxy", ...style }], size: 20 });
    expect(shaped.count).toBe(before + 2);
    expect(container.textContent).toContain("Tallest character: 4.00 mm");
  } finally {
    act(() => root.unmount()); container.remove();
  }
});
