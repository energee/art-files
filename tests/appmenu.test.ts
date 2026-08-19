// appmenu.test.ts — native menu accelerators and standard text-edit roles.
import { describe, expect, it } from "vitest";
import { NATIVE_TEXT_EDIT_ITEMS, nativeAccelerator } from "@/components/AppMenu";
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

describe("native text editing menu", () => {
  it("installs every standard role needed for clipboard editing", () => {
    expect(NATIVE_TEXT_EDIT_ITEMS).toEqual(["Cut", "Copy", "Paste", "SelectAll"]);
  });
});
