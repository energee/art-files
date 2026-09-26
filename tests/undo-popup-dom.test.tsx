// undo-popup-dom.test.tsx — ⌘Z / ⇧⌘Z inside an open dialog (#225).
// A modal dialog (the Save Master review, Settings) owns the keys while it
// has focus, so the history keys must not undo or redo the canvas behind it.
// Non-modal popups are not modal dialogs: ⌘Z in the docked inspector, a
// color popover or on a Select trigger still undoes the edit made there.
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
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  document.body.replaceChildren();
});

const power = () => container.querySelector(
  '[data-layer-id="collabLead"] button[aria-label$=": enabled"]') as HTMLButtonElement;
const on = () => power().getAttribute("aria-pressed");
const pressZ = (target: EventTarget, shiftKey = false) => act(async () => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, shiftKey, bubbles: true, cancelable: true }));
});

/** A focused button inside a portalled overlay with these attributes —
 *  DialogContent is the Save Master review's; a bare role="dialog" is a
 *  Popover's (the color picker); role="combobox" is a closed Select trigger. */
const buttonIn = (attrs: Record<string, string>) => {
  const overlay = document.createElement("div");
  for (const [k, v] of Object.entries(attrs)) overlay.setAttribute(k, v);
  const button = document.createElement("button");
  overlay.appendChild(button);
  document.body.appendChild(overlay);
  button.focus();
  return button;
};
const dialogButton = () => buttonIn({ role: "dialog", "data-slot": "dialog-content" });

it("⌘Z and ⇧⌘Z inside an open dialog leave the canvas behind it alone", async () => {
  await act(async () => power().click());
  expect(on()).toBe("true");
  const button = dialogButton();
  await pressZ(button);
  expect(on()).toBe("true");
  // With the dialog still open, even focus outside it leaves the canvas alone (#244).
  await pressZ(document.body);
  expect(on()).toBe("true");
  button.parentElement!.remove(); // the dialog closes
  await pressZ(document.body);
  expect(on()).toBe("false");
  await pressZ(dialogButton(), true);
  expect(on()).toBe("false");
}, 20_000);

it("⌘Z in a non-modal popover or on a Select trigger still undoes", async () => {
  await act(async () => power().click());
  await pressZ(buttonIn({ role: "dialog", "data-slot": "popover-content" }));
  expect(on()).toBe("false");
  await act(async () => power().click());
  await pressZ(buttonIn({ role: "combobox" }));
  expect(on()).toBe("false");
}, 20_000);

it("⌘Z on a control in the docked inspector still undoes the edit", async () => {
  await act(async () => power().click());
  // Select the layer so the inspector opens, then focus one of its buttons.
  const row = container.querySelector(
    '[data-layer-id="collabLead"] [data-slot="sidebar-menu-button"]') as HTMLButtonElement;
  await act(async () => row.click());
  const inspectorButton = document.querySelector('[data-slot="sheet-content"] button') as HTMLButtonElement;
  expect(inspectorButton).not.toBeNull();
  inspectorButton.focus();
  await pressZ(inspectorButton);
  expect(on()).toBe("false");
}, 20_000);
