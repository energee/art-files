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
import { addLayer, composeConfig } from "../src/model/document";
import { panelRows } from "../src/model/panel";
import type { CustomLayer } from "../src/types";

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

// Task 5b fix round 1 (Important): a materialized custom row's Lock must
// route through onMaterializedLayerEdit (MasterLayer.locked), never through
// `update` (which used to diff the whole cfg.customLayers array wholesale
// into master.defaults.customLayers and get silently reverted on the next
// resolve). A LEGACY per-label custom row — no MasterLayer backing it —
// must keep using `update`, exactly as before this fix.
describe("LayersPanel Lock button (Task 5b fix round 1)", () => {
  function twoLockableCustomRowsProps() {
    const props = shippedProps();
    const master = addLayer(lolevMaster(), "master",
      { id: "custom-a", name: "Materialized", enabled: true, kind: "text" },
      {
        type: "text", size: 10,
        position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
        line: { text: "m", fill: "#000000", layer: "white" },
      });
    const r = composeConfig(master, [], {}, undefined);
    const legacy: CustomLayer = {
      id: "custom-b", name: "Legacy", type: "text", size: 10,
      position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
      line: { text: "l", fill: "#000000", layer: "white" },
    };
    const cfg = { ...r.config, customLayers: [...(r.config.customLayers ?? []), legacy] };
    const rows = panelRows(master, r.layers, r.disabledLayers, cfg);
    return { ...props, cfg, rows, master };
  }

  function rowFor(name: string) {
    return Array.from(container.querySelectorAll("li"))
      .find((li) => li.textContent?.includes(name))!;
  }

  it("a materialized row's Lock calls onMaterializedLayerEdit, not update or onLayerEdit", () => {
    const props = twoLockableCustomRowsProps();
    const onLayerEdit = vi.fn();
    const onMaterializedLayerEdit = vi.fn();
    renderPanel({ ...props, onLayerEdit, onMaterializedLayerEdit });
    const row = rowFor("Materialized");
    act(() => {
      (row.querySelector('[aria-label="Lock Materialized"]') as HTMLButtonElement).click();
    });
    expect(onMaterializedLayerEdit).toHaveBeenCalledWith("custom-a", { locked: true });
    expect(onLayerEdit).not.toHaveBeenCalled();
    expect(props.update).not.toHaveBeenCalled();
  });

  it("a legacy row's Lock still calls update, not onMaterializedLayerEdit", () => {
    const props = twoLockableCustomRowsProps();
    const onLayerEdit = vi.fn();
    const onMaterializedLayerEdit = vi.fn();
    renderPanel({ ...props, onLayerEdit, onMaterializedLayerEdit });
    const row = rowFor("Legacy");
    act(() => {
      (row.querySelector('[aria-label="Lock Legacy"]') as HTMLButtonElement).click();
    });
    expect(props.update).toHaveBeenCalledTimes(1);
    expect(onMaterializedLayerEdit).not.toHaveBeenCalled();
    expect(onLayerEdit).not.toHaveBeenCalled();
  });
});

// Finding #7 (HIGH): a MasterLayer.id is an unvalidated string, so a variant
// can append a Variant.layers row whose id is neither a doc layer id nor a
// known ELEMENTS/custom-* id. elementById(id) used to throw for that id and
// crash the whole sidebar. Craft such a row directly (panelRows only ever
// forwards MasterLayer.id verbatim, so this is exactly what it would produce)
// and confirm the row renders instead of throwing.
describe("LayersPanel with an id absent from ELEMENTS (finding #7)", () => {
  it("renders the row instead of throwing", () => {
    const props = shippedProps();
    const unknownRow = {
      id: "not-a-real-element", name: "Mystery Layer", inactive: false,
      custom: false, materialized: false, locked: false, enabled: true,
    };
    expect(() => renderPanel({ ...props, rows: [...props.rows, unknownRow] }))
      .not.toThrow();
    expect(container.textContent).toContain("Mystery Layer");
  });
});

// I4: reorder chevrons, custom rows only. plan.ts appends customLayers in
// stored order and draws later entries on top (see its comment above the
// custom-layer loop) — so the FIRST stored custom row is backmost ("Send
// backward" disabled there) and the LAST is frontmost ("Bring forward"
// disabled there).
//
// Fix round 2 (finding 14): "first"/"last" mean first and last of the row's
// OWN reorder group — the list App's onMoveCustomLayer → moveLayer can
// actually swap within — not of the flat panel list. The layers here are
// therefore MATERIALIZED (added to the master with addLayer), which is what
// "Add layer" produces; the two cases the flat derivation got wrong get
// their own tests below.
describe("LayersPanel reorder chevrons", () => {
  const textLayer = (id: string, name: string) =>
    ({ id, name, enabled: true, kind: "text" as const });
  const textStyle = (text: string) => ({
    type: "text", size: 10,
    position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
    line: { text, fill: "#000000", layer: "white" },
  });

  /** Panel props for a master carrying `layers` as materialized custom
   *  layers at the given targets, with `enabled` variants on. */
  function propsFor(
    layers: { id: string; name: string; target: "master" | { variant: string } }[],
    enabled: string[] = [],
  ) {
    let master = lolevMaster();
    for (const l of layers)
      master = addLayer(master, l.target, textLayer(l.id, l.name), textStyle(l.name));
    const r = composeConfig(master, enabled, {}, undefined);
    const rows = panelRows(master, r.layers, r.disabledLayers, r.config);
    return { ...shippedProps(), cfg: r.config, rows };
  }

  const twoCustomLayerProps = () => propsFor([
    { id: "custom-a", name: "First", target: "master" },
    { id: "custom-b", name: "Second", target: "master" },
  ]);

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

  // Fix round 2, finding 14 (the repro the reviewer gave): one custom layer
  // on the master and one on an ENABLED variant. Both rows sit in the one
  // flat panel list, so the old flat derivation enabled Bring-forward on the
  // master's row and Send-backward on the variant's — and both clicks were
  // silent no-ops, because moveLayer only ever swaps within ONE list, and
  // each layer is alone in its own. Every arrow must now be disabled.
  it("scopes atBack/atFront to the owning list, not the flat panel list", () => {
    renderPanel(propsFor([
      { id: "custom-a", name: "OnMaster", target: "master" },
      { id: "custom-b", name: "OnVariant", target: { variant: "collab" } },
    ], ["collab"]));
    for (const name of ["OnMaster", "OnVariant"]) {
      const row = rowFor(name);
      expect(row.querySelector(`[aria-label="Send ${name} backward"]`))
        .toHaveProperty("disabled", true);
      expect(row.querySelector(`[aria-label="Bring ${name} forward"]`))
        .toHaveProperty("disabled", true);
    }
  });

  // The other half of finding 14: a LEGACY per-label custom layer has no
  // MasterLayer entry at all, so moveLayer can never move it. It used to
  // render two enabled arrows that did nothing; it now renders none.
  it("offers no chevrons at all on a legacy per-label custom row", () => {
    const props = shippedProps();
    const legacy: CustomLayer = {
      id: "custom-legacy", name: "Legacy", type: "text", size: 10,
      position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
      line: { text: "x", fill: "#000000", layer: "white" },
    };
    const master = lolevMaster();
    const cfg = { ...props.cfg, customLayers: [legacy] };
    const r = composeConfig(master, [], {}, undefined);
    renderPanel({ ...props, cfg, rows: panelRows(master, r.layers, r.disabledLayers, cfg) });
    const row = rowFor("Legacy");
    expect(row.querySelector('[aria-label="Send Legacy backward"]')).toBeNull();
    expect(row.querySelector('[aria-label="Bring Legacy forward"]')).toBeNull();
  });
});
