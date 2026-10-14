// characterheight-dom.test.tsx — asynchronous font loading and physical-size edits.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CharacterHeight } from "../src/components/CharacterHeight";
import type { TextLayer } from "../src/model/layers";

vi.mock("../src/textheight", () => ({
  loadTextChecks: async () => ({
    measure: (layer: TextLayer) => layer.lines[0]?.text ? { min: layer.size / 10, max: layer.size / 5, cpi: 24.56 } : null,
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
    // #23: the explanation sits behind an info button that describes itself,
    // not as two always-visible paragraphs.
    const info = container.querySelector('[aria-label="About character height"]')!;
    const described = document.getElementById(info.getAttribute("aria-describedby")!)!;
    expect(described.textContent).toContain("Highest line average, estimated.");
    expect(described.textContent).toContain("Letters and numbers at print size, excluding outlines.");
    expect(described.className).toContain("sr-only");
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
