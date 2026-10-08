// recovery-dialog-dom.test.tsx — the shell's boot-time "Recover unsaved
// work?" dialog (#394): Restore queues each snapshot as an open carrying its
// key (the editor drops it once the open lands), Discard drops them, and
// Escape only hides the dialog — the snapshots stay for the next launch.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dropped: [] as string[], opened: [] as unknown[] }));
vi.mock("../src/recovery", () => ({
  recoveryKey: (id: number) => `now:${id}`,
  earlierSnapshots: async () => [
    { key: "old:1", name: "alpha.label", bytes: new Uint8Array([1]), savedAt: 1 },
  ],
  dropRecovery: async (key: string) => { mocks.dropped.push(key); },
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("../src/components/DesktopUpdater", () => ({ DesktopUpdater: () => null }));
vi.mock("../src/App", () => ({
  DocumentEditor: (p: { fileToOpen: unknown }) => {
    if (p.fileToOpen) mocks.opened.push(p.fileToOpen);
    return null;
  },
}));

const { default: TabsShell } = await import("../src/TabsShell");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  mocks.dropped.length = 0;
  mocks.opened.length = 0;
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
