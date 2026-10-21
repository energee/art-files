// recovery-dialog-dom.test.tsx — the shell's boot-time "Recover unsaved
// work?" dialog (#394): Restore queues each snapshot as an open carrying its
// key (the editor drops it once the open lands), Discard drops them, and
// Escape only hides the dialog — the snapshots stay for the next launch.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dropped: [] as string[], opened: [] as unknown[], tauri: false, mtime: 0 as number | null,
  snaps: [] as Record<string, unknown>[], openProject: null as null | (() => void),
}));
const ALPHA = { key: "old:1", name: "alpha.label", bytes: new Uint8Array([1]), savedAt: 5, filePath: "/w/alpha.label", fileModifiedAt: 4 };
vi.mock("../src/recovery", async (importOriginal) => ({
  canRebind: (await importOriginal<typeof import("../src/recovery")>()).canRebind,
  recoveryKey: (id: number) => `now:${id}`,
  earlierSnapshots: async () => mocks.snaps,
  dropRecovery: async (key: string) => { mocks.dropped.push(key); },
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mocks.tauri, invoke: vi.fn(async () => null) }));
vi.mock("../src/files", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/files")>(),
  nativeModifiedAt: async () => mocks.mtime,
  openThrough: async () => ({ path: "/w/alpha.label" }),
}));
vi.mock("../src/components/DesktopUpdater", () => ({ DesktopUpdater: () => null }));
vi.mock("../src/App", () => ({
  DocumentEditor: (p: { fileToOpen: unknown; onOpenProject: () => void }) => {
    if (p.fileToOpen) mocks.opened.push(p.fileToOpen);
    mocks.openProject = p.onOpenProject;
    return null;
  },
}));

const { default: TabsShell } = await import("../src/TabsShell");

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  mocks.dropped.length = 0;
  mocks.opened.length = 0;
  mocks.tauri = false;
  mocks.snaps = [ALPHA];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(TabsShell)); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

const dialog = () => Array.from(document.querySelectorAll('[role="dialog"]'))
  .find((d) => d.textContent?.includes("Recover unsaved work?")) ?? null;
const press = async (label: string) => {
  const button = Array.from(dialog()!.querySelectorAll("button")).find((b) => b.textContent === label)!;
  await act(async () => { button.click(); });
};

it("Restore opens each snapshot with its key and leaves the drop to the editor", async () => {
  expect(dialog()!.textContent).toContain("alpha.label");
  await press("Restore");
  expect(mocks.opened).toHaveLength(1);
  expect(mocks.opened[0]).toMatchObject({ recovered: "old:1" });
  expect(mocks.dropped).not.toContain("old:1");
});

it("Discard drops the snapshots", async () => {
  await press("Discard");
  expect(mocks.dropped).toContain("old:1");
  expect(mocks.opened).toHaveLength(0);
});

it("Escape hides the dialog but keeps the snapshots", async () => {
  expect(dialog()).not.toBeNull();
  await act(async () => {
    dialog()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  expect(dialog()).toBeNull();
  expect(mocks.dropped).not.toContain("old:1");
});

// UX audit 26: on desktop the restored tab takes its file back only when that
// file has not been written since the tab bound or saved it (recovery.ts canRebind).
it("on desktop, Restore hands the original path back, rebinding only an untouched file", async () => {
  mocks.tauri = true;
  mocks.mtime = 4;
  await press("Restore");
  expect(mocks.opened[0]).toMatchObject({ recoveredPath: { path: "/w/alpha.label", rebind: true } });
});

it("on desktop, a file written after the snapshot is not rebound", async () => {
  mocks.tauri = true;
  mocks.mtime = 6;
  await press("Restore");
  expect(mocks.opened[0]).toMatchObject({ recoveredPath: { path: "/w/alpha.label", rebind: false } });
});

// Audit: a write after the tab bound the file but before its snapshot is
// still newer work than the snapshot.
it("on desktop, a file written after the tab bound it is not rebound", async () => {
  mocks.tauri = true;
  mocks.mtime = 5;
  await press("Restore");
  expect(mocks.opened[0]).toMatchObject({ recoveredPath: { path: "/w/alpha.label", rebind: false } });
});

// Audit: until the restored tab's open lands, its queued rebind path still
// claims the file, so opening that .label focuses it instead of a second tab.
it("on desktop, opening the file a restore is rebinding focuses that tab", async () => {
  mocks.tauri = true;
  mocks.mtime = 4;
  await press("Restore");
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { mocks.openProject!(); await new Promise((r) => setTimeout(r, 0)); });
  expect(mocks.opened.some((o) => (o as { path?: string }).path === "/w/alpha.label")).toBe(false);
});

it("on desktop, two snapshots of one file rebind only the first", async () => {
  await act(async () => { root.unmount(); });
  mocks.snaps = [ALPHA, { ...ALPHA, key: "old:2" }];
  root = createRoot(container);
  await act(async () => { root.render(createElement(TabsShell)); });
  mocks.tauri = true; // after mount, like the tests above: the shell's window wiring stays off
  mocks.mtime = 4;
  await press("Restore");
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  // The mock editor records every render, so key the opens by snapshot.
  const rebind = new Map((mocks.opened as { recovered: string; recoveredPath: { rebind: boolean } }[])
    .map((o) => [o.recovered, o.recoveredPath.rebind]));
  expect([...rebind]).toEqual([["old:1", true], ["old:2", false]]);
});
