// inspector-key-warning-dom.test.tsx — rendering a text layer's inspector
// logs no React missing-key warning (#782). The Position section used to hand
// FieldPair its two fields as one array, which React reads as a list.
// Alone in its own file on purpose: React logs this warning once per module
// load, so in a suite that had already rendered the inspector it would never
// fire and the test would pass whatever the code did.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LayerInspector } from "../src/components/LayerInspector";
import type { TextLayer } from "../src/model/layers";

const STYLE = { fill: "#F3CD80", layer: "metallic" } as const;
const layer: TextLayer = {
  id: "name", name: "Name", kind: "text", enabled: true, x: 100, anchor: "center", y: 20,
  lines: [{ text: "Hazy", ...STYLE }], size: 15.83, align: "center", style: STYLE,
};

it("renders a text layer's Position section without a missing-key warning", () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  act(() => {
    root.render(createElement(LayerInspector, {
      layer, layerNames: [{ id: "name", name: "Name" }],
      overridden: { variant: new Set<string>(), label: new Set<string>() },
      onChange: vi.fn(), onReset: vi.fn(), onUnbind: vi.fn(), onBind: vi.fn(),
    }));
  });
  // The X / Y pair is what the warning was about, so it has to be on screen.
  expect(container.querySelector("#name-x")).not.toBeNull();
  expect(container.querySelector("#name-y")).not.toBeNull();
  const keyWarnings = err.mock.calls.filter((call) => String(call[0]).includes('unique "key" prop'));
  expect(keyWarnings).toEqual([]);
  act(() => { root.unmount(); });
  container.remove();
  err.mockRestore();
});
