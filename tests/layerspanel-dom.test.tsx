// layerspanel-dom.test.tsx — DOM behavior of LayersPanel (src/components/
// LayersPanel.tsx): the flat, master-driven "Layers" group. Scoped to a DOM
// environment per-file, matching tests/fieldlist-dom.test.ts's convention
// (see its header) — no @testing-library/react in this repo, so this drives
// real DOM nodes through react-dom/client + act, the same as that suite.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayersPanel } from "../src/components/LayersPanel";
import { SidebarProvider } from "../src/components/ui/sidebar";
import { lolevMaster } from "../src/model/lolev";
import { composeConfig } from "../src/model/document";
import { panelRows } from "../src/model/panel";

// React only honours act() when the environment opts in (see
// tests/fieldlist-dom.test.ts for the same line).
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

function renderPanel(props: Parameters<typeof LayersPanel>[0]) {
  // LayersPanel's rows lean on shadcn's Sidebar primitives (SidebarMenuButton
  // etc.), which read their state off a SidebarProvider's context — a real
  // mount needs one, same as App's actual usage (see App.tsx's SidebarProvider).
  act(() => { root.render(createElement(SidebarProvider, null, createElement(LayersPanel, props))); });
}

/** The shipped master's rows — no variants enabled, matching the shipped
 *  label's default state. */
function shippedProps() {
  const master = lolevMaster();
  const r = composeConfig(master, [], {}, undefined);
  const rows = panelRows(master, r.layers, r.disabledLayers, r.config);
  return {
    cfg: r.config,
    update: vi.fn(),
    hidden: new Set<never>(),
    onToggleHidden: vi.fn(),
    selected: [],
    onSelect: vi.fn(),
    mode: "design" as const,
    onAddLayer: vi.fn(),
    rows,
  };
}

describe("LayersPanel", () => {
  it("renders one flat Layers group in master draw order, no Beer/Collab/Template groups", () => {
    renderPanel(shippedProps());
    expect(container.textContent).toContain("Layers");
    expect(container.textContent).toContain("Brand");
    expect(container.textContent).not.toContain("Beer");
    expect(container.textContent).not.toContain("Template");
    expect(container.querySelector('[aria-label="Collab enabled"]')).toBeNull();
  });

  it("badges a variant-owned row and dims it while the variant is off", () => {
    renderPanel(shippedProps());
    const leadRow = Array.from(container.querySelectorAll("li"))
      .find((li) => li.textContent?.includes("Lead-In"));
    expect(leadRow).toBeDefined();
    expect(leadRow!.textContent).toContain("Collab");
    expect(leadRow!.querySelector(".opacity-50")).not.toBeNull();
  });
});
