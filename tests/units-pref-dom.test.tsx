// units-pref-dom.test.tsx — one unit preference (in / mm / pt / px) drives the
// rulers, the inspector's length fields and the canvas drag readout. It is set
// from the ruler corner or View → Units, and persists in the view entry of
// localStorage. The status bar has no trim-size readout any more: its only job
// was to open a third copy of the unit picker.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import type { Command } from "../src/components/CommandMenu";
import type { LengthUnit } from "../src/rulers";

const probe = vi.hoisted(() => ({
  actions: [] as Command[], checked: {} as Partial<Record<string, boolean>>,
  previewUnit: null as string | null,
  rulers: null as { unit: string; onUnitChange: (unit: LengthUnit) => void } | null,
}));
vi.mock("../src/components/PreviewCompare", () => ({
  SNAP_PT: 6, PreviewCompare: (props: { unit: string }) => { probe.previewUnit = props.unit; return null; },
}));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({
  Rulers: (props: { unit: string; onUnitChange: (unit: LengthUnit) => void }) => { probe.rulers = props; return null; },
}));
vi.mock("../src/components/AppMenu", () => ({
  AppMenu: (props: { actions: Command[]; checked: Partial<Record<string, boolean>> }) => {
    probe.actions = props.actions; probe.checked = props.checked; return null;
  },
}));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
import { DocumentEditor } from "../src/App";

Element.prototype.scrollIntoView ??= () => undefined;
let unmount: (() => Promise<void>) | null = null;
beforeEach(() => { localStorage.clear(); });
afterEach(async () => { await unmount?.(); unmount = null; document.body.replaceChildren(); localStorage.clear(); });

async function mountEditor() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(DocumentEditor, {
      active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
      saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
      onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
      onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
    }));
  });
  unmount = async () => { await act(async () => { root.unmount(); }); container.remove(); };
  return container;
}

const run = (id: string) => act(async () => { probe.actions.find((c) => c.id === id)!.run(); });
const stored = () => JSON.parse(localStorage.getItem("lolev-view") ?? "{}") as Record<string, unknown>;
/** The unit addon beside the selected layer's X field in the inspector. */
const xUnit = () => document.querySelector("#barcode-x")
  ?.closest("[data-slot=input-group]")?.querySelector("[data-slot=input-group-addon]")?.textContent;

it("has no status-bar trim readout", async () => {
  const container = await mountEditor();
  expect(container.querySelector('[aria-label^="Artboard size"]')).toBeNull();
  expect(container.textContent).not.toContain("8 × 5 in");
}, 30_000);

it("defaults to inches everywhere, with View → Units checked to match", async () => {
  await mountEditor();
  expect(probe.rulers?.unit).toBe("in");
  expect(probe.previewUnit).toBe("in");
  expect(probe.checked).toMatchObject({ "unit-in": true, "unit-mm": false, "unit-pt": false, "unit-px": false });
}, 30_000);

it("one choice, from the menu or the ruler corner, moves the rulers, readout and inspector, and persists", async () => {
  const container = await mountEditor();
  await run("unit-mm");
  expect(probe.rulers?.unit).toBe("mm");
  expect(probe.previewUnit).toBe("mm");
  expect(probe.checked).toMatchObject({ "unit-in": false, "unit-mm": true });
  expect(stored().unit).toBe("mm");
  // The inspector's length fields follow the same unit.
  const row = container.querySelector('[data-layer-id="barcode"] [data-slot="sidebar-menu-button"]') as HTMLElement;
  await act(async () => { row.click(); });
  expect(xUnit()).toBe("mm");
  await act(async () => { probe.rulers!.onUnitChange("px"); });
  expect(xUnit()).toBe("px");
  expect(probe.checked["unit-px"]).toBe(true);
  expect(stored()).toMatchObject({ unit: "px", showRulers: true, showGuides: true });
}, 30_000);

it("boots with the saved unit, and ignores one it does not know", async () => {
  localStorage.setItem("lolev-view", JSON.stringify({ unit: "pt" }));
  await mountEditor();
  expect(probe.rulers?.unit).toBe("pt");
  await unmount!(); unmount = null;
  localStorage.setItem("lolev-view", JSON.stringify({ unit: "furlong" }));
  await mountEditor();
  expect(probe.rulers?.unit).toBe("in");
}, 30_000);

it("keeps working when localStorage refuses the write", async () => {
  await mountEditor();
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  try {
    await run("unit-pt");
    expect(probe.rulers?.unit).toBe("pt");
  } finally {
    spy.mockRestore();
  }
}, 30_000);
