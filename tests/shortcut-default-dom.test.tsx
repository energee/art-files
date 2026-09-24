// shortcut-default-dom.test.tsx — the app's ⌘ shortcuts own their keys (#82).
// A shortcut the app binds must keep the browser's default for that key (⌘S's
// "Save page as") from firing even while the command is disabled, e.g. Save on
// a clean document: the key is the app's, it just has nothing to do right now.
// The ⌘ shortcuts also work while a text field has focus (#124); only the bare
// keys (1/2/3/R/G) stand aside there, since those are the text being typed.
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
let onMeta: ReturnType<typeof vi.fn>;
let onOpenProject: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onMeta = vi.fn();
  onOpenProject = vi.fn();
  await act(async () => {
    root.render(createElement(DocumentEditor, {
      active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta,
      saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
      onOpenProject, onNewTab: vi.fn(), onCloseTab: vi.fn(),
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

it("⌘ shortcuts still run while a text field has focus", async () => {
  const input = document.createElement("input");
  container.appendChild(input);
  input.focus();
  expect(await press(input, { key: "o", metaKey: true })).toBe(true);
  expect(onOpenProject).toHaveBeenCalledTimes(1);
  const editor = document.createElement("div");
  editor.contentEditable = "true";
  container.appendChild(editor);
  editor.focus();
  expect(await press(editor, { key: "s", metaKey: true })).toBe(true);
  expect(onMeta.mock.lastCall?.[0]).toMatchObject({ dirty: false });
});

it("bare-key shortcuts stay inert while a text field has focus", async () => {
  const input = document.createElement("input");
  container.appendChild(input);
  input.focus();
  expect(await press(input, { key: "g" })).toBe(false);
  expect(await press(input, { key: "2" })).toBe(false);
});
