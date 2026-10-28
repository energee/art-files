// inspector-escape-dom.test.tsx — Escape and the right-hand inspector (#117).
// Escape that an input already owns (cancel a draft, close suggestions, end an
// on-canvas edit or drag) must not also close the inspector and clear the
// selection; a bare Escape with nothing editable focused still closes it, and
// so does the inspector's visible close button.
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

it("Escape in the layer name box puts the name back but keeps the inspector and selection", async () => {
  const name = document.querySelector("#barcode-name") as HTMLInputElement;
  const before = name.value;
  await act(async () => {
    name.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Draft");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(name.value).toBe("Draft");
  await escape(name);
  expect(name.value).toBe(before);
  expectInspectorOpenAndSelected();
});

it("a rename typed in the name box is one undo step", async () => {
  const name = () => document.querySelector("#barcode-name") as HTMLInputElement;
  const before = name().value;
  for (const text of ["B", "Ba", "Bar"]) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name(), text);
      name().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await act(async () => { name().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  expect(name().value).toBe("Bar");
  await act(async () => {
    name().blur();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
  });
  expect(name().value).toBe(before);
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

const closeButton = () => document.querySelector('[aria-label="Close inspector"]') as HTMLButtonElement | null;

it("the visible close button closes the inspector and clears the selection, like Escape", async () => {
  const close = closeButton();
  expect(close?.tagName).toBe("BUTTON");
  await act(async () => { close!.focus(); });
  expect(document.activeElement).toBe(close);
  await act(async () => { close!.click(); });
  expect(rowButton().getAttribute("data-active")).toBeNull();
  expect(field()).toBeNull();
});

it("an outside press keeps a multi-selection and the inspector open", async () => {
  const qr = container.querySelector('[data-layer-id="qr"] [data-slot="sidebar-menu-button"]') as HTMLButtonElement;
  await act(async () => { qr.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })); });
  expect(qr.getAttribute("data-active")).not.toBeNull();
  expect(rowButton().getAttribute("data-active")).not.toBeNull();
  await act(async () => {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(qr.getAttribute("data-active")).not.toBeNull();
  expect(rowButton().getAttribute("data-active")).not.toBeNull();
  expect(closeButton()).not.toBeNull();
});

it("closing from the close button by keyboard returns focus to where the layer was selected, like Escape", async () => {
  // Reopen with the row focused, so there is a place to return to.
  await escape(document.body);
  await act(async () => { rowButton().focus(); rowButton().click(); });
  const close = closeButton()!;
  await act(async () => {
    close.focus();
    close.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    close.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
  });
  await act(async () => { await Promise.resolve(); });
  expect(field()).toBeNull();
  expect(document.activeElement).toBe(rowButton());
});
