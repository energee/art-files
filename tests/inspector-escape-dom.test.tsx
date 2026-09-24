// inspector-escape-dom.test.tsx — Escape and the right-hand inspector (#117).
// Escape that an input already owns (cancel a draft, close suggestions, end an
// on-canvas edit or drag) must not also close the inspector and clear the
// selection; a bare Escape with nothing editable focused still closes it.
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  // Select the barcode: its inspector fills through a ChoiceBox.
  await act(async () => { rowButton().click(); });
  expectInspectorOpenAndSelected();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

const rowButton = () => container.querySelector(
  '[data-layer-id="barcode"] [data-slot="sidebar-menu-button"]') as HTMLButtonElement;
// The inspector is a Sheet portalled to document.body.
const field = () => document.querySelector("#barcode-content") as HTMLInputElement | null;
const expectInspectorOpenAndSelected = () => {
  expect(field()).not.toBeNull();
  expect(rowButton().getAttribute("data-active")).not.toBeNull();
};
const escape = async (target: EventTarget) => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
};

it("Escape in an inspector ChoiceBox cancels its draft but keeps the inspector and selection", async () => {
  const input = field()!;
  await act(async () => { input.focus(); });
  expect(document.querySelectorAll("[data-choice]").length).toBeGreaterThan(0);
  await escape(input);
  expect(document.querySelectorAll("[data-choice]")).toHaveLength(0);
  expectInspectorOpenAndSelected();
});

it("Escape ending an on-canvas text edit does not deselect", async () => {
  // Stand-in for PreviewCompare's in-place editor: an editable outside the sheet.
  const editor = document.createElement("div");
  editor.contentEditable = "true";
  container.appendChild(editor);
  editor.focus();
  await escape(editor);
  expectInspectorOpenAndSelected();
});

it("Escape already handled elsewhere (a cancelled canvas drag) does not deselect", async () => {
  const handled = (e: KeyboardEvent) => { if (e.key === "Escape") e.preventDefault(); };
  document.addEventListener("keydown", handled, true);
  try {
    await escape(document.body);
  } finally {
    document.removeEventListener("keydown", handled, true);
  }
  expectInspectorOpenAndSelected();
});

it("a bare Escape with nothing editable focused still closes the inspector", async () => {
  (document.activeElement as HTMLElement | null)?.blur();
  await escape(document.body);
  expect(rowButton().getAttribute("data-active")).toBeNull();
});
