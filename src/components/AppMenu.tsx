// AppMenu.tsx — one File/Edit/View menu layout, rendered as shadcn chrome in
// the browser and installed as the native application menu under Tauri.
import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type {
  CheckMenuItem, MenuItem, PredefinedMenuItem, Submenu,
} from "@tauri-apps/api/menu";
import { shortcutOf, type Command } from "@/components/CommandMenu";
import {
  Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarMenu,
  MenubarSeparator, MenubarShortcut, MenubarSub, MenubarSubContent,
  MenubarSubTrigger, MenubarTrigger,
} from "@/components/ui/menubar";

type ActionEntry = {
  kind: "action";
  id: string;
  text: string;
  check?: true;
};
type SeparatorEntry = { kind: "separator"; id: string };
type PredefinedEntry = {
  kind: "predefined";
  item: "Separator" | "Cut" | "Copy" | "Paste" | "SelectAll";
};
type SubmenuEntry = {
  kind: "submenu";
  id: string;
  text: string;
  items: MenuEntry[];
};
type MenuEntry = ActionEntry | SeparatorEntry | PredefinedEntry | SubmenuEntry;

/** The application-owned menus. This is intentionally data rather than two
 *  JSX/Rust trees: adding, removing, or moving an action changes the browser
 *  and native menus together. Exported for tests, which pin the wiring
 *  (e.g. the Edit menu's native clipboard roles) against this data. */
export const APP_MENUS: SubmenuEntry[] = [
  {
    kind: "submenu", id: "file-menu", text: "File", items: [
      { kind: "action", id: "tab-new", text: "New Tab" },
      { kind: "action", id: "project-open", text: "Open Project…" },
      { kind: "action", id: "tab-close", text: "Close Tab" },
      { kind: "separator", id: "file-new" },
      { kind: "action", id: "project-save", text: "Save Project" },
      { kind: "action", id: "project-save-as", text: "Save Project As…" },
      { kind: "separator", id: "file-master" },
      { kind: "action", id: "master-open", text: "Open Master…" },
      { kind: "action", id: "master-save", text: "Save Master" },
      { kind: "action", id: "master-save-as", text: "Save Master As…" },
      { kind: "separator", id: "file-projects" },
      {
        kind: "submenu", id: "export-menu", text: "Export", items: [
          { kind: "action", id: "export-both", text: "Export PDFs" },
          { kind: "action", id: "export-art", text: "Export Artwork PDF" },
          { kind: "action", id: "export-mask", text: "Export Mask PDF" },
          { kind: "separator", id: "export-formats" },
          { kind: "action", id: "export-psd", text: "Export PSDs" },
          { kind: "action", id: "export-psd-art", text: "Export Artwork PSD" },
          { kind: "action", id: "export-psd-mask", text: "Export Mask PSD" },
        ],
      },
    ],
  },
  {
    kind: "submenu", id: "edit-menu", text: "Edit", items: [
      { kind: "action", id: "undo", text: "Undo" },
      { kind: "action", id: "redo", text: "Redo" },
      { kind: "separator", id: "edit-variants" },
      { kind: "action", id: "variant-new", text: "New Variant" },
      { kind: "action", id: "settings", text: "Settings…" },
      { kind: "predefined", item: "Separator" },
      { kind: "predefined", item: "Cut" },
      { kind: "predefined", item: "Copy" },
      { kind: "predefined", item: "Paste" },
      { kind: "predefined", item: "SelectAll" },
    ],
  },
  {
    kind: "submenu", id: "view-menu", text: "View", items: [
      { kind: "action", id: "view-label", text: "Label", check: true },
      { kind: "action", id: "view-mask", text: "Mask", check: true },
      { kind: "action", id: "view-can", text: "Can", check: true },
      { kind: "separator", id: "view-modes" },
      { kind: "action", id: "rulers", text: "Rulers", check: true },
      { kind: "action", id: "guides", text: "Guides", check: true },
    ],
  },
];

function actionsIn(entries: MenuEntry[]): ActionEntry[] {
  return entries.flatMap((entry) => {
    if (entry.kind === "action") return [entry];
    return entry.kind === "submenu" ? actionsIn(entry.items) : [];
  });
}
const MENU_ACTIONS = actionsIn(APP_MENUS);

// Menu chrome belongs to the browser renderer only. The native renderer uses
// the same APP_MENUS data but lets the OS size and paint each item.
const MENU_TRIGGER = "px-2 py-1 text-xs font-normal";
const MENU_ITEMS =
  "min-w-52 [&_[data-slot=menubar-item]]:text-xs [&_[data-slot=menubar-sub-trigger]]:text-xs";

type CommandIndex = Record<string, Command>;
type CheckedState = Partial<Record<string, boolean>>;

function WebEntries(props: {
  entries: MenuEntry[];
  commands: CommandIndex;
  checked: CheckedState;
}) {
  return props.entries.map((entry) => {
    // Native-only edit items are omitted in the browser build: the browser
    // already owns text-edit shortcuts, while Tauri needs the corresponding OS
    // responder-chain items for those shortcuts to reach the focused field.
    if (entry.kind === "predefined") return null;
    if (entry.kind === "separator") return <MenubarSeparator key={entry.id} />;
    if (entry.kind === "submenu") {
      return (
        <MenubarSub key={entry.id}>
          <MenubarSubTrigger>{entry.text}</MenubarSubTrigger>
          <MenubarSubContent className={MENU_ITEMS}>
            <WebEntries entries={entry.items} commands={props.commands} checked={props.checked} />
          </MenubarSubContent>
        </MenubarSub>
      );
    }

    const command = props.commands[entry.id];
    const keys = shortcutOf(command);
    if (entry.check) {
      return (
        <MenubarCheckboxItem key={entry.id} checked={!!props.checked[entry.id]}
          disabled={command.disabled} onClick={command.run}>
          {entry.text}
          {keys && <MenubarShortcut>{keys}</MenubarShortcut>}
        </MenubarCheckboxItem>
      );
    }
    return (
      <MenubarItem key={entry.id} disabled={command.disabled} onClick={command.run}>
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
type NativeEntry = MenuItem | CheckMenuItem | PredefinedMenuItem | Submenu;
type NativeAction = MenuItem | CheckMenuItem;

/** Native menus must own modified accelerators so macOS can display them.
 *  Bare 1–3/R/G bindings deliberately stay in App's guarded key listener:
 *  registering those with the OS would fire them while the user is typing. */
export function nativeAccelerator(command: Command): string | undefined {
  const glyphs = shortcutOf(command);
  if (!glyphs?.includes("⌘")) return undefined;
  const key = glyphs.replace("⇧", "").replace("⌘", "");
  return `CmdOrCtrl+${glyphs.includes("⇧") ? "Shift+" : ""}${key}`;
}

async function closeResources(resources: NativeResource[]) {
  const owned = resources.splice(0).reverse();
  await Promise.allSettled(owned.map((resource) => resource.close()));
}

async function macApplicationMenu(
  api: MenuApi,
  resources: NativeResource[],
  checkForUpdates: () => void,
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
    { item: "Quit" as const },
  ];
  const items: NativeEntry[] = await Promise.all(definitions.map(async (definition) => {
    const item = await api.PredefinedMenuItem.new(definition);
    resources.push(item);
    return item;
  }));
  const updater = await api.MenuItem.new({
    id: "check-for-updates",
    text: UPDATE_ITEM_TEXT.check,
    action: checkForUpdates,
  });
  resources.push(updater);
  items.splice(1, 0, updater);
  const menu = await api.Submenu.new({ id: "application-menu", text: "Label Lab", items });
  resources.push(menu);
  return menu;
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
    });
    resources.push(item);
    return item;
  }
  if (entry.kind === "submenu") {
    const items = await Promise.all(entry.items.map((item) =>
      nativeEntry(api, item, commands, checked, run, resources)));
    const submenu = await api.Submenu.new({ id: entry.id, text: entry.text, items });
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
  const item = entry.check
    ? await api.CheckMenuItem.new({ ...options, checked: !!checked[entry.id] })
    : await api.MenuItem.new(options);
  resources.push(item);
  return item;
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

  useEffect(() => {
    if (!desktop) return;
    let live = true;
    const resources: NativeResource[] = [];

    void (async () => {
      try {
        // The menu API is desktop-only and stays out of the browser's initial
        // chunk. isTauri alone is not enough to make a static import lazy.
        const api = await import("@tauri-apps/api/menu");
        const run = (id: string) => {
          const command = commandsRef.current[id];
          if (!command || command.disabled) return;
          // Native Undo/Redo accelerators fire before the webview's keydown.
          // Keep the active field's own undo stack when the cursor is in text.
          const active = document.activeElement as HTMLElement | null;
          const editing = active?.isContentEditable || /^(INPUT|TEXTAREA)$/.test(active?.tagName ?? "");
          if (editing && (id === "undo" || id === "redo")) {
            document.execCommand(id);
            return;
          }
          command.run();
        };
        const roots = await Promise.all(APP_MENUS.map((entry) =>
          nativeEntry(api, entry, commandsRef.current, checkedRef.current, run, resources)));
        // On macOS the first submenu is the conventional application menu;
        // the browser renderer must not show it. Other desktop platforms put
        // File first and receive their window-local menu bar normally.
        if (/Macintosh|Mac OS X/.test(navigator.userAgent)) {
          roots.unshift(await macApplicationMenu(api, resources, () => updateRef.current()));
        }
        const menu = await api.Menu.new({ id: "label-lab-menu", items: roots });
        resources.push(menu);
        if (!live) {
          await closeResources(resources);
          return;
        }
        const previous = await menu.setAsAppMenu();
        if (previous) await previous.close();
        if (!live) {
          await closeResources(resources);
          return;
        }
        const actionItems = new Map<string, NativeAction>();
        for (const resource of resources) {
          if (resource instanceof api.MenuItem || resource instanceof api.CheckMenuItem) {
            actionItems.set(resource.id, resource);
          }
        }
        appliedState.current.clear();
        setItems(actionItems);
      } catch (error) {
        await closeResources(resources);
        if (live) errorRef.current(`Could not install the native menu: ${String(error)}`);
      }
    })();

    return () => {
      live = false;
      void closeResources(resources);
    };
  }, [desktop]);

  useEffect(() => {
    const item = items?.get("check-for-updates");
    if (!item) return; // non-macOS menus have no updater item
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
    checked: entry.check ? !!checked[entry.id] : null,
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
  // renders do not produce 26 IPC updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, signature]);
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
  for (const entry of MENU_ACTIONS) {
    if (!commands[entry.id]) throw new Error(`Unknown menu command: ${entry.id}`);
  }

  const desktop = isTauri();
  useNativeMenu(
    desktop,
    commands,
    props.checked,
    props.onNativeError,
    props.onCheckForUpdates,
    !!props.updateInstalled,
  );
  return desktop ? null : <WebMenu commands={commands} checked={props.checked} />;
}
