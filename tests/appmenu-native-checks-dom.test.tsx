// @vitest-environment happy-dom
// appmenu-native-checks-dom.test.tsx — the native View menu's check items stay
// in sync with app state. muda (Tauri's menu backend) flips a CheckMenuItem
// itself on click, so choosing the view that is already current unchecks it
// while app state does not move; AppMenu must re-assert the check (issue #119).
// Also: a native menu command (accelerator or click) does nothing to the tab
// behind an open modal dialog (#244).
// The Tauri menu API is faked in memory; AppMenu's sync logic is real.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setTimeout as tick } from "node:timers/promises";

const native = vi.hoisted(() => {
  class Resource {
    id: string; checked: boolean; action?: () => void; text?: string; closed = false;
    constructor(opts: { id?: string; checked?: boolean; action?: () => void; text?: string }) {
      this.id = opts.id ?? "predefined"; this.checked = !!opts.checked; this.action = opts.action; this.text = opts.text;
    }
    static async new(opts: { id?: string; checked?: boolean; action?: () => void; text?: string }) {
      const item = new this(opts);
      native.items.set(item.id, item);
      return item;
    }
    async close() {
      this.closed = true;
      if (native.items.get(this.id) === this) native.items.delete(this.id);
    }
    async setEnabled() {}
    async setText(text: string) {
      if (this.closed) throw new Error("Native item is closed");
      this.text = text;
    }
    async setAsAppMenu() {
      native.installCalls++;
      await native.beforeInstall?.();
      const previous = native.currentMenu;
      native.currentMenu = this;
      return previous;
    }
  }
  class CheckMenuItem extends Resource {
    async setChecked(value: boolean) { this.checked = value; }
    /** What muda does on a click: flip, then call the action. */
    click() { this.checked = !this.checked; this.action?.(); }
  }
  return {
    items: new Map<string, Resource>(),
    currentMenu: null as Resource | null,
    beforeInstall: null as (() => Promise<void>) | null,
    installCalls: 0,
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

afterEach(() => { document.body.replaceChildren(); });

/** Mount AppMenu with every menu command calling `run(id)`; `render` repeats
 *  the mount (as an App re-render would) and lets the native sync settle. */
async function mount(run: (id: string) => void, checked: Record<string, boolean> = { "view-label": true, "view-mask": false, "view-can": false }) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () => act(async () => {
    root.render(createElement(AppMenu, {
      actions: actionsIn(APP_MENUS).map((entry) => ({
        id: entry.id, label: entry.text, run: () => run(entry.id),
      })),
      checked,
      onNativeError: (message: string) => { throw new Error(message); },
      onCheckForUpdates: () => undefined,
    }));
    await new Promise((r) => setTimeout(r, 0));
  });
  await render();
  return { render, unmount: () => act(async () => { root.unmount(); }) };
}

it("re-checks View → Label after choosing it while Label is already the view", async () => {
  const menu = await mount(() => undefined); // Label is current: no state change
  try {
    const label = native.items.get("view-label") as InstanceType<typeof native.api.CheckMenuItem>;
    expect(label.checked).toBe(true);
    await act(async () => { label.click(); });
    await menu.render();
    expect(label.checked).toBe(true);
  } finally {
    await menu.unmount();
  }
});

// Mid-split (Compare) App passes every view check false; the native rows
// follow, and One Can / Four-Pack are check rows of their own.
it("shows Compare as no view checked, and installs the can-count checks", async () => {
  const menu = await mount(() => undefined, {
    "view-label": false, "view-mask": false, "view-can": false,
    "view-one-can": true, "view-four-pack": false,
  });
  try {
    expect(["view-label", "view-mask", "view-can"].map((id) => native.items.get(id)!.checked))
      .toEqual([false, false, false]);
    expect(native.items.get("view-one-can")).toBeInstanceOf(native.api.CheckMenuItem);
    expect(native.items.get("view-one-can")!.checked).toBe(true);
    expect(native.items.get("view-four-pack")!.checked).toBe(false);
  } finally {
    await menu.unmount();
  }
});

it("native menu commands leave the tab behind an open dialog alone (#244)", async () => {
  const ran: string[] = [];
  const execCommand = vi.fn();
  Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
  const menu = await mount((id) => ran.push(id));
  const click = (id: string) => act(async () => {
    const item = native.items.get(id)!;
    if (item instanceof native.api.CheckMenuItem) item.click(); else item.action?.();
  });
  try {
    // Focus sits in a modal dialog: a button, then a field in it.
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-slot", "dialog-content");
    const button = document.createElement("button");
    const input = document.createElement("input");
    dialog.append(button, input);
    document.body.append(dialog);
    button.focus();
    for (const id of ["tab-close", "project-save", "undo", "view-mask"]) await click(id);
    // Focus lost to the page (or in a list portalled out of the dialog): still blocked.
    button.blur();
    await click("tab-close");
    expect(ran).toEqual([]);
    // The check muda flipped is put back, since the view did not change.
    await menu.render();
    expect(native.items.get("view-mask")!.checked).toBe(false);
    // In the dialog's field, Undo is the field's own; Close Tab still stands aside.
    input.focus();
    await click("undo");
    await click("tab-close");
    expect(execCommand).toHaveBeenCalledWith("undo");
    expect(ran).toEqual([]);
    // The dialog closed, the same item acts on the tab again.
    dialog.remove();
    await click("tab-close");
    expect(ran).toEqual(["tab-close"]);
  } finally {
    await menu.unmount();
    Reflect.deleteProperty(document, "execCommand");
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

// File → Save Master… is a `live` row: installed under its plain title (the
// SF Symbol lookup's key), it then reads the command's label, which says
// Save Variant… while a variant is the version.
it("installs Save Master… under its plain title and shows the command's variant wording", async () => {
  native.items.clear();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (label: string) => act(async () => {
    root.render(createElement(AppMenu, {
      actions: actionsIn(APP_MENUS).map((entry) => ({
        id: entry.id, label: entry.id === "master-save" ? label : entry.text, run: () => {},
      })),
      checked: {}, onNativeError: (error) => { throw new Error(error); }, onCheckForUpdates: () => undefined,
    }));
    await new Promise((r) => setTimeout(r, 0));
  });
  try {
    await render("Save Master…");
    await render("Save Master…");
    expect(native.items.get("master-save")!.text).toBe("Save Master…");
    await render("Save Variant…");
    expect(native.items.get("master-save")!.text).toBe("Save Variant…");
    await render("Save Master…");
    expect(native.items.get("master-save")!.text).toBe("Save Master…");
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});

it("rebuilds the native export menu when legacy PDF commands become available or disappear", async () => {
  native.items.clear();
  const root = createRoot(document.createElement("div"));
  const ran: string[] = [];
  const render = async (legacy: boolean) => {
    await act(async () => {
      root.render(createElement(AppMenu, {
        actions: actionsIn(APP_MENUS).filter((entry) => legacy || !entry.optional).map((entry) => ({
          id: entry.id, label: entry.text, run: () => { ran.push(entry.id); },
        })),
        checked: {}, onNativeError: (message) => { throw new Error(message); },
        onCheckForUpdates: () => undefined,
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  try {
    await render(false);
    expect(native.items.has("export-pdf")).toBe(true);
    for (const id of ["export-both", "export-art", "export-mask"]) expect(native.items.has(id)).toBe(false);
    await render(true);
    for (const id of ["export-pdf", "export-both", "export-art", "export-mask"]) expect(native.items.has(id)).toBe(true);
    native.items.get("export-mask")!.action!();
    expect(ran).toEqual(["export-mask"]);
    await render(false);
    expect(native.items.has("export-both")).toBe(false);
    expect(native.items.has("export-pdf")).toBe(true);
  } finally { await act(async () => { root.unmount(); }); }
});

it("finishes a pending native installation before installing a new export menu", async () => {
  let resolve!: () => void;
  const promise = new Promise<void>((release) => { resolve = release; });
  const gate = { promise, resolve };
  native.items.clear();
  native.installCalls = 0;
  native.beforeInstall = () => native.installCalls === 1 ? gate.promise : Promise.resolve();
  const root = createRoot(document.createElement("div"));
  const errors = vi.fn();
  const render = async (legacy: boolean) => act(async () => {
    root.render(createElement(AppMenu, {
      actions: actionsIn(APP_MENUS).filter((entry) => legacy || !entry.optional).map((entry) => ({
        id: entry.id, label: entry.text, run: () => undefined,
      })),
      checked: {}, onNativeError: errors, onCheckForUpdates: () => undefined,
    }));
    await tick();
  });
  try {
    await render(false);
    await vi.waitFor(() => expect(native.installCalls).toBe(1));
    await render(true);
    await act(async () => { await tick(); });
    expect(native.installCalls).toBe(1);
    await act(async () => { gate.resolve(); await tick(); });
    await vi.waitFor(() => expect(native.installCalls).toBe(2));
    expect(native.currentMenu?.closed).toBe(false);
    expect(native.items.has("export-both")).toBe(true);
    expect(errors).not.toHaveBeenCalled();
  } finally {
    await act(async () => { gate.resolve(); await tick(); root.unmount(); });
    native.beforeInstall = null;
  }
});

it("waits for the replacement menu before relabeling the installed-update command", async () => {
  let resolve!: () => void;
  const promise = new Promise<void>((release) => { resolve = release; });
  const gate = { promise, resolve };
  native.items.clear();
  native.beforeInstall = null;
  const root = createRoot(document.createElement("div"));
  const errors = vi.fn();
  const render = async (legacy: boolean, updateInstalled: boolean) => act(async () => {
    root.render(createElement(AppMenu, {
      actions: actionsIn(APP_MENUS).filter((entry) => legacy || !entry.optional).map((entry) => ({
        id: entry.id, label: entry.text, run: () => undefined,
      })),
      checked: {}, onNativeError: errors, onCheckForUpdates: () => undefined, updateInstalled,
    }));
    await tick();
  });
  try {
    await render(false, false);
    await vi.waitFor(() => expect(native.currentMenu?.closed).toBe(false));
    const oldUpdate = native.items.get("check-for-updates")!;
    native.beforeInstall = () => gate.promise;
    await render(true, false);
    await vi.waitFor(() => expect(oldUpdate.closed).toBe(true));
    await render(true, true);
    await act(async () => { await tick(); });
    expect(errors).not.toHaveBeenCalled();
    await act(async () => { gate.resolve(); await tick(); });
    await vi.waitFor(() => expect(native.items.get("check-for-updates")?.text).toBe("Restart to Update"));
    expect(native.items.get("check-for-updates")?.closed).toBe(false);
  } finally {
    await act(async () => { gate.resolve(); await tick(); root.unmount(); });
    native.beforeInstall = null;
  }
});
