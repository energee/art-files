// qr-link-suffix-dom.test.tsx — the QR inspector's "followed by" picker must
// show the chosen option's LABEL ("nothing", a layer's name), never the raw
// select value ("none", a layer id) (#222).
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const trigger = () => document.querySelector<HTMLElement>('[aria-label="Link suffix"]')!;
// The displayed value alone, without the trigger's chevron.
const shown = () => trigger().querySelector('[data-slot="select-value"]')!.textContent;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(DocumentEditor, {
      active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
      saveSlot: { current: null } as never, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
      onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
      onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
    }));
  });
  const row = container.querySelector('[data-layer-id="qr"]')!;
  await act(async () => {
    (row.querySelector('[data-slot="sidebar-menu-button"]') as HTMLButtonElement).click();
  });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

it("names the feeding text layer by its layer name, not its id", () => {
  // The shipped QR is followed by {name|slug}: layer id "name", named "Name".
  expect(shown()).toBe("Name");
});

it("shows 'nothing' — the option's label — once the suffix is cleared", async () => {
  await act(async () => { trigger().click(); });
  const nothing = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    .find((o) => o.textContent === "nothing")!;
  await act(async () => { nothing.click(); });
  expect(shown()).toBe("nothing");
});
