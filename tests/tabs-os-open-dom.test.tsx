// tabs-os-open-dom.test.tsx — OS file-opens that land during startup
// (issue #109): a path the Rust side queues after the shell's first drain
// but before its "project-file-opened" listener registers loses its emit,
// so the shell must drain again once the listener is live.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { FileToOpen } from "../src/App";

const mocks = vi.hoisted(() => ({
  /** The Rust-side OpenedFile queue take_opened_file pops from. */
  queue: [] as string[],
  /** Latest props each stub editor rendered with, by mount order. */
  editors: [] as Array<{ fileToOpen: FileToOpen | null }>,
}));

// Tauri's own IPC mocks, as in tabs-open-dom.test.tsx. The handler plays the
// Rust side: take_opened_file pops the queue, and a delivery landing while
// the listener is still registering (the #109 window) is queued with its
// emit lost — the mock sees the listen call before registering it.
const { mockIPC, mockWindows } = await import("@tauri-apps/api/mocks");
mockWindows("main");
mockIPC((cmd) => (cmd === "take_opened_file" ? mocks.queue.shift() ?? null : null));
const { invoke } = await import("@tauri-apps/api/core");
const realInvoke = (window as unknown as { __TAURI_INTERNALS__: { invoke: typeof invoke } })
  .__TAURI_INTERNALS__;
const ipcInvoke = realInvoke.invoke;
realInvoke.invoke = (async (cmd: string, args?: unknown, opts?: unknown) => {
  if (cmd === "plugin:event|listen" && (args as { event: string }).event === "project-file-opened") {
    // Rust: OpenedFile::push, then emit to no one — the listener is not
    // registered until this call returns.
    mocks.queue.push("/labels/Startup.label");
    return 1;
  }
  return (ipcInvoke as (c: string, a?: unknown, o?: unknown) => Promise<unknown>)(cmd, args, opts);
}) as typeof invoke;
(globalThis as { isTauri?: boolean }).isTauri = true; // what isTauri() reads
vi.mock("../src/components/DesktopUpdater", () => ({ DesktopUpdater: () => null }));
vi.mock("../src/App", async () => {
  const { useRef } = await import("react");
  return {
    DocumentEditor: (props: { fileToOpen: FileToOpen | null }) => {
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

it("opens a path queued while the listener was still registering", async () => {
  root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(TabsShell)); });
  // Let the dynamic event import, the listen round-trip and any drain settle.
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  expect(mocks.queue).toEqual([]);
  expect(mocks.editors[0]?.fileToOpen).toMatchObject({ path: "/labels/Startup.label" });
});
