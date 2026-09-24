// appmenu.test.ts — native menu accelerators, standard text-edit roles, and
// the macOS application menu's Quit routing.
import { describe, expect, it, vi } from "vitest";
import {
  APP_MENUS, actionsIn, macApplicationMenu, nativeAccelerator,
} from "@/components/AppMenu";
import type { Command } from "@/components/CommandMenu";

const command = (fields: Partial<Command>): Command => ({
  id: "test",
  label: "Test",
  run: () => undefined,
  ...fields,
});

describe("native menu accelerators", () => {
  it("translates command and command-shift shortcuts for Tauri", () => {
    expect(nativeAccelerator(command({ key: "s", mods: "⌘" }))).toBe("CmdOrCtrl+S");
    expect(nativeAccelerator(command({ key: "s", mods: "⇧⌘" }))).toBe("CmdOrCtrl+Shift+S");
  });

  it("translates display-only undo shortcuts", () => {
    expect(nativeAccelerator(command({ shortcut: "⌘Z" }))).toBe("CmdOrCtrl+Z");
    expect(nativeAccelerator(command({ shortcut: "⇧⌘Z" }))).toBe("CmdOrCtrl+Shift+Z");
  });

  it("leaves bare-key bindings with the guarded webview listener", () => {
    expect(nativeAccelerator(command({ key: "1" }))).toBeUndefined();
    expect(nativeAccelerator(command({ key: "g" }))).toBeUndefined();
  });
});

type ActionNode = ReturnType<typeof actionsIn>[number];

function nativeIconOf(action: ActionNode | undefined) {
  return action && "nativeIcon" in action ? action.nativeIcon : undefined;
}

describe("file menu", () => {
  it("wires the workspace-tab commands in place of New Project", () => {
    const file = APP_MENUS.find((menu) => menu.id === "file-menu")!;
    const ids = file.items.flatMap((entry) =>
      entry.kind === "action" ? [entry.id] : []);
    // The leading trio: a menu entry whose id has no command crashes the
    // menu render, so the tab commands' ids are pinned here (they live in
    // DocumentEditor's command table).
    expect(ids.slice(0, 3)).toEqual(["tab-new", "project-open", "tab-close"]);
    expect(ids).not.toContain("project-new");
  });

  it("gives every File action and the Export submenu a leading icon", () => {
    const file = APP_MENUS.find((menu) => menu.id === "file-menu")!;
    const exportMenu = file.items.find((entry) =>
      entry.kind === "submenu" && entry.id === "export-menu");
    if (exportMenu?.kind !== "submenu") throw new Error("export-menu missing");
    expect(exportMenu.icon).toBeTruthy();
    expect(exportMenu.nativeIcon).toBe("Share");
    const actions = actionsIn(file.items);
    for (const action of actions) {
      expect("icon" in action && action.icon, action.id).toBeTruthy();
    }
    const byId = Object.fromEntries(actions.map((action) => [action.id, action]));
    expect(nativeIconOf(byId["tab-new"])).toBe("Add");
    expect(nativeIconOf(byId["project-open"])).toBeUndefined();
    expect(nativeIconOf(byId["tab-close"])).toBe("Remove");
    expect(nativeIconOf(byId["project-save"])).toBeUndefined();
    expect(nativeIconOf(byId["project-save-as"])).toBeUndefined();
    expect(nativeIconOf(byId["master-open"])).toBeUndefined();
    expect(nativeIconOf(byId["master-save"])).toBe("Bookmarks");
    expect(nativeIconOf(byId["master-save-as"])).toBe("Bookmarks");
    expect(nativeIconOf(byId["export-both"])).toBe("Share");
  });

  it("uses only AppKit template names so native icons stay black-and-white", () => {
    const templates = new Set([
      "Add", "Remove", "Share", "Bookmarks", "IconView", "QuickLook", "ListView",
      "Refresh", "GoLeft", "GoRight",
    ]);
    const file = APP_MENUS.find((menu) => menu.id === "file-menu")!;
    const exportMenu = file.items.find((entry) =>
      entry.kind === "submenu" && entry.id === "export-menu");
    if (exportMenu?.kind === "submenu" && exportMenu.nativeIcon) {
      expect(templates.has(exportMenu.nativeIcon)).toBe(true);
    }
    for (const action of actionsIn(APP_MENUS)) {
      const name = nativeIconOf(action);
      if (name) expect(templates.has(name), action.id).toBe(true);
    }
  });
});

describe("view menu", () => {
  it("offers the three preview views in key 1–3 order, then the two toggles", () => {
    const view = APP_MENUS.find((menu) => menu.id === "view-menu")!;
    const ids = view.items.flatMap((entry) =>
      entry.kind === "action" ? [entry.id] : []);
    // The Rendered and Four-Pack views are gone (the four-pack is the Can
    // view's 1 / 4 count, a toolbar control), and Guides is one switch over
    // bleed, margin, center and manual guides — no per-kind items, no Clear.
    expect(ids).toEqual(["view-label", "view-mask", "view-can", "rulers", "guides"]);
  });

  it("gives every View check a leading icon and no native glyph", () => {
    const view = APP_MENUS.find((menu) => menu.id === "view-menu")!;
    for (const action of actionsIn(view.items)) {
      expect("icon" in action && action.icon, action.id).toBeTruthy();
      expect(nativeIconOf(action), action.id).toBeUndefined();
    }
  });
});

describe("native text editing menu", () => {
  it("installs every standard role needed for clipboard editing", () => {
    const edit = APP_MENUS.find((menu) => menu.id === "edit-menu")!;
    const roles = edit.items.flatMap((entry) =>
      entry.kind === "predefined" && entry.item !== "Separator" ? [entry.item] : []);
    expect(roles).toEqual(["Cut", "Copy", "Paste", "SelectAll"]);
  });

  it("icons Undo, Redo and Settings", () => {
    const edit = APP_MENUS.find((menu) => menu.id === "edit-menu")!;
    const editActions = actionsIn(edit.items);
    for (const action of editActions) {
      expect("icon" in action && action.icon, action.id).toBeTruthy();
    }
    expect(nativeIconOf(editActions.find((action) => action.id === "undo"))).toBe("GoLeft");
    expect(nativeIconOf(editActions.find((action) => action.id === "redo"))).toBe("GoRight");
    expect(nativeIconOf(editActions.find((action) => action.id === "settings")))
      .toBeUndefined();
  });
});

describe("macOS application menu", () => {
  // A stand-in for @tauri-apps/api/menu that records each item's options.
  type Options = Record<string, unknown>;
  const fakeApi = () => {
    const made = { predefined: [] as Options[], items: [] as Options[] };
    const record = (bucket: Options[]) => ({
      new: async (options: Options) => {
        bucket.push(options);
        return { ...options, close: async () => undefined };
      },
    });
    const api = {
      PredefinedMenuItem: record(made.predefined),
      MenuItem: record(made.items),
      IconMenuItem: record(made.items),
      Submenu: record([]),
    };
    return { api: api as unknown as Parameters<typeof macApplicationMenu>[0], made };
  };

  // #80: the predefined Quit sends NSApp terminate:, which exits without a
  // window close-requested event — the unsaved-tabs prompt never runs.
  it("routes ⌘Q through the window close flow, not the predefined Quit", async () => {
    const { api, made } = fakeApi();
    const quit = vi.fn();
    await macApplicationMenu(api, [], () => undefined, quit);
    expect(made.predefined.map((options) => options.item)).not.toContain("Quit");
    const item = made.items.find((options) => options.accelerator === "CmdOrCtrl+Q");
    expect(item?.text).toBe("Quit Label Lab");
    (item?.action as () => void)();
    expect(quit).toHaveBeenCalledOnce();
  });
});
