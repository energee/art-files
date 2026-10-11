// shortcut-default-dom.test.tsx — the app's ⌘ shortcuts own their keys (#82).
// A shortcut the app binds must keep the browser's default for that key (⌘S's
// "Save page as") from firing even while the command is disabled, e.g. Save on
// a clean document: the key is the app's, it just has nothing to do right now.
// The ⌘ shortcuts also work while a text field has focus (#124); only the bare
// keys (1/2/3/R/G) stand aside there, since those are the text being typed.
// Inside an open modal dialog they still claim the key but act on nothing:
// the dialog blocks the tab behind it (#244).
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
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
let onMeta: Mock<(...args: unknown[]) => void>;
let onOpenProject: Mock<(...args: unknown[]) => void>;
let onCloseTab: Mock<(...args: unknown[]) => void>;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onMeta = vi.fn();
  onOpenProject = vi.fn();
  onCloseTab = vi.fn();
  await act(async () => {
    root.render(createElement(DocumentEditor, {
      active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta,
      saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
      onOpenProject, onNewTab: vi.fn(), onCloseTab,
      onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
    }));
  });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

/** Dispatch a keydown at `target` and report whether the app claimed it. */
const press = async (target: EventTarget, init: KeyboardEventInit): Promise<boolean> => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  await act(async () => { target.dispatchEvent(event); });
  return event.defaultPrevented;
};

it("⌘S on a clean document keeps the browser's Save Page dialog from opening", async () => {
  // An untitled tab starts dirty; the first ⌘S saves it (the download
  // fallback here) and leaves it clean, so Save is now disabled.
  await press(document.body, { key: "s", metaKey: true });
  expect(onMeta.mock.lastCall?.[0]).toMatchObject({ dirty: false });
  expect(await press(document.body, { key: "s", metaKey: true })).toBe(true);
});

it("a key no command binds is left to the browser", async () => {
  expect(await press(document.body, { key: "p", metaKey: true })).toBe(false);
});

/** Mount `el` in the editor's container and give it focus. */
const focused = <T extends HTMLElement>(el: T): T => {
  container.appendChild(el);
  el.focus();
  return el;
};

it("⌘ shortcuts still run while a text field has focus", async () => {
  const input = focused(document.createElement("input"));
  expect(await press(input, { key: "o", metaKey: true })).toBe(true);
  expect(onOpenProject).toHaveBeenCalledTimes(1);
  const div = document.createElement("div");
  div.contentEditable = "true";
  const editor = focused(div);
  expect(await press(editor, { key: "s", metaKey: true })).toBe(true);
  expect(onMeta.mock.lastCall?.[0]).toMatchObject({ dirty: false });
});

it("bare-key shortcuts stay inert while a text field has focus", async () => {
  const input = focused(document.createElement("input"));
  expect(await press(input, { key: "g" })).toBe(false);
  expect(await press(input, { key: "2" })).toBe(false);
});

it("⌘ shortcuts inside an open dialog leave the tab behind it alone (#244)", async () => {
  // A modal dialog (the Save Master review, Settings) with a button and a
  // field; keyOwner calls the field "text", but the dialog still owns ⌘ keys.
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("data-slot", "dialog-content");
  dialog.append(document.createElement("button"), document.createElement("input"));
  container.appendChild(dialog);
  for (const control of dialog.children) {
    (control as HTMLElement).focus();
    for (const key of ["w", "s"]) {
      // Still claimed, so the browser's own ⌘S opens nothing either.
      expect(await press(control, { key, metaKey: true })).toBe(true);
    }
  }
  // Focus in a Select list portalled out of the dialog: still blocked.
  const list = document.createElement("div");
  list.setAttribute("role", "listbox");
  list.tabIndex = -1;
  container.appendChild(list);
  list.focus();
  expect(await press(list, { key: "w", metaKey: true })).toBe(true);
  expect(onCloseTab).not.toHaveBeenCalled();
  expect(onMeta.mock.lastCall?.[0]).toMatchObject({ dirty: true }); // Save did not run
  // The dialog closed, the same key acts on the tab again.
  dialog.remove();
  await press(document.body, { key: "w", metaKey: true });
  expect(onCloseTab).toHaveBeenCalledTimes(1);
});

it("the arrow nudge and ⌘B leave the tab behind an open dialog alone (#244)", async () => {
  // Focus fell to the page (a clicked-away dialog button): keyOwner calls the
  // key the app's, but the modal still blocks the canvas and the sidebar.
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("data-slot", "dialog-content");
  container.appendChild(dialog);
  expect(await press(document.body, { key: "ArrowLeft" })).toBe(false);
  expect(await press(document.body, { key: "b", metaKey: true })).toBe(false);
  dialog.remove();
  expect(await press(document.body, { key: "ArrowLeft" })).toBe(true);
  expect(await press(document.body, { key: "b", metaKey: true })).toBe(true);
});
