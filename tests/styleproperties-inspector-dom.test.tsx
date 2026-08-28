// styleproperties-inspector-dom.test.tsx — DOM behavior of Inspector
// (src/components/StyleProperties.tsx), scoped to finding #7 (HIGH): a
// MasterLayer.id is an unvalidated string, so a variant can append a
// Variant.layers row whose id is neither a doc layer id nor a known
// ELEMENTS/custom-* id. elementById(id) used to throw for that id and crash
// the whole sidebar (LayersPanel's row AND the inspector both called it
// unguarded). No @testing-library/react in this repo — mounted through
// react-dom/client + act, matching tests/makefillable-dom.test.tsx's
// convention (see its header).
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Inspector } from "../src/components/StyleProperties";
import { defaultConfig } from "../src/defaults";
import type { LayerId } from "../src/components/layers";

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

function renderInspector(ids: readonly LayerId[]) {
  const props: Parameters<typeof Inspector>[0] = {
    ids,
    cfg: defaultConfig(),
    errors: {},
    update: vi.fn(),
    files: {
      texture: { onFile: vi.fn(), onClear: vi.fn() },
      mask: { onFile: vi.fn(), onClear: vi.fn() },
    },
    settings: {
      cornerRadius: 0, onCornerRadius: vi.fn(),
      edgeSoftness: 0, onEdgeSoftness: vi.fn(),
      dpi: 300, onDpi: vi.fn(),
      bleedIn: 0, onBleedIn: vi.fn(),
    },
    fields: [],
    preview: {},
    overridden: new Set(),
    onResetOverride: vi.fn(),
    declaredPaths: new Set(),
    onMakeFillable: vi.fn(),
    onClose: vi.fn(),
  };
  act(() => { root.render(createElement(Inspector, props)); });
}

describe("Inspector with an id absent from ELEMENTS (finding #7)", () => {
  it("renders instead of throwing", () => {
    expect(() => renderInspector(["not-a-real-element" as LayerId])).not.toThrow();
    expect(container.textContent).toContain("not-a-real-element");
  });
});
