// @vitest-environment happy-dom
// appmenu-recent-dom.test.tsx — the native File → Open Recent submenu lists the
// remembered .label paths (src/recent.ts) by file name, opens one through the
// registered opener, rebuilds when the list changes, and Clear Menu empties it.
// The Tauri menu API is faked in memory, as in appmenu-native-checks-dom.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => {
  type Opts = { id?: string; text?: string; enabled?: boolean; items?: unknown[]; action?: () => void };
  class Resource {
    opts: Opts; children: Resource[]; closed = false;
    constructor(opts: Opts) { this.opts = opts; this.children = (opts.items ?? []) as Resource[]; }
    static async new(opts: Opts) {
      await native.hold.new;
      const item = new this(opts);
      native.created.push(item);
      if (opts.id) native.items.set(opts.id, item);
      return item;
    }
    get id() { return this.opts.id ?? "predefined"; }
    async close() { this.closed = true; }
    async setEnabled() {}
    async setChecked() {}
    async setText() {}
    async setAsAppMenu() { native.onInstall(); return null; }
    async items() { return [...this.children]; }
    // Like Tauri, a closed resource rejects; `hold` stalls a step mid-rebuild.
    async remove(item: Resource) {
      await native.hold.remove;
      if (this.closed) throw new Error("resource closed");
      this.children = this.children.filter((c) => c !== item);
    }
    async append(items: Resource | Resource[]) {
      if (this.closed) throw new Error("resource closed");
      this.children.push(...[items].flat());
    }
  }
  return {
    items: new Map<string, Resource>(),
    created: [] as Resource[],
    hold: { new: Promise.resolve(), remove: Promise.resolve() } as Record<"new" | "remove", Promise<unknown>>,
    onInstall: () => {},
    api: {
      MenuItem: class extends Resource {}, IconMenuItem: class extends Resource {},
      PredefinedMenuItem: class extends Resource {}, Submenu: class extends Resource {},
      Menu: class extends Resource {}, CheckMenuItem: class extends Resource {},
    },
  };
});
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: async () => null }));
vi.mock("@tauri-apps/api/menu", () => native.api);
import { APP_MENUS, AppMenu, actionsIn } from "@/components/AppMenu";
import { recentLabels, rememberRecent, setRecentOpener } from "@/recent";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  localStorage.clear();
  native.items.clear();
  native.created.length = 0;
  native.hold = { new: Promise.resolve(), remove: Promise.resolve() };
  native.onInstall = () => {};
});
afterEach(() => { document.body.replaceChildren(); });

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(AppMenu, {
      actions: actionsIn(APP_MENUS).map((entry) => ({ id: entry.id, label: entry.text, run: () => undefined })),
      checked: {},
      onNativeError: (message: string) => { throw new Error(message); },
      onCheckForUpdates: () => undefined,
    }));
  });
  await settle();
  return () => act(async () => { root.unmount(); });
}

const rows = () => native.items.get("recent-menu")!.children.map((c) => c.opts.text ?? "—");

it("lists recent labels by name, opens one, rebuilds on change, and clears", async () => {
  rememberRecent("/labels/One.label");
  rememberRecent("/labels/Two.label");
  const opened: string[] = [];
  const unregister = setRecentOpener((path) => opened.push(path));
  const unmount = await mount();
  try {
    const file = native.items.get("file-menu")!;
    expect(file.children.map((c) => c.opts.text).slice(0, 3))
      .toEqual(["New Tab", "Open Project…", "Open Recent"]);
    expect(rows()).toEqual(["Two.label", "One.label", "—", "Clear Menu"]);

    await act(async () => { native.items.get("recent-menu")!.children[1].opts.action!(); });
    expect(opened).toEqual(["/labels/One.label"]);

    await act(async () => { rememberRecent("/labels/Three.label"); });
    await settle();
    expect(rows()).toEqual(["Three.label", "Two.label", "One.label", "—", "Clear Menu"]);

    const clear = native.items.get("recent-menu")!.children.at(-1)!;
    await act(async () => { clear.opts.action!(); });
    await settle();
    expect(recentLabels()).toEqual([]);
    expect(rows()).toEqual(["Clear Menu"]);
    expect(native.items.get("recent-menu")!.children[0].opts.enabled).toBe(false);
  } finally {
    unregister();
    await unmount();
  }
});

it("catches a change made while the menu is still installing", async () => {
  // e.g. a file opened in a new tab finishes while that tab's menu installs.
  native.onInstall = () => rememberRecent("/labels/Late.label");
  const unmount = await mount();
  try {
    await settle();
    expect(rows()).toEqual(["Late.label", "—", "Clear Menu"]);
  } finally {
    await unmount();
  }
});

it("escapes & so a file name keeps it (menus read a lone & as a mnemonic)", async () => {
  rememberRecent("/labels/Salt & Pepper.label");
  const unmount = await mount();
  try {
    expect(rows()[0]).toBe("Salt && Pepper.label");
  } finally {
    await unmount();
  }
});

it.each(["remove", "new"] as const)(
  "a rebuild cut off by unmounting (during %s) reports no error and leaks no rows",
  async (step) => {
    rememberRecent("/labels/One.label");
    const unmount = await mount();
    let release = () => {};
    native.hold[step] = new Promise<void>((r) => { release = r; });
    await act(async () => { rememberRecent("/labels/Two.label"); });
    // The rebuild is now stalled mid-step; the tab switches away.
    await unmount();
    release();
    await settle(); // onNativeError throws, so a reported error fails here
    expect(native.created.filter((r) => !r.closed)).toEqual([]);
  },
);
