// tabs-unsaved-sync-dom.test.tsx — the shell tells the Rust side whether any
// tab holds unsaved work (issue #151), so macOS app-level quits (Dock → Quit,
// logout, AppleScript) can cancel and run the unsaved prompt — and let a
// clean quit through untouched (see src-tauri/src/terminate.rs).
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
  const { useRef } = await import("react");
  return {
    DocumentEditor: (props: { onMeta: (meta: DocumentMeta) => void }) => {
      const slot = useRef(-1);
      if (slot.current < 0) slot.current = mocks.editors.push(props) - 1;
      else mocks.editors[slot.current] = props;
      return null;
    },
  };
});

const { default: TabsShell } = await import("../src/TabsShell");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot>;
afterEach(async () => { await act(async () => { root.unmount(); }); });

const meta = (edited: boolean): DocumentMeta =>
  ({ title: "Labradorite", dirty: edited, edited, filePath: null });

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
