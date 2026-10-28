// appmenu.test.ts — native menu accelerators, standard text-edit roles, and
// the macOS application menu's Quit routing.
import { describe, expect, it, vi } from "vitest";
import {
  APP_MENUS, actionsIn, macApplicationMenu, menuSymbols, nativeAccelerator,
} from "@/components/AppMenu";
import type { Command } from "@/components/CommandMenu";

vi.mock("@tauri-apps/api/app", () => ({
  defaultWindowIcon: async () => ({ rid: 1, close: async () => undefined }),
}));

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
    expect(nativeAccelerator(command({ id: "undo", shortcut: "⌘Z" }))).toBe("CmdOrCtrl+Z");
    expect(nativeAccelerator(command({ id: "redo", shortcut: "⇧⌘Z" }))).toBe("CmdOrCtrl+Shift+Z");
  });

  // ⌘B is owned by the sidebar's guarded listener: a native accelerator
  // would fire before the webview and take Bold away from a text field.
  it("leaves every other display-only shortcut off the native menu", () => {
    expect(nativeAccelerator(command({ id: "layers", shortcut: "⌘B" }))).toBeUndefined();
    expect(nativeAccelerator(command({ id: "layer-remove", shortcut: "⌫" }))).toBeUndefined();
  });

  it("leaves bare-key bindings with the guarded webview listener", () => {
    expect(nativeAccelerator(command({ key: "1" }))).toBeUndefined();
    expect(nativeAccelerator(command({ key: "g" }))).toBeUndefined();
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

  it("gives every row an SF Symbol, and every title is unique", () => {
    const pairs = menuSymbols();
    const actions = actionsIn(APP_MENUS);
    // Unique: menu_symbols.rs finds each native row by its title.
    expect(new Set(pairs.map(([title]) => title)).size).toBe(pairs.length);
    for (const action of actions) {
      expect(pairs.find(([title]) => title === action.text), action.id).toBeDefined();
    }
    expect(Object.fromEntries(pairs)).toMatchObject({
      "New Tab": "plus.square.on.square", "Open Label…": "folder",
      "Save Label": "square.and.arrow.down", "Export": "square.and.arrow.up",
      "Undo": "arrow.uturn.backward", "Settings…": "gear", "Rulers": "ruler",
      "Add Text Layer": "textformat", "Remove Layer": "trash", "Layers": "sidebar.left",
      "Appearance": "paintpalette", "Dark": "moon", "Mask": "circle.lefthalf.filled",
    });
  });

  it("names the .label commands Label and gives Save Master its ellipsis (it opens a review)", () => {
    const file = APP_MENUS.find((menu) => menu.id === "file-menu")!;
    const texts = file.items.flatMap((entry) => entry.kind === "action" ? [entry.text] : []);
    expect(texts).toEqual([
      "New Tab", "Open Label…", "Close Tab", "Save Label", "Save Label As…",
      "Open Master…", "Save Master…", "Save Master As…",
    ]);
  });
});

describe("layer menu", () => {
  it("sits between Edit and View with the four Add rows, a separator, then Remove Layer", () => {
    expect(APP_MENUS.map((menu) => menu.text)).toEqual(["File", "Edit", "Layer", "View"]);
    const layer = APP_MENUS.find((menu) => menu.id === "layer-menu")!;
    expect(layer.items.map((entry) => entry.kind === "action" ? entry.id : entry.kind)).toEqual([
      "layer-add-text", "layer-add-image", "layer-add-barcode", "layer-add-qr", "separator", "layer-remove",
    ]);
  });
});

describe("view menu", () => {
  it("offers the four preview views in key 1–4 order, the can count, then the two toggles", () => {
    const view = APP_MENUS.find((menu) => menu.id === "view-menu")!;
    const ids = view.items.flatMap((entry) =>
      entry.kind === "action" ? [entry.id] : []);
    // The four-pack is not a view of its own: One Can / Four-Pack is the Can
    // view's count, also the status bar's 1|4. Guides is one switch over
    // bleed, margin, center and manual guides — no per-kind items, no Clear.
    expect(ids).toEqual(["view-label", "view-mask", "view-rendered", "view-can", "view-one-can", "view-four-pack",
      "layers", "rulers", "guides", "zoom-in", "zoom-out", "zoom-fit"]);
  });

  it("offers Appearance as a submenu of three check rows", () => {
    const view = APP_MENUS.find((menu) => menu.id === "view-menu")!;
    const appearance = view.items.find((entry) => entry.kind === "submenu" && entry.id === "appearance-menu");
    expect(appearance?.kind === "submenu" && appearance.items).toEqual([
      expect.objectContaining({ id: "theme-system", text: "System", check: true }),
      expect.objectContaining({ id: "theme-light", text: "Light", check: true }),
      expect.objectContaining({ id: "theme-dark", text: "Dark", check: true }),
    ]);
  });

  // The one unit preference (rulers, inspector lengths, drag readout, margin
  // inset) stays reachable with the rulers hidden.
  it("offers Units as a submenu of four check rows, next to Rulers and Guides", () => {
    const view = APP_MENUS.find((menu) => menu.id === "view-menu")!;
    const at = view.items.findIndex((entry) => entry.kind === "submenu" && entry.id === "units-menu");
    expect(view.items[at - 1]).toMatchObject({ id: "guides" });
    const units = view.items[at];
    expect(units).toMatchObject({ text: "Units", symbol: "ruler" });
    expect(units.kind === "submenu" && units.items).toEqual([
      expect.objectContaining({ id: "unit-in", text: "Inches", check: true }),
      expect.objectContaining({ id: "unit-mm", text: "Millimetres", check: true }),
      expect.objectContaining({ id: "unit-pt", text: "Points", check: true }),
      expect.objectContaining({ id: "unit-px", text: "Pixels", check: true }),
    ]);
  });

  it("gives the zoom commands native accelerators macOS can show", () => {
    const run = () => undefined;
    expect(nativeAccelerator({ id: "zoom-in", label: "Zoom In", key: "=", mods: "⌘", run })).toBe("CmdOrCtrl+=");
    expect(nativeAccelerator({ id: "zoom-out", label: "Zoom Out", key: "-", mods: "⌘", run })).toBe("CmdOrCtrl+-");
    expect(nativeAccelerator({ id: "zoom-fit", label: "Zoom to Fit", key: "0", mods: "⌘", run })).toBe("CmdOrCtrl+0");
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
  // The Settings… row nativeEntry builds; only its title is read here.
  const settingsRow = { text: "Settings…" } as unknown as Parameters<typeof macApplicationMenu>[4];

  // #80: the predefined Quit sends NSApp terminate:, which exits without a
  // window close-requested event — the unsaved-tabs prompt never runs.
  it("routes ⌘Q through the window close flow, not the predefined Quit", async () => {
    const { api, made } = fakeApi();
    const quit = vi.fn();
    await macApplicationMenu(api, [], () => undefined, quit, settingsRow);
    expect(made.predefined.map((options) => options.item)).not.toContain("Quit");
    const item = made.items.find((options) => options.accelerator === "CmdOrCtrl+Q");
    expect(item?.text).toBe("Quit Label Lab");
    (item?.action as () => void)();
    expect(quit).toHaveBeenCalledOnce();
  });

});
