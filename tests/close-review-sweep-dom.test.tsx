// close-review-sweep-dom.test.tsx — the close prompt's Save on a tab with
// master edits during a desktop window close (UX audit item 16): a cancelled
// master save aborts the whole sweep and the window stays up; one that saves
// the master of a tab whose .label is already saved closes that tab and moves
// the sweep on.
// The prompt is worded for quitting during the sweep, for closing a tab
// otherwise (#552). The editor is stubbed so the test drives masterSaveSlot
// directly.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { DocumentMeta } from "../src/App";

type Slot = { current: (() => Promise<boolean>) | null };
const mocks = vi.hoisted(() => ({
  /** Latest props each stub editor rendered with, by mount order. */
  editors: [] as Array<{ onMeta: (meta: DocumentMeta) => void; masterSaveSlot: Slot }>,
  /** IPC commands the shell sent, in order. */
  calls: [] as string[],
}));

const { mockIPC, mockWindows } = await import("@tauri-apps/api/mocks");
mockWindows("main");
mockIPC((cmd) => { mocks.calls.push(cmd); return null; }, { shouldMockEvents: true });
(globalThis as { isTauri?: boolean }).isTauri = true; // what isTauri() reads
vi.mock("../src/components/DesktopUpdater", () => ({ DesktopUpdater: () => null }));
vi.mock("../src/App", async () => {
  const { createElement: h, useRef } = await import("react");
  return {
    DocumentEditor: (props: (typeof mocks.editors)[number] & {
      tabStripHost?: (el: HTMLDivElement | null) => void;
    }) => {
      const slot = useRef(-1);
      if (slot.current < 0) slot.current = mocks.editors.push(props) - 1;
      else mocks.editors[slot.current] = props;
      return h("div", { ref: props.tabStripHost });
    },
  };
});

const { emit } = await import("@tauri-apps/api/event");
const { default: TabsShell } = await import("../src/TabsShell");

let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await act(async () => { root.unmount(); });
  mocks.editors.length = 0;
  mocks.calls.length = 0;
  document.body.replaceChildren();
});

/** A touched tab (edited); `dirty` = unsaved .label, `masterUnsaved` = master edits. */
const meta = (title: string, dirty: boolean, masterUnsaved: boolean): DocumentMeta =>
  ({ title, dirty, edited: true, masterUnsaved, filePath: null });

const prompt = () =>
  Array.from(document.querySelectorAll('[data-slot="dialog-content"]:not([data-closed])'))
    .find((d) => d.textContent?.includes("unsaved changes")) ?? null;
const button = (text: string) =>
  Array.from(prompt()!.querySelectorAll("button")).find((b) => b.textContent === text)!;
const tabCount = () => document.querySelectorAll('[role="tab"]').length;
const destroyed = () => mocks.calls.includes("plugin:window|destroy");

/** Two tabs: A with only master edits (its .label saved), B with label edits. */
async function twoTabsClosingWindow() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(TabsShell)); });
  await act(async () => { mocks.editors[0].onMeta(meta("A", false, true)); });
  await act(async () => { (document.querySelector('[aria-label="New tab"]') as HTMLElement).click(); });
  await act(async () => { mocks.editors[1].onMeta(meta("B", true, false)); });
  await act(async () => { await emit("tauri://close-requested"); });
  await vi.waitFor(() => expect(prompt()?.textContent).toContain("“A”"));
}

/** Clicks Save on the prompt for tab A (master edits), resolving the stub
 *  master save with `saved`. */
async function review(saved: boolean, beforeResolve?: () => void) {
  let resolve!: (saved: boolean) => void;
  mocks.editors[0].masterSaveSlot.current = () => new Promise((r) => { resolve = r; });
  await act(async () => { button("Save").click(); });
  expect(prompt()).toBeNull(); // hidden while the review is up
  await act(async () => { beforeResolve?.(); resolve(saved); });
}

it("words the prompt for quitting during a window close, and for the tab otherwise", async () => {
  await twoTabsClosingWindow();
  const title = () => prompt()!.querySelector('[data-slot="dialog-title"]')!.textContent;
  expect(title()).toBe("Save changes to “A” before quitting?");
  expect(prompt()!.textContent).toContain("cancel to keep Label Lab open");
  await act(async () => { button("Cancel").click(); });
  await act(async () => { (document.querySelector('[aria-label^="Close B"]') as HTMLElement).click(); });
  await vi.waitFor(() => expect(prompt()?.textContent).toContain("“B”"));
  expect(title()).toBe("Close “B”?");
  expect(prompt()!.textContent).toContain("keep the tab open");
});

it("a cancelled review aborts the window close and keeps every tab", async () => {
  await twoTabsClosingWindow();
  await review(false);
  expect(prompt()).toBeNull();
  expect(tabCount()).toBe(2);
  expect(destroyed()).toBe(false);
  // The sweep is over: closing clean tab A now shows nothing further.
  await act(async () => { mocks.editors[0].onMeta(meta("A", false, false)); });
  await act(async () => { (document.querySelector('[aria-label^="Close A"]') as HTMLElement).click(); });
  expect(prompt()).toBeNull();
  expect(destroyed()).toBe(false);
});

it("a saved review closes a tab with nothing else unsaved and moves the sweep on", async () => {
  await twoTabsClosingWindow();
  // The editor's contract (DocumentEditor's reviewEnded): onMeta reports the
  // saved master first, then the review resolves — so the shell decides the
  // close on post-save meta.
  await review(true, () => mocks.editors[0].onMeta(meta("A", false, false)));
  // The sweep only hands the prompt on once A has closed.
  await vi.waitFor(() => expect(prompt()?.textContent).toContain("“B”"));
  expect(destroyed()).toBe(false);
  await act(async () => { button("Discard").click(); });
  await vi.waitFor(() => expect(destroyed()).toBe(true));
});
