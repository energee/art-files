// @vitest-environment happy-dom
// appmenu-tab-switch-dom.test.tsx — the native menu keeps working after a tab
// switch rebuilds it (0.1.111/0.1.112: every menu row went dead once a second
// tab was opened). Tauri keeps one click handler per item id and deletes the
// handler under an item's id when that item is freed (tauri menu/mod.rs Drop).
// A Menu/Submenu holds its items and the app holds its current menu, so the
// old menu's rows are only freed when the replaced menu is closed — after the
// new menu's rows registered. This fake models that ownership; the other menu
// fakes don't free anything, which is how the bug slipped past them.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => {
  type Opts = { id?: string; items?: unknown[]; action?: () => void };
  let unnamed = 0;
  class Resource {
    id: string; children: Resource[];
    /** Owners: the JS handle, plus each Menu/Submenu holding it, plus the app for its menu. */
    refs = 1;
    constructor(opts: Opts) {
      this.id = opts.id ?? `unnamed-${++unnamed}`;
      this.children = (opts.items ?? []) as Resource[];
      for (const child of this.children) child.refs++;
    }
    static async new(opts: Opts) {
      const item = new this(opts);
      native.channels.set(item.id, opts.action ?? (() => {}));
      native.latest.set(item.id.replace(/#\d+$/, ""), item);
      return item;
    }
    /** Tauri's Drop: delete whatever handler is registered under this id. */
    release() {
      if (--this.refs > 0) return;
      native.channels.delete(this.id);
      for (const child of this.children) child.release();
    }
    async close() { this.release(); }
    async setEnabled() {}
    async setChecked() {}
    async setText() {}
    async remove() {}
    async append() {}
    /** The app's hold moves to the returned handle, which the caller closes. */
    async setAsAppMenu() {
      this.refs++;
      const previous = native.appMenu;
      native.appMenu = this;
      return previous;
    }
  }
  return {
    channels: new Map<string, () => void>(),
    latest: new Map<string, Resource>(),
    appMenu: null as Resource | null,
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
import { rememberRecent, setRecentOpener } from "@/recent";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  localStorage.clear();
  native.channels.clear();
  native.latest.clear();
  native.appMenu = null;
});
afterEach(() => { document.body.replaceChildren(); });

/** A click on the installed row `id`: Tauri routes it by the row's own id. */
const click = (id: string) => act(async () => { native.channels.get(native.latest.get(id)!.id)?.(); });

it("a menu rebuilt for a newly active tab still runs its commands", async () => {
  rememberRecent("/labels/One.label");
  const opened: string[] = [];
  setRecentOpener((path) => { opened.push(path); });
  const ran: string[] = [];
  const updates = vi.fn();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  // App mounts AppMenu only for the active tab, so a switch unmounts one
  // tab's menu and mounts the next in a single commit.
  const show = (tab: string) => act(async () => {
    root.render(createElement(AppMenu, {
      key: tab,
      actions: actionsIn(APP_MENUS).map((entry) => ({ id: entry.id, label: entry.text, run: () => ran.push(`${tab}:${entry.id}`) })),
      checked: {},
      onNativeError: (message: string) => { throw new Error(message); },
      onCheckForUpdates: updates,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  try {
    await show("A");
    await click("tab-new");
    expect(ran).toEqual(["A:tab-new"]);
    await show("B");
    await click("tab-new");
    await click("project-open");
    await click("recent-0");
    await click("check-for-updates");
    expect(ran).toEqual(["A:tab-new", "B:tab-new", "B:project-open"]);
    expect(opened).toEqual(["/labels/One.label"]);
    expect(updates).toHaveBeenCalledOnce();
  } finally {
    await act(async () => { root.unmount(); });
  }
});
