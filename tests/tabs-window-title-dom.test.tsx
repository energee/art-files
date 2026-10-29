// tabs-window-title-dom.test.tsx — the desktop window title follows the active
// tab. At boot the tab's title changes twice in a row ("Untitled", then the
// editor's translated "Sem título"); the two set_title IPCs must apply in that
// order, or a slower first one leaves the window titled "Untitled" while the
// tab strip shows the translation.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const applied = vi.hoisted(() => [] as string[]);

const { mockIPC, mockWindows } = await import("@tauri-apps/api/mocks");
mockWindows("main");
let first = true;
mockIPC(async (cmd, args) => {
  if (cmd !== "plugin:window|set_title") return null;
  const { value } = args as { value: string };
  // The first title applies late, as a slow IPC round-trip would.
  if (first) { first = false; await new Promise((r) => setTimeout(r, 20)); }
  applied.push(value);
  return null;
});
(globalThis as { isTauri?: boolean }).isTauri = true; // what isTauri() reads
vi.mock("../src/components/DesktopUpdater", () => ({ DesktopUpdater: () => null }));
vi.mock("../src/App", async () => {
  const { createElement: h, useEffect } = await import("react");
  return {
    DocumentEditor: (props: { active: boolean; tabStripHost: (el: HTMLDivElement | null) => void; onMeta: (meta: object) => void }) => {
      useEffect(() => {
        props.onMeta({ title: "Sem título", dirty: false, edited: false, masterUnsaved: false, filePath: null });
      }, []); // eslint-disable-line react-hooks/exhaustive-deps -- report once, like the editor's first meta
      return props.active ? h("div", { ref: props.tabStripHost }) : null;
    },
  };
});

const { default: TabsShell } = await import("../src/TabsShell");

it("applies window titles in the order the tab's title changed", async () => {
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(TabsShell)); });
  for (let i = 0; i < 10; i++) await act(() => new Promise((r) => setTimeout(r, 10)));
  expect(applied.at(-1)).toBe("Sem título");
  await act(async () => { root.unmount(); });
});
