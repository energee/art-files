// tabs-close-draft-dom.test.tsx — closing the window (red button, ⌘Q) commits
// a focused field's draft before the shell decides whether anything is
// unsaved, so typing in a ChoiceBox can't vanish with no prompt (#684).
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({ destroyed: 0 }));
const { clearMocks, mockIPC, mockWindows } = await import("@tauri-apps/api/mocks");
mockWindows("main");
mockIPC(async (cmd) => {
  if (cmd === "plugin:window|destroy") ipc.destroyed++;
  return null;
}, { shouldMockEvents: true });
(globalThis as { isTauri?: boolean }).isTauri = true; // what isTauri() reads
vi.mock("../src/components/DesktopUpdater", () => ({ DesktopUpdater: () => null }));
vi.mock("../src/App", async () => {
  const { createElement: h } = await import("react");
  return {
    DocumentEditor: (props: { active: boolean; tabStripHost: (el: HTMLDivElement | null) => void; onMeta: (meta: object) => void }) =>
      props.active ? h("div", { ref: props.tabStripHost }, h("input", {
        "data-draft": "",
        onBlur: () => props.onMeta({ title: "Beer", dirty: true, edited: true, masterUnsaved: false, filePath: null }),
      })) : null,
  };
});
const { emit } = await import("@tauri-apps/api/event");
const { default: TabsShell } = await import("../src/TabsShell");

afterAll(() => { clearMocks(); delete (globalThis as { isTauri?: boolean }).isTauri; });

it("a window close commits the focused draft, then prompts rather than closing", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => { root.render(createElement(TabsShell)); await new Promise((r) => setTimeout(r, 20)); });
  (host.querySelector("input[data-draft]") as HTMLInputElement).focus();
  await act(async () => { await emit("tauri://close-requested"); await new Promise((r) => setTimeout(r, 20)); });
  expect(ipc.destroyed).toBe(0);
  expect(document.body.textContent).toContain("will be lost");
  await act(async () => { root.unmount(); });
});
