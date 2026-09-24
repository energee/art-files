// tabs-open-dom.test.tsx — desktop File → Open Project goes through the
// native dialog and hands the editor a real path (issue #79), so the tab
// gets a save identity exactly like a Finder/OS open does.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FileToOpen } from "../src/App";

const mocks = vi.hoisted(() => ({
  openNativeFile: vi.fn(),
  /** Latest props each stub editor rendered with, by mount order. */
  editors: [] as Array<{ fileToOpen: FileToOpen | null; onOpenProject: () => void }>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: async () => null, // take_opened_file: no OS open queued
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
// The shell's window title / close handlers load @tauri-apps/api/window
// dynamically; a vi.mock of it proved racy (one of the two mount-time
// imports got the real module), so run the real module against Tauri's
// own IPC mocks instead.
const { mockIPC, mockWindows } = await import("@tauri-apps/api/mocks");
mockWindows("main");
mockIPC(() => null, { shouldMockEvents: true });
vi.mock("../src/files", () => ({ openNativeFile: mocks.openNativeFile }));
vi.mock("../src/components/DesktopUpdater", () => ({ DesktopUpdater: () => null }));
// Stub editor: records the shell's props so the test sees what open the
// shell queued for each tab, without mounting the real document editor.
vi.mock("../src/App", async () => {
  const { useRef } = await import("react");
  return {
    DocumentEditor: (props: { fileToOpen: FileToOpen | null; onOpenProject: () => void }) => {
      const slot = useRef(-1);
      if (slot.current < 0) slot.current = mocks.editors.push(props) - 1;
      else mocks.editors[slot.current] = props;
      return null;
    },
  };
});

const { default: TabsShell } = await import("../src/TabsShell");
const { LABEL_FILTER } = await import("../src/filePickers");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  mocks.editors.length = 0;
  mocks.openNativeFile.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(TabsShell)); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

async function openProject() {
  await act(async () => { mocks.editors[0].onOpenProject(); });
  await act(async () => { await Promise.resolve(); });
}

it("File → Open Project uses the native dialog and queues the picked path", async () => {
  const inputClick = vi.spyOn(HTMLInputElement.prototype, "click");
  mocks.openNativeFile.mockResolvedValue("/labels/Labradorite.label");

  await openProject();

  expect(mocks.openNativeFile).toHaveBeenCalledWith({ filter: LABEL_FILTER });
  expect(inputClick).not.toHaveBeenCalled();
  // Routed like an OS open: the pristine active tab is reused with a path,
  // so the editor records filePath and ⌘S saves in place.
  expect(mocks.editors).toHaveLength(1);
  expect(mocks.editors[0].fileToOpen).toMatchObject({ path: "/labels/Labradorite.label" });
  expect(mocks.editors[0].fileToOpen?.file).toBeUndefined();
  inputClick.mockRestore();
});

it("a cancelled native dialog opens nothing", async () => {
  mocks.openNativeFile.mockResolvedValue(null);

  await openProject();

  expect(mocks.openNativeFile).toHaveBeenCalledTimes(1);
  expect(mocks.editors).toHaveLength(1);
  expect(mocks.editors[0].fileToOpen).toBeNull();
});

it("re-opening the same path focuses its tab instead of duplicating it", async () => {
  mocks.openNativeFile.mockResolvedValue("/labels/Labradorite.label");

  await openProject();
  const first = mocks.editors[0].fileToOpen;
  await openProject();

  // Same path-identity rule as OS opens: no second tab, no second open.
  expect(mocks.editors).toHaveLength(1);
  expect(mocks.editors[0].fileToOpen).toBe(first);
});
