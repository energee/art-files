// recovery.test.ts — only snapshots from a launch that is no longer running
// are offered back (#394), and snapshot writes land in call order.
import { describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("@/masterCache", () => ({
  RECOVERY_STORE: "recovery",
  // A minimal object store: put/delete/getAllKeys/get against the map. A put
  // takes a while to land, as a real snapshot (megabytes) does.
  run: async (_mode: string, act: (s: unknown) => { result: unknown }) => {
    const slow = (fn: () => void) => new Promise<void>((r) => setTimeout(() => { fn(); r(); }, 20));
    let landing: Promise<void> | undefined;
    const result = act({
      put: (v: unknown, k: string) => ({ result: (landing = slow(() => store.set(k, v)), k) }),
      delete: (k: string) => ({ result: (store.delete(k), undefined) }),
      getAllKeys: () => ({ result: [...store.keys()] }),
      get: (k: string) => ({ result: store.get(k) }),
    }).result ?? null;
    await landing;
    return result;
  },
}));

const { LAUNCH_ID, canRebind, dropRecovery, earlierSnapshots, fromEarlierLaunch, keepRecovery, recoveryKey } =
  await import("@/recovery");

it("keys a tab's snapshot under this launch", () => {
  expect(recoveryKey(3)).toBe(`${LAUNCH_ID}:3`);
});

it("offers only keys from a launch that is not live", () => {
  expect(fromEarlierLaunch(["now:1", "old:1", "old:2", "nowish:1", "other:4"], ["now", "other"]))
    .toEqual(["old:1", "old:2", "nowish:1"]);
});

it("never offers this launch's own snapshots", async () => {
  store.clear();
  const snap = { name: "a.label", bytes: new Uint8Array([1]), savedAt: 2 };
  await keepRecovery(recoveryKey(1), snap);
  store.set("crashed:1", { ...snap, savedAt: 1 });
  expect((await earlierSnapshots()).map((r) => r.key)).toEqual(["crashed:1"]);
});

it("a drop issued after a snapshot is never overtaken by it", async () => {
  store.clear();
  const kept = keepRecovery("k", { name: "a.label", bytes: new Uint8Array([1]), savedAt: 1 });
  const dropped = dropRecovery("k"); // a save finishing while the snapshot is still writing
  await Promise.all([kept, dropped]);
  expect(store.has("k")).toBe(false);
});

// UX audit 26: a restored tab takes its file back only when Save could not
// overwrite anything newer — the file still exists, still carries the mtime
// the tab saw when it bound or saved it, and no other tab holds it. Anything
// else keeps "Save asks where".
describe("canRebind", () => {
  const snap = { name: "a.label", bytes: new Uint8Array([1]), savedAt: 1000, filePath: "/w/a.label", fileModifiedAt: 900 };
  it("rebinds a file untouched since the tab bound or saved it", () => {
    expect(canRebind(snap, 900, [])).toBe(true);
  });
  it("never rebinds a snapshot that has no path (older snapshots, the browser)", () => {
    expect(canRebind({ ...snap, filePath: undefined }, 900, [])).toBe(false);
  });
  it("never rebinds a snapshot with no baseline mtime", () => {
    expect(canRebind({ ...snap, fileModifiedAt: undefined }, 900, [])).toBe(false);
  });
  it("never rebinds a missing file", () => {
    expect(canRebind(snap, null, [])).toBe(false);
  });
  it("never rebinds a file written after the snapshot", () => {
    expect(canRebind(snap, 1001, [])).toBe(false);
  });
  // Audit: a write between the tab's bind/save and its next snapshot is still
  // newer work, though its mtime predates the snapshot.
  it("never rebinds a file written after the tab bound it, even before the snapshot", () => {
    expect(canRebind(snap, 950, [])).toBe(false);
  });
  it("never rebinds a file another tab already holds", () => {
    expect(canRebind(snap, 900, ["/w/a.label"])).toBe(false);
  });
});
