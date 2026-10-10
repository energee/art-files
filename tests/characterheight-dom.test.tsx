// characterheight-dom.test.tsx — asynchronous font loading and physical-size edits.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CharacterHeight } from "../src/components/CharacterHeight";
import type { TextLayer } from "../src/model/layers";

vi.mock("../src/textheight", () => ({
  loadHeightMeasure: async () => (layer: TextLayer) => layer.lines[0]?.text ? { min: layer.size / 10, max: layer.size / 5, cpi: 24.56 } : null,
  sizeForMinimum: (size: number, min: number, target: number) => size * target / min,
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
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(input, "2"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(onChange).toHaveBeenLastCalledWith(20);
    await render({ ...layer, size: 20 });
    expect(container.textContent).toContain("Tallest character: 4.00 mm");
    await render({ ...layer, lines: [] });
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).toContain("Add letters or numbers");
  } finally {
    act(() => root.unmount()); container.remove();
  }
});
