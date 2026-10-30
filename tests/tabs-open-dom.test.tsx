// tabs-open-dom.test.tsx — desktop File → Open Label… goes through the
// native dialog and hands the editor a real path (issue #79), so the tab
// gets a save identity exactly like a Finder/OS open does. A dialog that
// fails shows the open-error toast (the real <Toaster /> is mounted beside
// the shell); one the user dismisses says nothing.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FileToOpen } from "../src/App";
import { mountToaster, settle, shown, toastTitles, unmountToaster } from "./real-timer-toaster";

const mocks = vi.hoisted(() => ({
  openNativeFile: vi.fn(),
  /** Latest props each stub editor rendered with, by mount order. */
  editors: [] as Array<{ fileToOpen: FileToOpen | null; onOpenProject: () => void }>,
}));

// All Tauri behavior runs through Tauri's own mocks: the real api modules
// (core's invoke, event's listen, the window title / close handlers) hit
// mockIPC, which answers every command with null — so take_opened_file
// reports no queued OS open. A vi.mock of @tauri-apps/api/window proved
// racy (one of the shell's two mount-time dynamic imports got the real
// module), which is why the real modules are driven instead.
const { mockIPC, mockWindows } = await import("@tauri-apps/api/mocks");
mockWindows("main");
mockIPC(() => null, { shouldMockEvents: true });
(globalThis as { isTauri?: boolean }).isTauri = true; // what isTauri() reads
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.openNativeFile }));
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
const { labelFilter } = await import("../src/filePickers");

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  mocks.editors.length = 0;
  mocks.openNativeFile.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await mountToaster();
  await act(async () => { root.render(createElement(TabsShell)); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  await unmountToaster();
});

async function openProject() {
  await act(async () => { mocks.editors[0].onOpenProject(); });
  await act(async () => { await Promise.resolve(); });
}

it("File → Open Label… uses the native dialog and queues the picked path", async () => {
  const inputClick = vi.spyOn(HTMLInputElement.prototype, "click");
  mocks.openNativeFile.mockResolvedValue("/labels/Labradorite.label");

  await openProject();

  expect(mocks.openNativeFile).toHaveBeenCalledWith({ multiple: false, filters: [labelFilter()] });
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
  expect(first).toMatchObject({ path: "/labels/Labradorite.label" });
  await openProject();

  // Same path-identity rule as OS opens: no second tab, no second open.
  expect(mocks.editors).toHaveLength(1);
  expect(mocks.editors[0].fileToOpen).toBe(first);
});

// The picker failing happens before any tab is chosen, so the shell reports it
// itself, as one error toast.
it("a native dialog that fails shows the open-error toast and opens nothing", async () => {
  mocks.openNativeFile.mockRejectedValue(new Error("dialog crashed"));

  await openProject();

  await shown("Could not open label: dialog crashed");
  expect(toastTitles()).toEqual(["Could not open label: dialog crashed"]);
  expect(document.querySelector("[data-sonner-toast]")!.getAttribute("data-type")).toBe("error");
  expect(mocks.editors[0].fileToOpen).toBeNull();
}, 30_000);

// A dialog the user dismisses can reject with an AbortError: that is a choice,
// not a failure.
it("a dismissed dialog shows nothing", async () => {
  mocks.openNativeFile.mockRejectedValue(new DOMException("Dismissed", "AbortError"));

  await openProject();

  // The dialog was asked, and the open has ended (openProject awaited it);
  // an error toast would land a tick later.
  expect(mocks.openNativeFile).toHaveBeenCalledTimes(1);
  await settle();
  expect(toastTitles()).toEqual([]);
  expect(mocks.editors[0].fileToOpen).toBeNull();
}, 30_000);
