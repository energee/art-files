import { isMacOS } from "@/keys";
// AppMenu.tsx — one File/Edit/Layer/View menu layout, rendered as shadcn chrome in
// the browser and installed as the native application menu under Tauri. The
// desktop menu also carries File → Open Recent, rebuilt from src/recent.ts.
import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  CheckMenuItem, IconMenuItem, MenuItem, PredefinedMenuItem, Submenu,
} from "@tauri-apps/api/menu";
import {
  ALargeSmall, Barcode, Bookmark, BookmarkPlus, BookOpen, Columns2, Contrast, Cylinder, FileImage, Files, FolderOpen,
  Grid2x2, Grid3x3, History, ImagePlus, Layers, Maximize2, Monitor, Moon, Palette, PanelLeft, QrCode, RectangleHorizontal,
  Redo2, Ruler, Settings, Sparkles, Square, SquareArrowDown, SquareArrowUp, SquarePlus, Sun, Trash2, Type, Undo2, X,
  ZoomIn, ZoomOut, type LucideIcon,
} from "lucide-react";
import { shortcutOf, type Command } from "@/components/CommandMenu";
import { dialogOpen, isTypingTarget } from "@/keys";
import { clearRecent, openRecent, recentLabels, recentTitles, subscribeRecent } from "@/recent";
import {
  Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarMenu,
  MenubarSeparator, MenubarShortcut, MenubarSub, MenubarSubContent,
  MenubarSubTrigger, MenubarTrigger,
} from "@/components/ui/menubar";
import { errMsg } from "@/lib/utils";

/** SF Symbols, the icons macOS itself uses in menus. The Mac menu shows the
 *  symbol (set natively after install, so it tints with light and dark mode;
 *  src-tauri/src/menu_symbols.rs) and the in-window menu draws the closest
 *  Lucide glyph, so every row carries the same picture in both. */
const SYMBOL_GLYPH = {
  "plus.square.on.square": SquarePlus,
  "folder": FolderOpen,
  "clock.arrow.circlepath": History,
  "xmark": X,
  "square.and.arrow.down": SquareArrowDown,
  "doc.on.doc": Files,
  "books.vertical": BookOpen,
  "bookmark": Bookmark,
  "doc.badge.plus": BookmarkPlus,
  "square.and.arrow.up": SquareArrowUp,
  "photo": FileImage,
  "circle.lefthalf.filled": Contrast,
  "square.3.layers.3d": Layers,
  "arrow.uturn.backward": Undo2,
  "arrow.uturn.forward": Redo2,
  "gear": Settings,
  "rectangle": RectangleHorizontal,
  "cylinder": Cylinder,
  "sparkles": Sparkles,
  "square": Square,
  "square.grid.2x2": Grid2x2,
  "ruler": Ruler,
  "rectangle.split.2x1": Columns2,
  "plus.magnifyingglass": ZoomIn,
  "minus.magnifyingglass": ZoomOut,
  "arrow.up.left.and.down.right.magnifyingglass": Maximize2,
  "textformat": Type,
  "photo.badge.plus": ImagePlus,
  "barcode": Barcode,
  "qrcode": QrCode,
  "trash": Trash2,
  "sidebar.left": PanelLeft,
  "desktopcomputer": Monitor,
  "sun.max": Sun,
  "moon": Moon,
  "paintpalette": Palette,
  "textformat.size": ALargeSmall,
  "square.grid.3x3": Grid3x3,
} satisfies Record<string, LucideIcon>;
type MenuSymbol = keyof typeof SYMBOL_GLYPH;

type ActionEntry = {
  kind: "action";
  id: string;
  text: string;
  /** A checkmark row: its state comes from `checked`, not the command. */
  check?: true;
  /** The row reads the command's label rather than `text`, which is then only
   *  the title it is installed under (Save Master… reads Save Variant… while
   *  a variant is the version) — see rowTitle. */
  live?: true;
  /** Extra ⌘K search terms (cmdk keywords): the palette's old wording, so a
   *  search for "Hide rulers" or "Preview: Mask" still finds the row. */
  keywords?: string[];
  symbol: MenuSymbol;
};
type CheckAction = ActionEntry & { check: true };
type SeparatorEntry = { kind: "separator"; id: string };
type PredefinedEntry = {
  kind: "predefined";
  item: "Separator" | "Cut" | "Copy" | "Paste" | "SelectAll" | "Fullscreen";
};
type SubmenuEntry = {
  kind: "submenu";
  id: string;
  text: string;
  /** Absent on the top-level File/Edit/Layer/View titles, which carry no icon. */
  symbol?: MenuSymbol;
  items: MenuEntry[];
};
/** File → Open Recent: desktop only, its rows built from src/recent.ts. */
type RecentEntry = { kind: "recent"; id: string; text: string; symbol: MenuSymbol };
type MenuEntry = ActionEntry | SeparatorEntry | PredefinedEntry | SubmenuEntry | RecentEntry;

/** The application-owned menus. One table drives both renderers: every row
 *  names an SF Symbol, which the Mac menu shows and the in-window menu draws
 *  as its Lucide match (SYMBOL_GLYPH). Exported for tests, which pin the
 *  wiring (e.g. the Edit menu's native clipboard roles) against this data. */
export const APP_MENUS: SubmenuEntry[] = [
  {
    kind: "submenu", id: "file-menu", text: "File", items: [
      { kind: "action", id: "tab-new", text: "New Tab", symbol: "plus.square.on.square" },
      { kind: "action", id: "project-open", text: "Open Label…", symbol: "folder" },
      { kind: "recent", id: "recent-menu", text: "Open Recent", symbol: "clock.arrow.circlepath" },
      { kind: "action", id: "tab-close", text: "Close Tab", symbol: "xmark" },
      { kind: "separator", id: "file-new" },
      { kind: "action", id: "project-save", text: "Save Label", symbol: "square.and.arrow.down" },
      { kind: "action", id: "project-save-as", text: "Save Label As…", symbol: "doc.on.doc" },
      { kind: "separator", id: "file-master" },
      { kind: "action", id: "master-open", text: "Open Master…", symbol: "books.vertical" },
      // An ellipsis: it opens the review before anything is written.
      { kind: "action", id: "master-save", text: "Save Master…", live: true, symbol: "bookmark" },
      { kind: "action", id: "master-save-as", text: "Save Master As…", symbol: "doc.badge.plus" },
      { kind: "separator", id: "file-projects" },
      {
        kind: "submenu", id: "export-menu", text: "Export", symbol: "square.and.arrow.up", items: [
          { kind: "action", id: "export-both", text: "Export PDFs", symbol: "doc.on.doc" },
          { kind: "action", id: "export-both-as", text: "Export PDFs As…", symbol: "doc.on.doc" },
          { kind: "action", id: "export-psd", text: "Export PSDs", symbol: "square.3.layers.3d" },
          { kind: "action", id: "export-psd-as", text: "Export PSDs As…", symbol: "square.3.layers.3d" },
        ],
      },
    ],
  },
  {
    kind: "submenu", id: "edit-menu", text: "Edit", items: [
      { kind: "action", id: "undo", text: "Undo", symbol: "arrow.uturn.backward" },
      { kind: "action", id: "redo", text: "Redo", symbol: "arrow.uturn.forward" },
      // Both rows move to the application menu on the Mac (MAC_MENUS).
      { kind: "separator", id: "edit-settings" },
      { kind: "action", id: "settings", text: "Settings…", symbol: "gear" },
      { kind: "predefined", item: "Separator" },
      { kind: "predefined", item: "Cut" },
      { kind: "predefined", item: "Copy" },
      { kind: "predefined", item: "Paste" },
      { kind: "predefined", item: "SelectAll" },
    ],
  },
  {
    // Remove Layer's ⌫ is display-only, like Undo's: Delete/Backspace go
    // through App's guarded listener, which stands aside in text fields.
    kind: "submenu", id: "layer-menu", text: "Layer", items: [
      { kind: "action", id: "layer-add-text", text: "Add Text Layer", symbol: "textformat" },
      { kind: "action", id: "layer-add-image", text: "Add Image Layer", symbol: "photo.badge.plus" },
      { kind: "action", id: "layer-add-barcode", text: "Add Barcode Layer", symbol: "barcode" },
      { kind: "action", id: "layer-add-qr", text: "Add QR Layer", symbol: "qrcode" },
      { kind: "separator", id: "layer-remove-sep" },
      { kind: "action", id: "layer-remove", text: "Remove Layer", symbol: "trash" },
    ],
  },
  {
    kind: "submenu", id: "view-menu", text: "View", items: [
      { kind: "action", id: "view-label", text: "Label", check: true, keywords: ["Preview: Label"], symbol: "rectangle" },
      { kind: "action", id: "view-mask", text: "Mask", check: true, keywords: ["Preview: Mask"], symbol: "circle.lefthalf.filled" },
      { kind: "action", id: "view-rendered", text: "Rendered", check: true, keywords: ["Preview: Rendered", "Foil", "Metallic"], symbol: "sparkles" },
      { kind: "action", id: "view-can", text: "Can", check: true, keywords: ["Preview: Can"], symbol: "cylinder" },
      { kind: "separator", id: "view-modes" },
      // The Can view's count, as the status bar's 1|4; disabled in 2D.
      { kind: "action", id: "view-one-can", text: "One Can", check: true, keywords: ["Preview: One Can"], symbol: "square" },
      { kind: "action", id: "view-four-pack", text: "Four-Pack", check: true, keywords: ["Preview: Four-Pack"], symbol: "square.grid.2x2" },
      { kind: "separator", id: "view-cans" },
      // ⌘B is the sidebar provider's own guarded listener, never a native
      // accelerator (that would take Bold from a text field).
      { kind: "action", id: "layers", text: "Layers", check: true, keywords: ["Show sidebar", "Hide sidebar"], symbol: "sidebar.left" },
      { kind: "action", id: "rulers", text: "Rulers", check: true, keywords: ["Show rulers", "Hide rulers"], symbol: "ruler" },
      { kind: "action", id: "guides", text: "Guides", check: true, keywords: ["Show guides", "Hide guides"], symbol: "rectangle.split.2x1" },
      // The app's one length unit, as the ruler corner's picker sets it; here
      // so it stays reachable with the rulers hidden. One is always checked.
      {
        kind: "submenu", id: "units-menu", text: "Units", symbol: "ruler", items: [
          { kind: "action", id: "unit-in", text: "Inches", check: true, keywords: ["Units"], symbol: "ruler" },
          { kind: "action", id: "unit-mm", text: "Millimetres", check: true, keywords: ["Units", "Millimeters"], symbol: "ruler" },
          { kind: "action", id: "unit-pt", text: "Points", check: true, keywords: ["Units"], symbol: "textformat.size" },
          { kind: "action", id: "unit-px", text: "Pixels", check: true, keywords: ["Units"], symbol: "square.grid.3x3" },
        ],
      },
      { kind: "separator", id: "view-zoom" },
      { kind: "action", id: "zoom-in", text: "Zoom In", symbol: "plus.magnifyingglass" },
      { kind: "action", id: "zoom-out", text: "Zoom Out", symbol: "minus.magnifyingglass" },
      { kind: "action", id: "zoom-fit", text: "Zoom to Fit", symbol: "arrow.up.left.and.down.right.magnifyingglass" },
      { kind: "separator", id: "view-appearance" },
      // System / Light / Dark, also in the ⌘K palette; one is always checked.
      {
        kind: "submenu", id: "appearance-menu", text: "Appearance", symbol: "paintpalette", items: [
          { kind: "action", id: "theme-system", text: "System", check: true, keywords: ["Theme"], symbol: "desktopcomputer" },
          { kind: "action", id: "theme-light", text: "Light", check: true, keywords: ["Theme"], symbol: "sun.max" },
          { kind: "action", id: "theme-dark", text: "Dark", check: true, keywords: ["Theme"], symbol: "moon" },
        ],
      },
      // Ours rather than the row AppKit inserts on first open, which arrives
      // after menu_symbols.rs has run and so would stay without its icon.
      { kind: "predefined", item: "Separator" },
      { kind: "predefined", item: "Fullscreen" },
    ],
  },
];

/** The Mac menu bar's table: Settings… (and its separator) leave Edit for
 *  the application menu, where macOS puts it (#551; macApplicationMenu).
 *  Windows, Linux and the in-window menu keep APP_MENUS. Exported for tests. */
export const MAC_MENUS: SubmenuEntry[] = APP_MENUS.map((menu) => ({
  ...menu,
  items: menu.items.filter((e) => !("id" in e && (e.id === "settings" || e.id === "edit-settings"))),
}));
const SETTINGS_ROW = actionsIn(APP_MENUS).find((e) => e.id === "settings")!;

function isCheckAction(entry: ActionEntry): entry is CheckAction {
  return !!entry.check;
}

/** What a row reads on every surface (both menus and the ⌘K palette): its
 *  own text, or the command's label for a `live` row. */
export const rowTitle = (entry: ActionEntry, command: Command) =>
  entry.live ? command.label : entry.text;

/** The ⌘K palette's groups: one per menu and submenu, in menu order, each
 *  holding that menu's own rows (a submenu's rows are its own group). */
export function menuGroups(entries: MenuEntry[] = APP_MENUS): { heading: string; rows: ActionEntry[] }[] {
  return entries.flatMap((entry) => {
    if (entry.kind !== "submenu") return [];
    const rows = entry.items.filter((item): item is ActionEntry => item.kind === "action");
    return [{ heading: entry.text, rows }, ...menuGroups(entry.items)];
  });
}

export function actionsIn(entries: MenuEntry[]): ActionEntry[] {
  return entries.flatMap((entry) => {
    if (entry.kind === "action") return [entry];
    return entry.kind === "submenu" ? actionsIn(entry.items) : [];
  });
}
const MENU_ACTIONS = actionsIn(APP_MENUS);
const CHECK_IDS = new Set(MENU_ACTIONS.filter(isCheckAction).map((entry) => entry.id));

// Menu chrome belongs to the browser renderer only. The native renderer uses
// the same APP_MENUS data but lets the OS size and paint each item.
const MENU_TRIGGER = "px-2 py-1 text-xs font-normal";
const MENU_ITEMS =
  "min-w-52 [&_[data-slot=menubar-item]]:text-xs [&_[data-slot=menubar-checkbox-item]]:text-xs [&_[data-slot=menubar-sub-trigger]]:text-xs";

type CommandIndex = Record<string, Command>;
/** Which check rows are on, by command id: one map for both menus and ⌘K. */
export type CheckedState = Partial<Record<string, boolean>>;

function MenuGlyph({ name }: { name: MenuSymbol }) {
  const Icon = SYMBOL_GLYPH[name];
  // Sized here: MenubarCheckboxItem, unlike MenubarItem, has no svg size
  // rule, so an unsized glyph drew at Lucide's 24px default on check rows.
  return <Icon aria-hidden="true" className="size-4" />;
}

function WebEntries(props: {
  entries: MenuEntry[];
  commands: CommandIndex;
  checked: CheckedState;
}) {
  return props.entries.map((entry) => {
    // Native-only edit items are omitted in the browser build: the browser
    // already owns text-edit shortcuts, while Tauri needs the corresponding OS
    // responder-chain items for those shortcuts to reach the focused field.
    // Open Recent lists desktop paths, which a browser cannot reopen.
    if (entry.kind === "predefined" || entry.kind === "recent") return null;
    if (entry.kind === "separator") return <MenubarSeparator key={entry.id} />;
    if (entry.kind === "submenu") {
      return (
        <MenubarSub key={entry.id}>
          <MenubarSubTrigger>
            {entry.symbol && <MenuGlyph name={entry.symbol} />}
            {entry.text}
          </MenubarSubTrigger>
          <MenubarSubContent className={MENU_ITEMS}>
            <WebEntries entries={entry.items} commands={props.commands} checked={props.checked} />
          </MenubarSubContent>
        </MenubarSub>
      );
    }

    const command = props.commands[entry.id];
    const keys = shortcutOf(command);
    if (isCheckAction(entry)) {
      return (
        <MenubarCheckboxItem key={entry.id} checked={!!props.checked[entry.id]}
          disabled={command.disabled} onClick={command.run}>
          <MenuGlyph name={entry.symbol} />
          {rowTitle(entry, command)}
          {keys && <MenubarShortcut>{keys}</MenubarShortcut>}
        </MenubarCheckboxItem>
      );
    }
    return (
      <MenubarItem key={entry.id} disabled={command.disabled} onClick={command.run}>
        <MenuGlyph name={entry.symbol} />
        {rowTitle(entry, command)}
        {keys && <MenubarShortcut>{keys}</MenubarShortcut>}
      </MenubarItem>
    );
  });
}

function WebMenu(props: { commands: CommandIndex; checked: CheckedState }) {
  return (
    <Menubar className="h-auto gap-0 rounded-none border-0 p-0">
      {APP_MENUS.map((menu) => (
        <MenubarMenu key={menu.id}>
          <MenubarTrigger className={MENU_TRIGGER}>{menu.text}</MenubarTrigger>
          <MenubarContent align="start" className={MENU_ITEMS}>
            <WebEntries entries={menu.items} commands={props.commands} checked={props.checked} />
          </MenubarContent>
        </MenubarMenu>
      ))}
    </Menubar>
  );
}

type MenuApi = typeof import("@tauri-apps/api/menu");
type NativeResource = { close: () => Promise<void> };
type NativeEntry = MenuItem | CheckMenuItem | IconMenuItem | PredefinedMenuItem | Submenu;
type NativeAction = MenuItem | CheckMenuItem | IconMenuItem;


/** Native menus must own modified accelerators so macOS can display them.
 *  Bare 1–3/R/G bindings deliberately stay in App's guarded key listener:
 *  registering those with the OS would fire them while the user is typing.
 *  So do display-only shortcuts other than Undo/Redo (whose run below hands a
 *  focused field its own undo): ⌘B would take Bold from a text field. */
export function nativeAccelerator(command: Command): string | undefined {
  if (!command.key && command.id !== "undo" && command.id !== "redo") return undefined;
  const glyphs = shortcutOf(command, true);
  if (!glyphs?.includes("⌘")) return undefined;
  const key = glyphs.replace("⇧", "").replace("⌘", "");
  return `CmdOrCtrl+${glyphs.includes("⇧") ? "Shift+" : ""}${key}`;
}

async function closeResources(resources: NativeResource[]) {
  const owned = resources.splice(0).reverse();
  await Promise.allSettled(owned.map((resource) => resource.close()));
}

/** The macOS application menu. Quit is a custom item, not the predefined
 *  one: that sends NSApp `terminate:`, which exits without a window
 *  close-requested event, so ⌘Q skipped the unsaved-tabs prompt (#80).
 *  `quit` must run the window close flow instead. `settings` is the
 *  Settings… row, built like every other command row, shown under About
 *  where macOS users look for it (#551). Exported for tests. */
export async function macApplicationMenu(
  api: MenuApi,
  resources: NativeResource[],
  checkForUpdates: () => void,
  quit: () => void,
  settings: NativeEntry,
) {
  const definitions = [
    { item: { About: null } as const },
    { item: "Separator" as const },
    { item: "Services" as const },
    { item: "Separator" as const },
    { item: "Hide" as const },
    { item: "HideOthers" as const },
    { item: "ShowAll" as const },
    { item: "Separator" as const },
  ];
  const items: NativeEntry[] = await Promise.all(definitions.map(async (definition) => {
    const item = await api.PredefinedMenuItem.new(definition);
    resources.push(item);
    return item;
  }));
  const updater = await api.IconMenuItem.new({
    id: "check-for-updates",
    text: UPDATE_ITEM_TEXT.check,
    action: checkForUpdates,
    icon: "Refresh",
  });
  resources.push(updater);
  items.splice(1, 0, updater);
  const separator = await api.PredefinedMenuItem.new({ item: "Separator" });
  resources.push(separator);
  // About, Check for Updates…, separator, Settings…, separator, Services…
  items.splice(3, 0, settings, separator);
  const quitItem = await api.MenuItem.new({
    id: "quit",
    text: "Quit Label Lab",
    accelerator: "CmdOrCtrl+Q",
    action: quit,
  });
  resources.push(quitItem);
  items.push(quitItem);
  const menu = await api.Submenu.new({ id: "application-menu", text: "Label Lab", items });
  resources.push(menu);
  return menu;
}

/** Each installed Open Recent submenu's current rows, so a rebuild can
 *  remove exactly them (the menu API's items() returns new wrappers). */
const recentRowsOf = new WeakMap<object, NativeEntry[]>();

/** Open Recent's rows: one per remembered path (newest first), a separator,
 *  and Clear Menu — alone and disabled while the list is empty. */
async function recentRows(api: MenuApi, resources: NativeResource[]): Promise<NativeEntry[]> {
  const paths = recentLabels();
  const titles = recentTitles(paths);
  const rows: NativeEntry[] = await Promise.all(paths.map((path, i) => api.MenuItem.new({
    // Native menus read a lone & as a mnemonic marker; && shows one.
    id: `recent-${i}`, text: titles[i].replaceAll("&", "&&"),
    // A modal dialog blocks this like every other menu command (#244).
    action: () => { if (!dialogOpen()) openRecent(path); },
  })));
  if (paths.length) rows.push(await api.PredefinedMenuItem.new({ item: "Separator" }));
  rows.push(await api.MenuItem.new({
    id: "recent-clear", text: "Clear Menu", enabled: paths.length > 0, action: clearRecent,
  }));
  resources.push(...rows);
  return rows;
}

async function nativeEntry(
  api: MenuApi,
  entry: MenuEntry,
  commands: CommandIndex,
  checked: CheckedState,
  run: (id: string) => void,
  resources: NativeResource[],
): Promise<NativeEntry> {
  if (entry.kind === "predefined" || entry.kind === "separator") {
    const item = await api.PredefinedMenuItem.new({
      item: entry.kind === "predefined" ? entry.item : "Separator",
      // AppKit's own wording (muda says "Toggle Full Screen"); SYSTEM_ROWS
      // gives this title its symbol.
      ...(entry.kind === "predefined" && entry.item === "Fullscreen" ? { text: "Enter Full Screen" } : {}),
    });
    resources.push(item);
    return item;
  }
  if (entry.kind === "submenu") {
    const items = await Promise.all(entry.items.map((item) =>
      nativeEntry(api, item, commands, checked, run, resources)));
    const submenu = await api.Submenu.new({
      id: entry.id,
      text: entry.text,
      items,
    });
    resources.push(submenu);
    return submenu;
  }
  if (entry.kind === "recent") {
    const rows = await recentRows(api, resources);
    const submenu = await api.Submenu.new({ id: entry.id, text: entry.text, items: rows });
    recentRowsOf.set(submenu, rows);
    resources.push(submenu);
    return submenu;
  }

  const command = commands[entry.id];
  const options = {
    id: entry.id,
    // The plain title: menu_symbols.rs finds the row by it. A `live` row's
    // label goes on afterwards, through the state sync's setText.
    text: entry.text,
    enabled: !command.disabled,
    accelerator: nativeAccelerator(command),
    action: () => run(entry.id),
  };
  let item: NativeAction;
  if (isCheckAction(entry)) {
    item = await api.CheckMenuItem.new({ ...options, checked: !!checked[entry.id] });
  } else {
    item = await api.MenuItem.new(options);
  }
  resources.push(item);
  return item;
}

/** Native-only rows with no in-window twin: the View menu's full-screen
 *  toggle, under both titles AppKit gives it. */
const SYSTEM_ROWS: [string, string][] =
  ["Enter Full Screen", "Exit Full Screen"].map((title) => [title, "viewfinder"]);

/** Every row's title and SF Symbol, for menu_symbols.rs to set on the
 *  installed Mac menu. Titles are unique across APP_MENUS. Exported for tests. */
export function menuSymbols(entries: MenuEntry[] = APP_MENUS): [string, string][] {
  return entries.flatMap((entry): [string, string][] => {
    if (entry.kind === "action" || entry.kind === "recent") return [[entry.text, entry.symbol]];
    if (entry.kind !== "submenu") return [];
    const own: [string, string][] = entry.symbol ? [[entry.text, entry.symbol]] : [];
    return [...own, ...menuSymbols(entry.items)];
  });
}

/** The macOS application-menu item's two labels, toggled by `updateInstalled`. */
const UPDATE_ITEM_TEXT = { check: "Check for Updates…", restart: "Restart to Update" } as const;

function useNativeMenu(
  desktop: boolean,
  commands: CommandIndex,
  checked: CheckedState,
  onError: (message: string) => void,
  onCheckForUpdates: () => void,
  updateInstalled: boolean,
) {
  const commandsRef = useRef(commands);
  const checkedRef = useRef(checked);
  const errorRef = useRef(onError);
  const updateRef = useRef(onCheckForUpdates);
  commandsRef.current = commands;
  checkedRef.current = checked;
  errorRef.current = onError;
  updateRef.current = onCheckForUpdates;

  const [items, setItems] = useState<Map<string, NativeAction> | null>(null);
  const updateQueue = useRef(Promise.resolve());
  const appliedState = useRef(new Map<string, string>());
  // Bumped when a native check item is clicked. muda flips a CheckMenuItem
  // itself on click, so choosing the current view (a no-op for app state)
  // leaves it unchecked; forgetting its applied state and re-running the sync
  // effect re-asserts what app state says.
  const [resync, setResync] = useState(0);

  useEffect(() => {
    if (!desktop) return;
    let live = true;
    const resources: NativeResource[] = [];
    let stopRecent = () => {};

    void (async () => {
      try {
        // The menu API is desktop-only and stays out of the browser's initial
        // chunk. isTauri alone is not enough to make a static import lazy.
        const api = await import("@tauri-apps/api/menu");
        const run = (id: string) => {
          const command = commandsRef.current[id];
          if (!command || command.disabled) return;
          // Re-assert the check even when nothing runs below.
          if (CHECK_IDS.has(id)) {
            appliedState.current.delete(id);
            setResync((n) => n + 1);
          }
          // Native accelerators fire before the webview's keydown, so they
          // follow App's key rules: the focused field keeps its own undo
          // stack, and a modal dialog blocks every command on the tab behind
          // it — ⌘Z (#225) as much as ⌘W, ⌘S or a menu click (#244).
          if ((id === "undo" || id === "redo") && isTypingTarget(document.activeElement)) {
            document.execCommand(id);
            return;
          }
          if (dialogOpen()) return;
          command.run();
        };
        // What Open Recent's first rows show; a change before the subscribe
        // below would otherwise never reach the menu.
        const recentBuiltFrom = JSON.stringify(recentLabels());
        const native = (entry: MenuEntry) =>
          nativeEntry(api, entry, commandsRef.current, checkedRef.current, run, resources);
        const roots = await Promise.all((isMacOS() ? MAC_MENUS : APP_MENUS).map(native));
        // On macOS the first submenu is the conventional application menu;
        // the browser renderer must not show it. Other desktop platforms put
        // File first and receive their window-local menu bar normally.
        if (isMacOS()) {
          // Quit closes the window like its red button, so TabsShell's
          // onCloseRequested sweep prompts for unsaved tabs before exit.
          const quit = () => void import("@tauri-apps/api/window")
            .then((m) => m.getCurrentWindow().close())
            .catch((error) => errorRef.current(`Could not quit: ${errMsg(error)}`));
          roots.unshift(await macApplicationMenu(
            api, resources, () => updateRef.current(), quit, await native(SETTINGS_ROW)));
        } else {
          const updater = await api.MenuItem.new({
            id: "check-for-updates", text: UPDATE_ITEM_TEXT.check,
            action: () => updateRef.current(),
          });
          resources.push(updater);
          const help = await api.Submenu.new({ id: "help-menu", text: "Help", items: [updater] });
          resources.push(help);
          roots.push(help);
        }
        const menu = await api.Menu.new({ id: "label-lab-menu", items: roots });
        resources.push(menu);
        if (!live) {
          await closeResources(resources);
          return;
        }
        const previous = await menu.setAsAppMenu();
        if (previous) await previous.close();
        // The Tauri menu API only knows AppKit's old template icons; the SF
        // Symbols go on natively. A failure leaves the rows without icons.
        if (isMacOS()) {
          await invoke("set_menu_symbols", { symbols: [...menuSymbols(), ...SYSTEM_ROWS] })
            .catch((error: unknown) => console.warn("menu symbols:", error));
        }
        if (!live) {
          await closeResources(resources);
          return;
        }
        const actionItems = new Map<string, NativeAction>();
        for (const resource of resources) {
          if (
            resource instanceof api.MenuItem
            || resource instanceof api.CheckMenuItem
            || resource instanceof api.IconMenuItem
          ) {
            actionItems.set(resource.id, resource);
          }
        }
        // Rebuild Open Recent's rows whenever the list changes, one rebuild
        // at a time so two quick changes can't interleave their rows.
        const recent = resources.find((r): r is Submenu =>
          r instanceof api.Submenu && r.id === "recent-menu")!;
        let rebuilding = Promise.resolve();
        const rebuild = async () => {
          if (!live) return; // torn down: the cleanup closed every row
          const old = recentRowsOf.get(recent) ?? [];
          for (const row of old) {
            await recent.remove(row);
            await row.close();
          }
          // Closed rows leave the teardown list; recentRows adds the new ones.
          const gone = new Set<NativeResource>(old);
          resources.splice(0, resources.length, ...resources.filter((r) => !gone.has(r)));
          const rows = await recentRows(api, resources);
          // Torn down while the rows were made: the cleanup has already run.
          if (!live) return closeResources(resources);
          recentRowsOf.set(recent, rows);
          await recent.append(rows);
        };
        const queueRebuild = () => {
          // A teardown mid-rebuild closes the submenu under it; not an error.
          rebuilding = rebuilding.then(rebuild).catch((error) => {
            if (live) errorRef.current(`Could not update the native menu: ${String(error)}`);
          });
        };
        stopRecent = subscribeRecent(queueRebuild);
        if (JSON.stringify(recentLabels()) !== recentBuiltFrom) queueRebuild();
        appliedState.current.clear();
        setItems(actionItems);
      } catch (error) {
        await closeResources(resources);
        if (live) errorRef.current(`Could not install the native menu: ${errMsg(error)}`);
      }
    })();

    return () => {
      live = false;
      stopRecent();
      void closeResources(resources);
    };
  }, [desktop]);

  useEffect(() => {
    const item = items?.get("check-for-updates");
    if (!item) return;
    const text = updateInstalled ? UPDATE_ITEM_TEXT.restart : UPDATE_ITEM_TEXT.check;
    if (appliedState.current.get("check-for-updates:text") === text) return;
    appliedState.current.set("check-for-updates:text", text);
    if (!updateInstalled) return; // the item is created with the check label
    void item.setText(text).catch((error) => {
      errorRef.current(`Could not update the native menu: ${errMsg(error)}`);
    });
  }, [items, updateInstalled]);

  const snapshot = MENU_ACTIONS.map((entry) => ({
    id: entry.id,
    enabled: !commands[entry.id].disabled,
    checked: isCheckAction(entry) ? !!checked[entry.id] : null,
    plain: entry.text,
    text: rowTitle(entry, commands[entry.id]),
  }));
  const signature = JSON.stringify(snapshot);

  useEffect(() => {
    if (!items) return;
    const apply = async () => {
      await Promise.all(snapshot.map(async (state) => {
        const item = items.get(state.id);
        if (!item) throw new Error(`Native menu item is missing: ${state.id}`);
        const stateKey = `${state.enabled}:${state.checked ?? "-"}`;
        // The title is tracked apart, so a check or enable change costs no
        // setText; an item is installed under its plain title.
        const textKey = `${state.id}:text`;
        if ((appliedState.current.get(textKey) ?? state.plain) !== state.text) {
          await item.setText(state.text);
          appliedState.current.set(textKey, state.text);
        }
        if (appliedState.current.get(state.id) === stateKey) return;
        await item.setEnabled(state.enabled);
        if (state.checked !== null && "setChecked" in item) {
          await item.setChecked(state.checked);
        }
        appliedState.current.set(state.id, stateKey);
      }));
    };
    // Preserve render order across IPC: a slow prior update must never land
    // after a newer checked/disabled state.
    updateQueue.current = updateQueue.current.then(apply, apply).catch((error) => {
      errorRef.current(`Could not update the native menu: ${errMsg(error)}`);
    });
  // signature is the compact set of native-visible state; ordinary App
  // renders do not produce an IPC update per row. resync re-runs it after a native
  // check click whose command left app state unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, signature, resync]);
}

export function AppMenu(props: {
  actions: Command[];
  checked: CheckedState;
  onNativeError: (message: string) => void;
  onCheckForUpdates: () => void;
  /** Relabels Check for Updates… to Restart to Update. */
  updateInstalled?: boolean;
}) {
  const commands = Object.fromEntries(props.actions.map((command) => [command.id, command]));
  const desktop = isTauri();
  useNativeMenu(
    desktop,
    commands,
    props.checked,
    props.onNativeError,
    props.onCheckForUpdates,
    !!props.updateInstalled,
  );
  // After hooks: throwing earlier for a missing command would skip useNativeMenu.
  for (const entry of MENU_ACTIONS) {
    if (!commands[entry.id]) throw new Error(`Unknown menu command: ${entry.id}`);
  }
  return desktop ? null : <WebMenu commands={commands} checked={props.checked} />;
}
