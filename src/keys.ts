// keys.ts — who owns a key press before the app's shortcuts see it (#225):
// one classifier, so each shortcut handler states only its own rule.

/** A modal dialog (shadcn's DialogContent: Settings, the Save Master review,
 *  the unsaved-tab prompt, the updater, the command palette). It blocks the
 *  canvas behind it, so not even ⌘Z may change that canvas. */
const DIALOG = '[data-slot="dialog-content"]';

/** Any overlay or panel holding focus: a dialog, a popover, a menu, a Select
 *  (trigger or list), the inspector Sheet (role "dialog"). Every BARE key
 *  belongs to it — "g" in a Select is its typeahead, not Show guides — but
 *  the ⌘ shortcuts, undo included, still reach the app: most of these are
 *  non-modal and edit the very layer on the canvas. */
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

/** Whether `target` sits inside a modal dialog — even in a text field there,
 *  which keyOwner reports as "text". */
export const inDialog = (target: EventTarget | null): boolean =>
  !!(target as HTMLElement | null)?.closest?.(DIALOG);

/** Whether a modal dialog is open at all, wherever focus is — even in a
 *  Select or popover portalled out of it, or when the key came from the
 *  native menu with no target. The ⌘ file and edit commands ask this: the
 *  dialog blocks the whole tab behind it (#244). Hidden tabs keep their
 *  dialogs closed, so only the front tab's can match. */
export const dialogOpen = (): boolean =>
  // A closing dialog stays mounted, marked data-closed, while it animates out.
  !!document.querySelector(`${DIALOG}:not([data-closed])`);

/** Who a key aimed at `target` belongs to, narrowest claim first; null when
 *  it is the app's. */
export const keyOwner = (target: EventTarget | null): "text" | "dialog" | "popup" | "widget" | null => {
  if (isTypingTarget(target)) return "text";
  const el = target as HTMLElement | null;
  if (inDialog(target)) return "dialog";
  if (el?.closest?.(POPUP)) return "popup";
  if (el?.closest?.(WIDGET)) return "widget";
  return null;
};
