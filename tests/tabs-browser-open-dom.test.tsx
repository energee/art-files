// tabs-browser-open-dom.test.tsx — File → Open Label… in the browser, where a
// picked file is a handle with no path. Picking a file a tab already holds
// focuses that tab: two tabs on one file would overwrite each other unasked,
// since the browser has no changed-on-disk check (#695). The editor is stubbed
// and reports each tab's bound handle through its slot.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DocumentMeta, FileToOpen } from "../src/App";

type Handle = { name: string; isSameEntry: (other: Handle) => Promise<boolean> };
const mocks = vi.hoisted(() => ({
  /** Latest props each stub editor rendered with, by mount order. */
  editors: [] as Array<{
    active: boolean; fileToOpen: FileToOpen | null; onOpenProject: () => void; onNewTab: () => void;
    onMeta: (meta: DocumentMeta) => void;
    fileHandleSlot: { current: (() => Handle) | null };
  }>,
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("../src/components/DesktopUpdater", () => ({ DesktopUpdater: () => null }));
vi.mock("../src/App", async () => {
  const { useRef } = await import("react");
  return {
    DocumentEditor: (props: (typeof mocks.editors)[number]) => {
      const slot = useRef(-1);
      if (slot.current < 0) slot.current = mocks.editors.push(props) - 1;
      else mocks.editors[slot.current] = props;
      return null;
    },
  };
});
const { default: TabsShell } = await import("../src/TabsShell");

const handle = (name: string): Handle => {
  const self: Handle = { name, isSameEntry: async (other) => other.name === self.name };
  return self;
};
const touched: DocumentMeta = { title: "A", dirty: false, edited: true, masterUnsaved: false, filePath: null, exporting: false, exportFailures: 0 };

let root: Root;
beforeEach(async () => {
  mocks.editors.length = 0;
  localStorage.clear();
  root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(TabsShell)); });
  // Tab one holds a.label; tab two is a fresh tab in front of it.
  mocks.editors[0].fileHandleSlot.current = () => handle("a.label");
  await act(async () => { mocks.editors[0].onMeta(touched); });
  await act(async () => { mocks.editors[0].onNewTab(); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  vi.unstubAllGlobals();
});

const pick = (name: string) => act(async () => {
  vi.stubGlobal("showOpenFilePicker", async () => [handle(name)]);
  mocks.editors[1].onOpenProject();
  await new Promise((r) => setTimeout(r, 0));
});

it("picking a file a tab already holds focuses that tab", async () => {
  await pick("a.label");
  expect(mocks.editors.map((e) => e.active)).toEqual([true, false]);
  expect(mocks.editors.map((e) => e.fileToOpen)).toEqual([null, null]);
});

it("picking any other file opens it", async () => {
  await pick("b.label");
  expect(mocks.editors[1].fileToOpen).toMatchObject({ handle: { name: "b.label" } });
});
