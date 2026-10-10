import { isMacOS } from "@/keys";
// AppMenu.tsx — one File/Edit/View menu layout, rendered as shadcn chrome in
// the browser and installed as the native application menu under Tauri. The
// desktop menu also carries File → Open Recent, rebuilt from src/recent.ts.
import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  CheckMenuItem, IconMenuItem, MenuItem, PredefinedMenuItem, Submenu,
} from "@tauri-apps/api/menu";
import {
  Bookmark, BookmarkPlus, BookOpen, Columns2, Contrast, Cylinder, FileImage, Files, FolderOpen,
  History, Layers, RectangleHorizontal, Redo2, Ruler, Settings, SquareArrowDown,
  SquareArrowUp, SquarePlus, Undo2, X, type LucideIcon,
} from "lucide-react";
import { shortcutOf, type Command } from "@/components/CommandMenu";
import { dialogOpen, isTypingTarget } from "@/keys";
import { clearRecent, openRecent, recentLabels, recentTitles, subscribeRecent } from "@/recent";
import {
  Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarMenu,
  MenubarSeparator, MenubarShortcut, MenubarSub, MenubarSubContent,
  MenubarSubTrigger, MenubarTrigger,
} from "@/components/ui/menubar";

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
  "ruler": Ruler,
  "rectangle.split.2x1": Columns2,
} satisfies Record<string, LucideIcon>;
type MenuSymbol = keyof typeof SYMBOL_GLYPH;

type ActionEntry = {
  kind: "action";
  id: string;
  text: string;
  /** A checkmark row: its state comes from `checked`, not the command. */
  check?: true;
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
  /** Absent on the top-level File/Edit/View titles, which carry no icon. */
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
      { kind: "action", id: "project-open", text: "Open Project…", symbol: "folder" },
      { kind: "recent", id: "recent-menu", text: "Open Recent", symbol: "clock.arrow.circlepath" },
      { kind: "action", id: "tab-close", text: "Close Tab", symbol: "xmark" },
      { kind: "separator", id: "file-new" },
      { kind: "action", id: "project-save", text: "Save Project", symbol: "square.and.arrow.down" },
      { kind: "action", id: "project-save-as", text: "Save Project As…", symbol: "doc.on.doc" },
      { kind: "separator", id: "file-master" },
      { kind: "action", id: "master-open", text: "Open Master…", symbol: "books.vertical" },
      { kind: "action", id: "master-save", text: "Save Master", symbol: "bookmark" },
      { kind: "action", id: "master-save-as", text: "Save Master As…", symbol: "doc.badge.plus" },
      { kind: "separator", id: "file-projects" },
      {
        kind: "submenu", id: "export-menu", text: "Export", symbol: "square.and.arrow.up", items: [
          { kind: "action", id: "export-both", text: "Export PDFs", symbol: "doc.on.doc" },
          { kind: "action", id: "export-art", text: "Export Artwork PDF", symbol: "photo" },
          { kind: "action", id: "export-mask", text: "Export Mask PDF", symbol: "circle.lefthalf.filled" },
          { kind: "separator", id: "export-formats" },
          { kind: "action", id: "export-psd", text: "Export PSDs", symbol: "square.3.layers.3d" },
          { kind: "action", id: "export-psd-art", text: "Export Artwork PSD", symbol: "photo" },
          { kind: "action", id: "export-psd-mask", text: "Export Mask PSD", symbol: "circle.lefthalf.filled" },
        ],
      },
    ],
  },
  {
    kind: "submenu", id: "edit-menu", text: "Edit", items: [
      { kind: "action", id: "undo", text: "Undo", symbol: "arrow.uturn.backward" },
      { kind: "action", id: "redo", text: "Redo", symbol: "arrow.uturn.forward" },
      { kind: "separator", id: "edit-variants" },
      { kind: "action", id: "settings", text: "Settings…", symbol: "gear" },
      { kind: "predefined", item: "Separator" },
      { kind: "predefined", item: "Cut" },
      { kind: "predefined", item: "Copy" },
      { kind: "predefined", item: "Paste" },
      { kind: "predefined", item: "SelectAll" },
    ],
  },
  {
    kind: "submenu", id: "view-menu", text: "View", items: [
      { kind: "action", id: "view-label", text: "Label", check: true, symbol: "rectangle" },
      { kind: "action", id: "view-mask", text: "Mask", check: true, symbol: "circle.lefthalf.filled" },
      { kind: "action", id: "view-can", text: "Can", check: true, symbol: "cylinder" },
      { kind: "separator", id: "view-modes" },
      { kind: "action", id: "rulers", text: "Rulers", check: true, symbol: "ruler" },
      { kind: "action", id: "guides", text: "Guides", check: true, symbol: "rectangle.split.2x1" },
      // Ours rather than the row AppKit inserts on first open, which arrives
      // after menu_symbols.rs has run and so would stay without its icon.
      { kind: "predefined", item: "Separator" },
      { kind: "predefined", item: "Fullscreen" },
    ],
  },
];

function isCheckAction(entry: ActionEntry): entry is CheckAction {
  return !!entry.check;
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
type CheckedState = Partial<Record<string, boolean>>;

function MenuGlyph({ name }: { name: MenuSymbol }) {
  const Icon = SYMBOL_GLYPH[name];
  return <Icon aria-hidden="true" />;
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
          {entry.text}
          {keys && <MenubarShortcut>{keys}</MenubarShortcut>}
        </MenubarCheckboxItem>
      );
    }
    return (
      <MenubarItem key={entry.id} disabled={command.disabled} onClick={command.run}>
        <MenuGlyph name={entry.symbol} />
        {entry.text}
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
 *  registering those with the OS would fire them while the user is typing. */
export function nativeAccelerator(command: Command): string | undefined {
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
 *  `quit` must run the window close flow instead. Exported for tests. */
export async function macApplicationMenu(
  api: MenuApi,
  resources: NativeResource[],
  checkForUpdates: () => void,
  quit: () => void,
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
    id: `recent-${i}`, text: titles[i],
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
        const roots = await Promise.all(APP_MENUS.map((entry) =>
          nativeEntry(api, entry, commandsRef.current, checkedRef.current, run, resources)));
        // On macOS the first submenu is the conventional application menu;
        // the browser renderer must not show it. Other desktop platforms put
        // File first and receive their window-local menu bar normally.
        if (isMacOS()) {
          // Quit closes the window like its red button, so TabsShell's
          // onCloseRequested sweep prompts for unsaved tabs before exit.
          const quit = () => void import("@tauri-apps/api/window")
            .then((m) => m.getCurrentWindow().close())
            .catch((error) => errorRef.current(`Could not quit: ${String(error)}`));
          roots.unshift(await macApplicationMenu(api, resources, () => updateRef.current(), quit));
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
          recentRowsOf.set(recent, rows);
          await recent.append(rows);
        };
        const queueRebuild = () => {
          rebuilding = rebuilding.then(rebuild).catch((error) =>
            errorRef.current(`Could not update the native menu: ${String(error)}`));
        };
        stopRecent = subscribeRecent(queueRebuild);
        if (JSON.stringify(recentLabels()) !== recentBuiltFrom) queueRebuild();
        appliedState.current.clear();
        setItems(actionItems);
      } catch (error) {
        await closeResources(resources);
        if (live) errorRef.current(`Could not install the native menu: ${String(error)}`);
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
      errorRef.current(`Could not update the native menu: ${String(error)}`);
    });
  }, [items, updateInstalled]);

  const snapshot = MENU_ACTIONS.map((entry) => ({
    id: entry.id,
    enabled: !commands[entry.id].disabled,
    checked: isCheckAction(entry) ? !!checked[entry.id] : null,
  }));
  const signature = JSON.stringify(snapshot);

  useEffect(() => {
    if (!items) return;
    const apply = async () => {
      await Promise.all(snapshot.map(async (state) => {
        const item = items.get(state.id);
        if (!item) throw new Error(`Native menu item is missing: ${state.id}`);
        const stateKey = `${state.enabled}:${state.checked ?? "-"}`;
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
      errorRef.current(`Could not update the native menu: ${String(error)}`);
    });
  // signature is the compact set of native-visible state; ordinary App
  // renders do not produce 26 IPC updates. resync re-runs it after a native
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
