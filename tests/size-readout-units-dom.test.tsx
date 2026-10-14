// size-readout-units-dom.test.tsx — the status-bar trim-size readout opens
// an explicit unit picker (UX audit 18) instead of cycling units blind: the
// same Inches/Points/Pixels group as the ruler corner, with the current unit
// pressed, and one shared unit state behind both.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";

vi.mock("../src/components/PreviewCompare", () => ({ PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
import { DocumentEditor } from "../src/App";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(DocumentEditor, {
      active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
      saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
      onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
      onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
    }));
  });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

const readout = () => container.querySelector<HTMLButtonElement>('[aria-label^="Artboard size"]')!;
const unitButton = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>(
  '[aria-label="Ruler measurement units"] button')).find((b) => b.textContent === name);

async function open() {
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
      readout().dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    readout().click();
  });
}

it("opens a unit picker with the current unit pressed, instead of cycling", async () => {
  expect(readout().textContent).toContain("8 × 5 in");
  expect(readout().getAttribute("aria-label")).toMatch(/choose units/);
  await open();
  // Opening alone changes nothing.
  expect(readout().textContent).toContain("8 × 5 in");
  expect(unitButton("Inches")?.getAttribute("aria-pressed")).toBe("true");
  expect(unitButton("Points")?.getAttribute("aria-pressed")).toBe("false");
  expect(unitButton("Pixels")).toBeDefined();
});

it("picking a unit sets it", async () => {
  await open();
  await act(async () => { unitButton("Pixels")!.click(); });
  expect(readout().textContent).toContain("4800 × 3000 px");
});
