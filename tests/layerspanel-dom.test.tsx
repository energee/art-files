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
    onMoveCustomLayer: vi.fn(),
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

  // The master-level enable, master rows only — distinct from the eye, which
  // is session-only hiding and stays out of onLayerEdit entirely. Present
  // only when the panel is given onLayerEdit (Design mode).
  it("toggles a master layer's enable through onLayerEdit, and never through the eye", () => {
    const onLayerEdit = vi.fn();
    const onToggleHidden = vi.fn();
    renderPanel({ ...shippedProps(), onLayerEdit, onToggleHidden });
    const row = Array.from(container.querySelectorAll("li"))
      .find((li) => li.textContent?.includes("Brand"))!;
    const disable = row.querySelector('[aria-label="Disable Brand on every label"]') as HTMLButtonElement;
    expect(disable).not.toBeNull();
    act(() => { disable.click(); });
    expect(onLayerEdit).toHaveBeenCalledWith("wordmark", { enabled: false });
    // The eye is a separate control and writes nowhere near the master.
    act(() => { (row.querySelector('[aria-label="Hide Brand"]') as HTMLButtonElement).click(); });
    expect(onToggleHidden).toHaveBeenCalledWith("wordmark");
    expect(onLayerEdit).toHaveBeenCalledTimes(1);
  });

  it("leaves master policy read-only when no onLayerEdit is given", () => {
    renderPanel(shippedProps());
    expect(container.querySelector('[aria-label="Disable Brand on every label"]')).toBeNull();
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

// I4: reorder chevrons, custom rows only. plan.ts appends customLayers in
// stored order and draws later entries on top (see its comment above the
// custom-layer loop) — so the FIRST stored custom row is backmost ("Send
// backward" disabled there) and the LAST is frontmost ("Bring forward"
// disabled there).
describe("LayersPanel reorder chevrons", () => {
  function twoCustomLayerProps() {
    const props = shippedProps();
    const customLayers: import("../src/types").CustomLayer[] = [
      {
        id: "custom-a", name: "First", type: "text", size: 10,
        position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
        line: { text: "one", fill: "#000000", layer: "white" },
      },
      {
        id: "custom-b", name: "Second", type: "text", size: 10,
        position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
        line: { text: "two", fill: "#000000", layer: "white" },
      },
    ];
    const cfg = { ...props.cfg, customLayers };
    const master = lolevMaster();
    const r = composeConfig(master, [], {}, undefined);
    const rows = panelRows(master, r.layers, r.disabledLayers, cfg);
    return { ...props, cfg, rows };
  }

  function rowFor(name: string) {
    return Array.from(container.querySelectorAll("li"))
      .find((li) => li.textContent?.includes(name))!;
  }

  it("renders both chevrons on both custom rows with the expected aria-labels", () => {
    renderPanel(twoCustomLayerProps());
    for (const name of ["First", "Second"]) {
      const row = rowFor(name);
      expect(row.querySelector(`[aria-label="Bring ${name} forward"]`)).not.toBeNull();
      expect(row.querySelector(`[aria-label="Send ${name} backward"]`)).not.toBeNull();
    }
  });

  it("disables the first row's Send backward and the last row's Bring forward", () => {
    renderPanel(twoCustomLayerProps());
    const first = rowFor("First");
    const second = rowFor("Second");
    expect(first.querySelector('[aria-label="Send First backward"]'))
      .toHaveProperty("disabled", true);
    expect(first.querySelector('[aria-label="Bring First forward"]'))
      .toHaveProperty("disabled", false);
    expect(second.querySelector('[aria-label="Bring Second forward"]'))
      .toHaveProperty("disabled", true);
    expect(second.querySelector('[aria-label="Send Second backward"]'))
      .toHaveProperty("disabled", false);
  });

  it("clicking Bring forward / Send backward calls onMoveCustomLayer with the right delta", () => {
    const props = twoCustomLayerProps();
    renderPanel(props);
    const first = rowFor("First");
    const second = rowFor("Second");
    act(() => {
      (first.querySelector('[aria-label="Bring First forward"]') as HTMLButtonElement).click();
    });
    expect(props.onMoveCustomLayer).toHaveBeenCalledWith("custom-a", 1);
    act(() => {
      (second.querySelector('[aria-label="Send Second backward"]') as HTMLButtonElement).click();
    });
    expect(props.onMoveCustomLayer).toHaveBeenCalledWith("custom-b", -1);
  });
});
