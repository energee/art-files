// recovery.test.ts — only snapshots from a launch that is no longer running
// are offered back (#394), and snapshot writes land in call order.
import { expect, it, vi } from "vitest";

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

const { LAUNCH_ID, dropRecovery, earlierSnapshots, fromEarlierLaunch, keepRecovery, recoveryKey } =
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
