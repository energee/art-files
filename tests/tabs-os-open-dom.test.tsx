// tabs-os-open-dom.test.tsx — OS file-opens that land during startup
// (issue #109): a path the Rust side queues while the shell's
// "project-file-opened" listener is still registering loses its emit, so
// the shell must drain once the listener is live. Also: a delivered path
// that isn't a .label names itself in an error toast instead of vanishing (#554),
// and a cancelled open closes the tab made for it, never a reused one (#553).
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FileToOpen } from "../src/App";
import { mountToaster, shown, toastTitles, unmountToaster } from "./real-timer-toaster";

const mocks = vi.hoisted(() => ({
  /** The Rust-side OpenedFile queue take_opened_file pops from. */
  queue: [] as string[],
  /** What the Rust side delivers while the listener registers. */
  atListen: [] as string[],
  /** Latest props each stub editor rendered with, by mount order. */
  editors: [] as Array<{
    fileToOpen: FileToOpen | null;
    onOpenSettled: (seq: number, cancelled: boolean) => void;
  }>,
  /** Editors currently mounted: one per open tab. */
  mounted: 0,
}));

// Tauri's own IPC mocks, as in tabs-open-dom.test.tsx. The handler plays the
// Rust side: take_opened_file pops the queue, and a delivery landing while
// the listener is still registering (the #109 window) is queued with its
// emit lost — the mock sees the listen call before registering it.
const { mockIPC, mockWindows } = await import("@tauri-apps/api/mocks");
mockWindows("main");
mockIPC((cmd, args) => {
  if (cmd === "take_opened_file") return mocks.queue.shift() ?? null;
  // Without shouldMockEvents, listen() reaches this handler. Rust side:
  // OpenedFile::push, then an emit to no one — the listener is not
  // registered until this call returns.
  if (cmd === "plugin:event|listen" && (args as { event: string }).event === "project-file-opened") {
    mocks.queue.push(...mocks.atListen);
  }
  return null;
});
(globalThis as { isTauri?: boolean }).isTauri = true; // what isTauri() reads
vi.mock("../src/components/DesktopUpdater", () => ({ DesktopUpdater: () => null }));
vi.mock("../src/App", async () => {
  const { createElement: h, useEffect, useRef } = await import("react");
  return {
    DocumentEditor: (props: (typeof mocks.editors)[number] & {
      active: boolean;
      tabStripHost: (el: HTMLDivElement | null) => void;
    }) => {
      const slot = useRef(-1);
      if (slot.current < 0) slot.current = mocks.editors.push(props) - 1;
      else mocks.editors[slot.current] = props;
      useEffect(() => { mocks.mounted++; return () => { mocks.mounted--; }; }, []);
      return props.active ? h("div", { ref: props.tabStripHost }) : null;
    },
  };
});

const { default: TabsShell } = await import("../src/TabsShell");

let root: ReturnType<typeof createRoot>;
beforeEach(mountToaster);
afterEach(async () => {
  await act(async () => { root.unmount(); });
  mocks.editors.length = 0;
  await unmountToaster();
});

/** Mount the shell with `paths` delivered at listen time, and let the
 *  dynamic event import, the listen round-trip and the drain settle (a few
 *  macrotasks, each flushed through act so React commits). */
async function boot(paths: string[]) {
  mocks.atListen = paths;
  const host = document.createElement("div");
  root = createRoot(host);
  await act(async () => { root.render(createElement(TabsShell)); });
  for (let i = 0; i < 5; i++) await act(() => new Promise((r) => setTimeout(r, 0)));
  return host;
}

it("opens a path queued while the listener was still registering", async () => {
  await boot(["/labels/Startup.label"]);

  expect(mocks.queue).toEqual([]);
  expect(mocks.editors[0]?.fileToOpen).toMatchObject({ path: "/labels/Startup.label" });
});

it("names a delivered path that isn't a .label instead of opening nothing", async () => {
  const host = await boot(["/outside/secret.bin"]);

  expect(mocks.editors[0]?.fileToOpen).toBeNull();
  await shown("Could not open label: /outside/secret.bin isn't a .label file.");
  // The toast is the only surface: the tab strip carries no error text of its own.
  expect(host.textContent).not.toContain("Could not open label");
}, 30_000);

it("a second stray file replaces the first toast, and a .label delivered after still opens", async () => {
  await boot(["/outside/one.bin", "/outside/two.bin", "/labels/Real.label"]);

  await shown("/outside/two.bin isn't a .label file.");
  expect(toastTitles()).toEqual(["Could not open label: /outside/two.bin isn't a .label file."]);
  expect(mocks.editors[0]?.fileToOpen).toMatchObject({ path: "/labels/Real.label" });
}, 30_000);

it("a cancelled open closes the tab made for it, not the pristine tab it reused", async () => {
  await boot(["/labels/A.label", "/labels/B.label"]);
  expect(mocks.mounted).toBe(2); // A reused the startup tab, B got a new one
  const [a, b] = mocks.editors;

  await act(async () => { b.onOpenSettled(b.fileToOpen!.seq, true); });
  expect(mocks.mounted).toBe(1);
  await act(async () => { a.onOpenSettled(a.fileToOpen!.seq, true); });
  expect(mocks.mounted).toBe(1);
});
