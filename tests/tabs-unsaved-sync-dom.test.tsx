// tabs-unsaved-sync-dom.test.tsx — the shell tells the Rust side whether any
// tab holds unsaved work (issue #151), so macOS app-level quits (Dock → Quit,
// logout, AppleScript) can cancel and run the unsaved prompt — and let a
// clean quit through untouched (see src-tauri/src/terminate.rs).
// It also checks the tab close button names that unsaved work to screen
// readers (issue #403).
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { DocumentMeta } from "../src/App";

const mocks = vi.hoisted(() => ({
  /** Every set_unsaved payload the shell sent, in order. */
  reported: [] as boolean[],
  /** Latest onMeta each stub editor rendered with, by mount order. */
  editors: [] as Array<{ onMeta: (meta: DocumentMeta) => void }>,
}));

const { mockIPC, mockWindows } = await import("@tauri-apps/api/mocks");
mockWindows("main");
mockIPC((cmd, args) => {
  if (cmd === "set_unsaved") mocks.reported.push((args as { unsaved: boolean }).unsaved);
  return null;
}, { shouldMockEvents: true });
(globalThis as { isTauri?: boolean }).isTauri = true; // what isTauri() reads
vi.mock("../src/components/DesktopUpdater", () => ({ DesktopUpdater: () => null }));
vi.mock("../src/App", async () => {
  const { createElement: h, useRef } = await import("react");
  return {
    DocumentEditor: (props: {
      onMeta: (meta: DocumentMeta) => void;
      tabStripHost?: (el: HTMLDivElement | null) => void;
    }) => {
      const slot = useRef(-1);
      if (slot.current < 0) slot.current = mocks.editors.push(props) - 1;
      else mocks.editors[slot.current] = props;
      // Mount the strip host so the tab strip (and its close buttons) renders.
      return h("div", { ref: props.tabStripHost });
    },
  };
});

const { default: TabsShell } = await import("../src/TabsShell");

let root: ReturnType<typeof createRoot>;
afterEach(async () => { await act(async () => { root.unmount(); }); });

const meta = (edited: boolean): DocumentMeta =>
  ({ title: "Labradorite", dirty: edited, edited, masterUnsaved: false, filePath: null });

it("reports unsaved work to the Rust side as it comes and goes", async () => {
  root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(TabsShell)); });
  // A fresh Untitled tab is not unsaved work.
  expect(mocks.reported).toEqual([false]);

  await act(async () => { mocks.editors[0].onMeta(meta(true)); });
  expect(mocks.reported).toEqual([false, true]);

  await act(async () => { mocks.editors[0].onMeta(meta(false)); });
  expect(mocks.reported).toEqual([false, true, false]);
});

it("names unsaved work on the tab's close button (#403)", async () => {
  const host = document.createElement("div");
  root = createRoot(host);
  await act(async () => { root.render(createElement(TabsShell)); });
  const closeLabel = () =>
    host.querySelector('[aria-label^="Close "]')?.getAttribute("aria-label");
  const editor = mocks.editors[mocks.editors.length - 1];

  await act(async () => { editor.onMeta(meta(true)); });
  expect(closeLabel()).toBe("Close Labradorite (unsaved changes)");

  await act(async () => { editor.onMeta(meta(false)); });
  expect(closeLabel()).toBe("Close Labradorite");
});
