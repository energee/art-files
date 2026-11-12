// tabs-exit-export-dom.test.tsx — leaving the app while an export runs (#683).
// A window close, ⌘Q or Restart Now waits for the export and then goes ahead;
// a failed export keeps the app open so its error is read; the Rust side hears
// about running exports, so a Dock Quit is held and routed through the close.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

const shell = vi.hoisted(() => ({
  destroyed: 0,
  unsavedFlag: false,
  /** The stub editor's reporter. */
  report: (_meta: object) => {},
  beforeRestart: null as null | (() => Promise<boolean>),
}));
const { clearMocks, mockIPC, mockWindows } = await import("@tauri-apps/api/mocks");
mockWindows("main");
mockIPC(async (cmd, args) => {
  if (cmd === "plugin:window|destroy") shell.destroyed++;
  if (cmd === "set_unsaved") shell.unsavedFlag = (args as { unsaved: boolean }).unsaved;
  return null;
}, { shouldMockEvents: true });
(globalThis as { isTauri?: boolean }).isTauri = true; // what isTauri() reads
vi.mock("../src/components/DesktopUpdater", () => ({
  DesktopUpdater: (props: { beforeRestart: () => Promise<boolean> }) => { shell.beforeRestart = props.beforeRestart; return null; },
}));
vi.mock("../src/App", async () => {
  const { createElement: h } = await import("react");
  return {
    DocumentEditor: (props: { active: boolean; tabStripHost: (el: HTMLDivElement | null) => void; onMeta: (meta: object) => void }) => {
      shell.report = props.onMeta;
      return props.active ? h("div", { ref: props.tabStripHost }) : null;
    },
  };
});
const { emit } = await import("@tauri-apps/api/event");
const { default: TabsShell } = await import("../src/TabsShell");

const clean = { title: "Beer", dirty: false, edited: false, masterUnsaved: false, filePath: null, exporting: false, exportFailures: 0 };
const settle = () => new Promise((r) => setTimeout(r, 20));
const report = (meta: object) => act(async () => { shell.report({ ...clean, ...meta }); await settle(); });
const closeWindow = () => act(async () => { await emit("tauri://close-requested"); await settle(); });

let root: Root;
beforeEach(async () => {
  shell.destroyed = 0;
  shell.unsavedFlag = false;
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root.render(createElement(TabsShell)); await settle(); });
  await report({});
});
afterEach(async () => { await act(async () => { root.unmount(); }); });
afterAll(() => { clearMocks(); delete (globalThis as { isTauri?: boolean }).isTauri; });

it("a window close waits for the running export, then closes by itself", async () => {
  await report({ exporting: true });
  await closeWindow();
  expect(shell.destroyed).toBe(0);
  await report({ exporting: false });
  expect(shell.destroyed).toBe(1);
});

it("a failed export keeps the app open so its error can be read", async () => {
  await report({ exporting: true });
  await closeWindow();
  await report({ exporting: false, exportFailures: 1 });
  expect(shell.destroyed).toBe(0);
});

it("an older failure does not stop a later quit", async () => {
  await report({ exportFailures: 1 });
  await report({ exporting: true, exportFailures: 1 });
  await closeWindow();
  await report({ exporting: false, exportFailures: 1 });
  expect(shell.destroyed).toBe(1);
});

it("a second close while waiting does not force the app shut", async () => {
  await report({ exporting: true });
  await closeWindow();
  await closeWindow();
  expect(shell.destroyed).toBe(0);
  await report({ exporting: false });
  expect(shell.destroyed).toBe(1);
});

it("a close with nothing running goes straight through", async () => {
  await closeWindow();
  expect(shell.destroyed).toBe(1);
});

it("Restart Now waits for the running export", async () => {
  await report({ exporting: true });
  let ready: boolean | undefined;
  await act(async () => { void shell.beforeRestart!().then((ok) => { ready = ok; }); await settle(); });
  expect(ready).toBeUndefined();
  await report({ exporting: false });
  expect(ready).toBe(true);
});

it("the Rust side treats a running export like unsaved work, so a Dock Quit is held", async () => {
  await report({ exporting: true });
  expect(shell.unsavedFlag).toBe(true);
  await report({ exporting: false });
  expect(shell.unsavedFlag).toBe(false);
});
