// offvariant-image-drop-dom.test.tsx — an image dropped on a layer of a
// switched-OFF variant must show in that layer's well straight away, not only
// once the variant is switched on (#222). FileDrop is replaced by a
// prop-capturing stub so the test can drop a file and read the well; the
// document model and App wiring are real.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";

type DropProps = { label: string; fileName?: string; onFile: (f: File) => unknown };
const wells = vi.hoisted(() => ({ image: null as null | DropProps }));
vi.mock("../src/components/FileDrop", () => ({
  CHECKER: "", FILE_DROP_ATTR: "data-file-drop",
  FileDrop: (p: DropProps) => { if (p.label === "Image") wells.image = p; return null; },
}));
vi.mock("../src/components/PreviewCompare", () => ({ PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
import { DocumentEditor } from "../src/App";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  wells.image = null;
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
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

it("an off variant's image layer shows the file dropped on it (#222)", async () => {
  // collabLeft belongs to the Collab variant, which a fresh label leaves off.
  const row = container.querySelector('[data-layer-id="collabLeft"]')!;
  await act(async () => {
    (row.querySelector('[data-slot="sidebar-menu-button"]') as HTMLButtonElement).click();
  });
  expect(wells.image?.fileName).toBeUndefined();
  const svg = new File(['<svg viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z"/></svg>'],
    "logo.svg", { type: "image/svg+xml" });
  await act(async () => { await wells.image!.onFile(svg); });
  expect(wells.image!.fileName).toBe("logo.svg");
});
