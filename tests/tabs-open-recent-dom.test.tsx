// tabs-open-recent-dom.test.tsx — the shell side of File → Open Recent: a tab
// that binds to a .label path (an open or a Save As, reported through onMeta)
// joins the recent list, and choosing a recent path routes it exactly like a
// Finder open — or, when the file is gone, shows the open error as a toast
// and drops it from the list (a file that cannot be checked shows the error
// too, and stays).
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DocumentMeta, FileToOpen } from "../src/App";
import { mountToaster, settle, shown, toastTitles, unmountToaster } from "./real-timer-toaster";

type EditorProps = {
  fileToOpen: FileToOpen | null;
  onMeta: (meta: DocumentMeta) => void;
  tabStripHost: (el: HTMLDivElement | null) => void;
};
const mocks = vi.hoisted(() => ({
  exists: vi.fn(),
  editors: [] as EditorProps[],
}));

// Real Tauri api modules over mockIPC, as in tabs-open-dom.test.tsx.
const { mockIPC, mockWindows } = await import("@tauri-apps/api/mocks");
mockWindows("main");
mockIPC(() => null, { shouldMockEvents: true });
(globalThis as { isTauri?: boolean }).isTauri = true;
vi.mock("@tauri-apps/plugin-fs", () => ({ exists: mocks.exists }));
vi.mock("../src/components/DesktopUpdater", () => ({ DesktopUpdater: () => null }));
vi.mock("../src/App", async () => {
  const { createElement: h, useRef } = await import("react");
  return {
    DocumentEditor: (props: EditorProps & { active: boolean }) => {
      const slot = useRef(-1);
      if (slot.current < 0) slot.current = mocks.editors.push(props) - 1;
      else mocks.editors[slot.current] = props;
      return props.active ? h("div", { ref: props.tabStripHost }) : null;
    },
  };
});

const { default: TabsShell } = await import("../src/TabsShell");
const { openRecent, recentLabels, rememberRecent } = await import("../src/recent");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  localStorage.clear();
  mocks.editors.length = 0;
  mocks.exists.mockReset();
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

const meta = (filePath: string | null): DocumentMeta =>
  ({ title: "Beer", dirty: false, edited: false, masterUnsaved: false, filePath });

it("remembers a path once a tab binds to it, and again when it changes", async () => {
  await act(async () => { mocks.editors[0].onMeta(meta(null)); });
  expect(recentLabels()).toEqual([]);
  await act(async () => { mocks.editors[0].onMeta(meta("/labels/One.label")); });
  await act(async () => { mocks.editors[0].onMeta({ ...meta("/labels/One.label"), dirty: true }); });
  rememberRecent("/labels/Other.label");
  // A repeat report of the same path doesn't reorder the list.
  await act(async () => { mocks.editors[0].onMeta(meta("/labels/One.label")); });
  expect(recentLabels()).toEqual(["/labels/Other.label", "/labels/One.label"]);
  // Save As binds a new path.
  await act(async () => { mocks.editors[0].onMeta(meta("/labels/Two.label")); });
  expect(recentLabels()[0]).toBe("/labels/Two.label");
});

it("opens a recent path like a Finder open", async () => {
  rememberRecent("/labels/One.label");
  mocks.exists.mockResolvedValue(true);
  await act(async () => { openRecent("/labels/One.label"); });
  await act(async () => { await Promise.resolve(); });
  expect(mocks.exists).toHaveBeenCalledWith("/labels/One.label");
  expect(mocks.editors).toHaveLength(1);
  expect(mocks.editors[0].fileToOpen).toMatchObject({ path: "/labels/One.label" });
  expect(recentLabels()).toEqual(["/labels/One.label"]);
});

it("a recent file that is gone shows an error toast and leaves the list", async () => {
  rememberRecent("/labels/Gone.label");
  rememberRecent("/labels/Here.label");
  mocks.exists.mockResolvedValue(false);
  await act(async () => { openRecent("/labels/Gone.label"); });
  await act(async () => { await Promise.resolve(); });
  expect(mocks.editors[0].fileToOpen).toBeNull();
  await shown("Could not open label: /labels/Gone.label no longer exists.");
  // The toast is the only surface: the tab strip carries no error text of its own.
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(recentLabels()).toEqual(["/labels/Here.label"]);
}, 30_000);

it("a second missing recent file replaces the first toast, and a later good open leaves it standing", async () => {
  rememberRecent("/labels/Gone.label");
  rememberRecent("/labels/AlsoGone.label");
  rememberRecent("/labels/Here.label");
  mocks.exists.mockImplementation(async (path: string) => path === "/labels/Here.label");
  await act(async () => { openRecent("/labels/Gone.label"); });
  await shown("/labels/Gone.label no longer exists.");
  await act(async () => { openRecent("/labels/AlsoGone.label"); });
  await shown("/labels/AlsoGone.label no longer exists.");
  await settle();
  // One source, one toast: the repeat updates it instead of stacking another.
  expect(toastTitles()).toEqual(["Could not open label: /labels/AlsoGone.label no longer exists."]);
  // The first file is still gone, so a good open elsewhere does not dismiss its error.
  await act(async () => { openRecent("/labels/Here.label"); });
  await settle();
  expect(mocks.editors[0].fileToOpen).toMatchObject({ path: "/labels/Here.label" });
  expect(toastTitles()).toHaveLength(1);
}, 30_000);

// Not knowing whether the file is there is not the same as it being gone: the
// error is shown, and the entry stays in the list.
it("a recent file that cannot be checked shows an error toast and stays in the list", async () => {
  rememberRecent("/labels/Locked.label");
  mocks.exists.mockRejectedValue(new Error("permission denied"));
  await act(async () => { openRecent("/labels/Locked.label"); });
  await shown("Could not open label: permission denied");
  expect(toastTitles()).toEqual(["Could not open label: permission denied"]);
  expect(document.querySelector("[data-sonner-toast]")!.getAttribute("data-type")).toBe("error");
  expect(mocks.editors[0].fileToOpen).toBeNull();
  expect(recentLabels()).toEqual(["/labels/Locked.label"]);
}, 30_000);
