// @vitest-environment happy-dom
// appmenu-native-checks-dom.test.tsx — the native View menu's check items stay
// in sync with app state. muda (Tauri's menu backend) flips a CheckMenuItem
// itself on click, so choosing the view that is already current unchecks it
// while app state does not move; AppMenu must re-assert the check (issue #119).
// The Tauri menu API is faked in memory; AppMenu's sync logic is real.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const native = vi.hoisted(() => {
  class Resource {
    id: string; checked: boolean; action?: () => void;
    constructor(opts: { id?: string; checked?: boolean; action?: () => void }) {
      this.id = opts.id ?? "predefined"; this.checked = !!opts.checked; this.action = opts.action;
    }
    static async new(opts: { id?: string; checked?: boolean; action?: () => void }) {
      const item = new this(opts);
      native.items.set(item.id, item);
      return item;
    }
    async close() {}
    async setEnabled() {}
    async setText() {}
    async setAsAppMenu() { return null; }
  }
  class CheckMenuItem extends Resource {
    async setChecked(value: boolean) { this.checked = value; }
    /** What muda does on a click: flip, then call the action. */
    click() { this.checked = !this.checked; this.action?.(); }
  }
  return {
    items: new Map<string, Resource>(),
    api: {
      MenuItem: class extends Resource {}, IconMenuItem: class extends Resource {},
      PredefinedMenuItem: class extends Resource {}, Submenu: class extends Resource {},
      Menu: class extends Resource {}, CheckMenuItem,
    },
  };
});
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/menu", () => native.api);
import { APP_MENUS, AppMenu, actionsIn } from "@/components/AppMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("re-checks View → Label after choosing it while Label is already the view", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const checked = { "view-label": true, "view-mask": false, "view-can": false };
  const render = () => root.render(createElement(AppMenu, {
    actions: actionsIn(APP_MENUS).map((entry) => ({
      id: entry.id, label: entry.text, run: () => undefined, // Label is current: no state change
    })),
    checked,
    onNativeError: (message: string) => { throw new Error(message); },
    onCheckForUpdates: () => undefined,
  }));
  try {
    await act(async () => { render(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const label = native.items.get("view-label") as InstanceType<typeof native.api.CheckMenuItem>;
    expect(label.checked).toBe(true);
    await act(async () => { label.click(); });
    await act(async () => { render(); await new Promise((r) => setTimeout(r, 0)); });
    expect(label.checked).toBe(true);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});

// isMacOS() reads navigator.userAgent, so that is what each case pins.
for (const [platform, userAgent] of [
  ["Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"],
  ["Linux", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)"],
]) {
  it(`provides Help → Check for Updates on ${platform}`, async () => {
    const platformSpy = vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
    native.items.clear();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const check = vi.fn();
    try {
      await act(async () => { root.render(createElement(AppMenu, {
        actions: actionsIn(APP_MENUS).map((entry) => ({ id: entry.id, label: entry.text, run: () => {} })),
        checked: {}, onNativeError: (error) => { throw new Error(error); }, onCheckForUpdates: check,
      })); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(native.items.has("help-menu")).toBe(true);
      native.items.get("check-for-updates")!.action!();
      expect(check).toHaveBeenCalledOnce();
    } finally {
      await act(async () => { root.unmount(); });
      container.remove(); platformSpy.mockRestore();
    }
  });
}
