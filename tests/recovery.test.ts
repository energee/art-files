// recovery.test.ts — only snapshots from a launch that is no longer running
// are offered back (#394), and snapshot writes land in call order.
import { describe, expect, it, vi } from "vitest";
import { packLabel, unpackLabel } from "@/model/files";
import type { LabelFile } from "@/model/layers";

const store = new Map<string, unknown>();
/** Every key a put landed on, in order: what a snapshot actually rewrites. */
const puts: string[] = [];
/** The next write fails, as a full quota does. */
let refuseNext = false;
vi.mock("@/masterCache", () => ({
  RECOVERY_STORE: "recovery",
  // A minimal object store: put/delete/getAllKeys/get against the map. A put
  // takes a while to land, as a real snapshot (megabytes) does.
  run: async (mode: string, act: (s: unknown) => { result: unknown }) => {
    if (mode === "readwrite" && refuseNext) { refuseNext = false; return null; }
    const slow = (fn: () => void) => new Promise<void>((r) => setTimeout(() => { fn(); r(); }, 20));
    const landing: Promise<void>[] = [];
    const result = act({
      put: (v: unknown, k: string) => ({ result: (landing.push(slow(() => { store.set(k, v); puts.push(k); })), k) }),
      delete: (k: string) => ({ result: (store.delete(k), undefined) }),
      getAllKeys: () => ({ result: [...store.keys()] }),
      get: (k: string) => ({ result: store.get(k) }),
    }).result ?? null;
    await Promise.all(landing);
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

// #717: a snapshot's art rides in a record of its own, so a pause after typing
// neither re-zips nor rewrites it.
describe("a snapshot's art", () => {
  const label = (name: string): LabelFile => ({ formatVersion: 3, masterId: "m", enabledVariants: [], values: { name } });
  const texture = { name: "art.png", bytes: new Uint8Array([1, 2, 3]) };
  const snap = (name: string) => ({ name: "a.label", bytes: packLabel(label(name), {}), savedAt: 1 });
  const packer = (ids: readonly unknown[]) => ({ ids, pack: vi.fn(() => packLabel(label("older"), { texture })) });
  const crash = (from: string, to: string) => {
    for (const [k, v] of [...store]) if (k.startsWith(from)) { store.delete(k); store.set(to + k.slice(from.length), v); }
  };

  it("is packed and written once while it stays the same", async () => {
    store.clear();
    puts.length = 0;
    const key = recoveryKey(10);
    const ids = [{}, null, {}];
    const art = packer(ids);
    for (const name of ["a", "b", "c"]) await keepRecovery(key, snap(name), { ...art, ids: [...ids] });
    expect(art.pack).toHaveBeenCalledTimes(1);
    expect(puts.filter((k) => k !== key)).toHaveLength(1);
    expect(puts.filter((k) => k === key)).toHaveLength(3);
  });

  it("withholds a snapshot whose art record never landed", async () => {
    store.clear();
    const key = recoveryKey(19);
    await keepRecovery(key, snap("a"), packer([{}]));
    crash(key, "crashed:19");
    store.delete("crashed:19:art");
    expect(await earlierSnapshots()).toEqual([]);
  });

  it("is packed again when any of it changes, or once its snapshot was dropped", async () => {
    store.clear();
    const key = recoveryKey(11);
    const art = packer([{}]);
    await keepRecovery(key, snap("a"), art);
    await dropRecovery(key);
    expect(store.size).toBe(0);
    await keepRecovery(key, snap("a"), art);
    expect(art.pack).toHaveBeenCalledTimes(2);
    await keepRecovery(key, snap("a"), { ...art, ids: [{}] });
    expect(art.pack).toHaveBeenCalledTimes(3);
  });

  it("over the size caps writes nothing and leaves the last snapshot", async () => {
    store.clear();
    const key = recoveryKey(12);
    expect(await keepRecovery(key, snap("a"), { ids: [], pack: () => { throw new Error("too large"); } })).toBe(false);
    expect(store.size).toBe(0);
  });

  it("is written again after a write that failed", async () => {
    store.clear();
    const key = recoveryKey(13);
    const art = packer([{}]);
    refuseNext = true;
    expect(await keepRecovery(key, snap("a"), art)).toBe(false);
    await keepRecovery(key, snap("b"), art);
    expect(art.pack).toHaveBeenCalledTimes(2);
  });

  it("comes back joined to the newest label, offered as one snapshot", async () => {
    store.clear();
    const key = recoveryKey(14);
    await keepRecovery(key, snap("older"), packer([{}]));
    await keepRecovery(key, snap("newest"), packer([]));
    crash(key.slice(0, key.indexOf(":")), "crashed");
    const offered = await earlierSnapshots();
    expect(offered.map((r) => r.key)).toEqual(["crashed:14"]);
    const { label: restored, assets } = unpackLabel(offered[0].bytes);
    expect(restored?.values.name).toBe("newest");
    expect(assets.texture?.name).toBe("art.png");
    expect([...assets.texture!.bytes]).toEqual([1, 2, 3]);
    await dropRecovery("crashed:14");
    expect(store.size).toBe(0);
  });

  // What every released build through 0.1.118 wrote: one record holding a whole
  // .label. An update must still open what the old build left behind.
  it("in a released build's snapshot stays in its bytes, untouched", async () => {
    store.clear();
    const bytes = packLabel(label("released"), { texture });
    store.set("crashed:1", { name: "a.label", bytes, savedAt: 5, filePath: "/w/a.label", fileModifiedAt: 4 });
    const [r] = await earlierSnapshots();
    expect(r).toEqual({ key: "crashed:1", name: "a.label", bytes, savedAt: 5, filePath: "/w/a.label", fileModifiedAt: 4 });
  });
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
