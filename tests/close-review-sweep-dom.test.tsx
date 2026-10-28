// close-review-sweep-dom.test.tsx — the close prompt's Save on a tab with
// master edits during a desktop window close (UX audit item 16): a cancelled
// master save aborts the whole sweep and the window stays up; one that saves
// the master of a tab whose .label is already saved closes that tab and moves
// the sweep on.
// The prompt is worded for quitting during the sweep, for closing a tab
// otherwise (#552). With more than one unsaved tab the sweep asks once first
// — Review Changes… (the per-tab prompts) / Discard All / Cancel — and the
// updater's Restart Now runs the same sweep (beforeRestart) without closing
// the window. The editor and the updater are stubbed so the test drives
// masterSaveSlot and beforeRestart directly.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { DocumentMeta } from "../src/App";

type Slot = { current: (() => Promise<boolean>) | null };
const mocks = vi.hoisted(() => ({
  /** Latest props each stub editor rendered with, by mount order. */
  editors: [] as Array<{ onMeta: (meta: DocumentMeta) => void; masterSaveSlot: Slot }>,
  /** The updater stub's latest props. */
  updater: null as null | { beforeRestart?: () => Promise<boolean> },
  /** IPC commands the shell sent, in order. */
  calls: [] as string[],
}));

const { mockIPC, mockWindows } = await import("@tauri-apps/api/mocks");
mockWindows("main");
mockIPC((cmd) => { mocks.calls.push(cmd); return null; }, { shouldMockEvents: true });
(globalThis as { isTauri?: boolean }).isTauri = true; // what isTauri() reads
vi.mock("../src/components/DesktopUpdater", () => ({
  DesktopUpdater: (props: NonNullable<typeof mocks.updater>) => { mocks.updater = props; return null; },
}));
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

const openDialogs = () =>
  Array.from(document.querySelectorAll('[data-slot="dialog-content"]:not([data-closed])'));
/** The per-tab Save / Discard / Cancel prompt. */
const prompt = () =>
  openDialogs().find((d) => d.textContent?.includes("unsaved changes") && !d.textContent.includes("Discard All")) ?? null;
/** The one-time prompt before a sweep of more than one unsaved tab. */
const summary = () => openDialogs().find((d) => d.textContent?.includes("Discard All")) ?? null;
const button = (text: string, scope = prompt()) =>
  Array.from(scope!.querySelectorAll("button")).find((b) => b.textContent === text)!;
const tabCount = () => document.querySelectorAll('[role="tab"]').length;
const destroyed = () => mocks.calls.includes("plugin:window|destroy");

/** Two tabs: A with only master edits (its .label saved), B with label edits. */
async function twoUnsavedTabs() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(TabsShell)); });
  await act(async () => { mocks.editors[0].onMeta(meta("A", false, true)); });
  await act(async () => { (document.querySelector('[aria-label="New tab"]') as HTMLElement).click(); });
  await act(async () => { mocks.editors[1].onMeta(meta("B", true, false)); });
}

/** Two unsaved tabs, a window close, and Review Changes… on the one-time
 *  prompt: the per-tab prompt is up for A. */
async function twoTabsClosingWindow() {
  await twoUnsavedTabs();
  await act(async () => { await emit("tauri://close-requested"); });
  await vi.waitFor(() => expect(summary()).not.toBeNull());
  await act(async () => { button("Review Changes…", summary()).click(); });
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

it("asks once before walking more than one unsaved tab", async () => {
  await twoUnsavedTabs();
  await act(async () => { await emit("tauri://close-requested"); });
  await vi.waitFor(() => expect(summary()).not.toBeNull());
  expect(prompt()).toBeNull();
  expect(summary()!.textContent).toContain("2 tabs have unsaved changes");
  expect(Array.from(summary()!.querySelectorAll("button")).map((b) => b.textContent))
    .toEqual(["Cancel", "Discard All", "Review Changes…"]);
});

it("Discard All quits without a prompt per tab", async () => {
  await twoUnsavedTabs();
  await act(async () => { await emit("tauri://close-requested"); });
  await vi.waitFor(() => expect(summary()).not.toBeNull());
  await act(async () => { button("Discard All", summary()).click(); });
  await vi.waitFor(() => expect(destroyed()).toBe(true));
  expect(prompt()).toBeNull();
});

it("Cancel on the one-time prompt keeps the window and every tab", async () => {
  await twoUnsavedTabs();
  await act(async () => { await emit("tauri://close-requested"); });
  await vi.waitFor(() => expect(summary()).not.toBeNull());
  await act(async () => { button("Cancel", summary()).click(); });
  expect(summary()).toBeNull();
  expect(prompt()).toBeNull();
  expect(tabCount()).toBe(2);
  expect(destroyed()).toBe(false);
});

it("one unsaved tab goes straight to its own prompt", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(TabsShell)); });
  await act(async () => { mocks.editors[0].onMeta(meta("A", true, false)); });
  await act(async () => { await emit("tauri://close-requested"); });
  await vi.waitFor(() => expect(prompt()?.textContent).toContain("“A”"));
  expect(summary()).toBeNull();
});

it("the updater's restart runs the same sweep and keeps the window", async () => {
  await twoUnsavedTabs();
  let restart!: Promise<boolean>;
  await act(async () => { restart = mocks.updater!.beforeRestart!(); });
  await vi.waitFor(() => expect(summary()).not.toBeNull());
  await act(async () => { button("Cancel", summary()).click(); });
  await expect(restart).resolves.toBe(false);
  await act(async () => { restart = mocks.updater!.beforeRestart!(); });
  await act(async () => { button("Discard All", summary()).click(); });
  await expect(restart).resolves.toBe(true);
  // The updater relaunches; the shell never destroys the window itself.
  expect(destroyed()).toBe(false);
});

it("the updater's restart goes ahead at once with nothing unsaved", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(TabsShell)); });
  await act(async () => { mocks.editors[0].onMeta(meta("A", false, false)); });
  await expect(mocks.updater!.beforeRestart!()).resolves.toBe(true);
  expect(summary()).toBeNull();
  expect(prompt()).toBeNull();
});
