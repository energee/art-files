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
    expect(nativeAccelerator(command({ key: "b" }))).toBeUndefined();
  });
});

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
});

describe("view menu", () => {
  it("offers exactly the three preview views, in key 1–3 order", () => {
    const view = APP_MENUS.find((menu) => menu.id === "view-menu")!;
    const ids = view.items.flatMap((entry) =>
      entry.kind === "action" ? [entry.id] : []);
    // The Rendered and Four-Pack views are gone: the four-pack is the Can
    // view's 1 / 4 count (a toolbar control, not a menu entry).
    expect(ids.slice(0, 3)).toEqual(["view-label", "view-mask", "view-can"]);
    for (const gone of ["view-standard", "view-rendered", "view-pack"]) {
      expect(ids).not.toContain(gone);
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
});
