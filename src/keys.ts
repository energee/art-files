// keys.ts — who owns a key press before the app's shortcuts see it (#225):
// keyOwner says which focused element claims a key, and dialogOpen whether
// a modal blocks the tab behind it wherever focus is (#244). Every key
// listener that acts on the tab checks both.

/** A modal dialog (shadcn's DialogContent: Settings, the Save Master review,
 *  the unsaved-tab prompt, the updater, the command palette). It blocks the
 *  canvas behind it, so not even ⌘Z may change that canvas. */
const DIALOG = '[data-slot="dialog-content"]';

/** Any overlay or panel holding focus: a dialog, a popover, a menu, a Select
 *  (trigger or list), the inspector Sheet (role "dialog"). Every BARE key
 *  belongs to it — "g" in a Select is its typeahead, not the Guides toggle. The ⌘
 *  shortcuts still reach the app unless a MODAL dialog is open (dialogOpen):
 *  the non-modal ones edit the very layer on the canvas. */
const POPUP = [
  '[role="dialog"]', '[role="alertdialog"]', '[role="listbox"]', '[role="menu"]',
  '[role="combobox"]',
].join(",");

/** Roving-focus widgets where only the ARROWS belong to the widget (the
 *  inspector's mm/pt toggle, tabs, a radio group). Deliberately narrow: the
 *  layer list and the preview carry none of these roles, so selecting there
 *  still nudges. */
const WIDGET = [
  '[role="radiogroup"]', '[role="tablist"]', '[role="slider"]',
  '[data-slot="toggle-group"]',
].join(",");

/** A key event aimed at a text field or contenteditable: the field owns
 *  editing keys (undo, bare shortcuts, arrows, Escape) while it has focus. */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return !!el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "");
};

/** Whether a modal dialog is open at all, wherever focus is — even in a
 *  Select or popover portalled out of it, or when the key came from the
 *  native menu with no target. Every key listener that acts on the tab asks
 *  this — the ⌘ commands, ⌘K, ⌘B, undo and the arrow nudge: the dialog
 *  blocks the tab behind it (#244). App-level dialogs (the unsaved-tabs
 *  prompt, the updater) match too and block every tab, which is intended. */
export const dialogOpen = (): boolean =>
  // A closing dialog stays mounted, marked data-closed, while it animates out.
  !!document.querySelector(`${DIALOG}:not([data-closed])`);

/** Who a key aimed at `target` belongs to, narrowest claim first; null when
 *  it is the app's. */
export const keyOwner = (target: EventTarget | null): "text" | "popup" | "widget" | null => {
  if (isTypingTarget(target)) return "text";
  const el = target as HTMLElement | null;
  if (el?.closest?.(POPUP)) return "popup";
  if (el?.closest?.(WIDGET)) return "widget";
  return null;
};

/** Shared by shortcut hints and native-menu presentation. */
export const isMacOS = () => typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent);
export const shortcutLabel = (keys: string, mac = isMacOS()) => mac ? keys : keys.replaceAll("⇧⌘", "Ctrl+Shift+").replaceAll("⌘", "Ctrl+").replaceAll("⇧", "Shift+").replaceAll("⌥", "Alt+");
