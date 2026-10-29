// tabs-window-title-dom.test.tsx — the desktop window title follows the active
// tab. A fresh tab starts with the UI language's "Untitled", and when its
// title changes twice in a row the set_title IPCs must apply in order: a
// slower first one must not land last and leave the stale title up.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { setLanguage } from "../src/i18n";

const ipc = vi.hoisted(() => ({
  applied: [] as string[],
  /** Delay the first set_title by this many ms, as a slow round-trip would. */
  firstDelay: 0,
  /** The title the stub editor reports, this many ms after mount: late
   *  enough that the shell's first title write is already in flight. */
  reported: "",
  reportDelay: 5,
}));

const { clearMocks, mockIPC, mockWindows } = await import("@tauri-apps/api/mocks");
mockWindows("main");
mockIPC(async (cmd, args) => {
  if (cmd !== "plugin:window|set_title") return null;
  const { value } = args as { value: string };
  const delay = ipc.firstDelay;
  ipc.firstDelay = 0;
  if (delay) await new Promise((r) => setTimeout(r, delay));
  ipc.applied.push(value);
  return null;
}, { shouldMockEvents: true });
(globalThis as { isTauri?: boolean }).isTauri = true; // what isTauri() reads
vi.mock("../src/components/DesktopUpdater", () => ({ DesktopUpdater: () => null }));
vi.mock("../src/App", async () => {
  const { createElement: h, useEffect } = await import("react");
  return {
    DocumentEditor: (props: { active: boolean; tabStripHost: (el: HTMLDivElement | null) => void; onMeta: (meta: object) => void }) => {
      useEffect(() => {
        const report = setTimeout(() => props.onMeta({
          title: ipc.reported, dirty: false, edited: false, masterUnsaved: false, filePath: null,
        }), ipc.reportDelay);
        return () => clearTimeout(report);
      }, []); // eslint-disable-line react-hooks/exhaustive-deps -- report once, like the editor's first meta
      return props.active ? h("div", { ref: props.tabStripHost }) : null;
    },
  };
});

const { default: TabsShell } = await import("../src/TabsShell");

afterEach(() => { ipc.applied.length = 0; setLanguage("system"); });
afterAll(() => { clearMocks(); delete (globalThis as { isTauri?: boolean }).isTauri; });

/** Mount the shell and wait until `title` has been applied and nothing is
 *  left in flight (the delayed first write included), then unmount. */
async function boot(title: string) {
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => { root.render(createElement(TabsShell)); });
    for (let i = 0; i < 200 && !ipc.applied.includes(title); i++)
      await act(() => new Promise((r) => setTimeout(r, 10)));
    await act(() => new Promise((r) => setTimeout(r, 50)));
  } finally {
    await act(async () => { root.unmount(); });
  }
}

it("applies window titles in the order the tab's title changed", async () => {
  ipc.reported = "Sem título";
  ipc.firstDelay = 20;
  await boot("Sem título");
  expect(ipc.applied.at(-1)).toBe("Sem título");
});

it("titles a fresh tab in the UI language from the start", async () => {
  setLanguage("pt");
  ipc.reported = "Sem título";
  await boot("Sem título");
  expect(ipc.applied).toEqual(["Sem título"]);
});
