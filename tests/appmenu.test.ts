// appmenu.test.ts — native menu accelerators and standard text-edit roles.
import { describe, expect, it } from "vitest";
import { APP_MENUS, nativeAccelerator } from "@/components/AppMenu";
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

type MenuNode = (typeof APP_MENUS)[number]["items"][number];
type ActionNode = Extract<MenuNode, { kind: "action" }>;

function actionsOf(entries: readonly MenuNode[]): ActionNode[] {
  return entries.flatMap((entry) => {
    if (entry.kind === "action") return [entry];
    return entry.kind === "submenu" ? actionsOf(entry.items) : [];
  });
}

function nativeIconOf(action: ActionNode | undefined) {
  if (!action || !("nativeIcon" in action)) return undefined;
  return action.nativeIcon;
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
    const exported = file.items.find((entry) =>
      entry.kind === "submenu" && entry.id === "export-menu");
    if (exported?.kind !== "submenu") throw new Error("export-menu missing");
    expect(exported.icon).toBeTruthy();
    expect(exported.nativeIcon).toBe("Share");
    const actions = actionsOf(file.items);
    for (const action of actions) {
      expect("icon" in action && action.icon, action.id).toBeTruthy();
    }
    const byId = Object.fromEntries(actions.map((action) => [action.id, action]));
    expect(nativeIconOf(byId["tab-new"])).toBe("Add");
    expect(nativeIconOf(byId["project-open"])).toBe("Folder");
    expect(nativeIconOf(byId["tab-close"])).toBe("Remove");
    expect(nativeIconOf(byId["project-save"])).toBeUndefined();
    expect(nativeIconOf(byId["project-save-as"])).toBe("MultipleDocuments");
    expect(nativeIconOf(byId["master-open"])).toBe("FolderSmart");
    expect(nativeIconOf(byId["master-save"])).toBe("Bookmarks");
    expect(nativeIconOf(byId["master-save-as"])).toBe("Bookmarks");
    expect(nativeIconOf(byId["export-both"])).toBe("Share");
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
});

describe("native text editing menu", () => {
  it("installs every standard role needed for clipboard editing", () => {
    const edit = APP_MENUS.find((menu) => menu.id === "edit-menu")!;
    const roles = edit.items.flatMap((entry) =>
      entry.kind === "predefined" && entry.item !== "Separator" ? [entry.item] : []);
    expect(roles).toEqual(["Cut", "Copy", "Paste", "SelectAll"]);
  });

  it("icons Undo, Redo and Settings, and leaves View checks glyph-free", () => {
    const edit = APP_MENUS.find((menu) => menu.id === "edit-menu")!;
    const view = APP_MENUS.find((menu) => menu.id === "view-menu")!;
    const editActions = actionsOf(edit.items);
    for (const action of editActions) {
      expect("icon" in action && action.icon, action.id).toBeTruthy();
    }
    expect(nativeIconOf(editActions.find((action) => action.id === "settings")))
      .toBe("PreferencesGeneral");
    for (const action of actionsOf(view.items)) {
      expect("icon" in action, action.id).toBe(false);
      expect("nativeIcon" in action, action.id).toBe(false);
    }
  });
});
