// CommandMenu.tsx — ⌘K palette exposing the app's actions. This module stays
// small and eager (the Command type, shortcutOf, the ⌘K listener); the
// palette itself, and cmdk with it, loads on the first ⌘K (#410).
import { Suspense, lazy, useEffect, useState, type ComponentType } from "react";
import { dialogOpen, isMacOS, shortcutLabel } from "@/keys";
import { DialogLoadFailed, DialogLoading } from "@/components/LazyDialog";

// A palette chunk that fails to load says so in a dialog ⌘K or Escape closes,
// instead of unmounting the editor (see App's CanView).
type CommandPaletteProps = Parameters<typeof import("@/components/CommandPalette").CommandPalette>[0];
const CommandPalette = lazy<ComponentType<CommandPaletteProps>>(() => import("@/components/CommandPalette").then(
  (m) => ({ default: m.CommandPalette }),
  (err: unknown) => ({
    default: ({ open, onOpenChange }: CommandPaletteProps) => (
      <DialogLoadFailed title="Commands" what="The command palette" err={err} open={open} onOpenChange={onOpenChange} />
    ),
  })));

/** One entry in the app's command table (see App's `commands`). `key` is the
 *  bare key that fires it, `shortcut` the glyphs shown to the user — separate
 *  fields because ⌘Z is displayed here but handled by its own listener. */
export interface Command {
  /** Stable lookup key. A label can change with state (Show/Hide guides),
   *  so surfaces address a command by id, never by what it reads. */
  id: string;
  label: string;
  run: () => void;
  disabled?: boolean;
  key?: string;
  /** Modifiers `key` needs. Omitted = a bare key (Figma style). */
  mods?: "⌘" | "⇧⌘";
  /** Display-only override, for a shortcut this table does not dispatch
   *  (undo/redo have their own listener). Anything with a `key` derives its
   *  glyphs from the binding instead — see shortcutOf. */
  shortcut?: string;
}

/** The glyphs to show for a command, derived from the key it actually fires
 *  on so the two cannot drift. */
export const shortcutOf = (c: Command, mac = isMacOS()) => {
  const keys = c.shortcut ?? (c.key ? `${c.mods ?? ""}${c.key.toUpperCase()}` : undefined);
  return keys ? (mac ? keys : shortcutLabel(keys, false)) : undefined;
};

export function CommandMenu(props: { actions: Command[] }) {
  // null until the first ⌘K, so the palette chunk is not fetched before it is
  // wanted; after that it stays mounted so closing can animate out.
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        // Toggle, but never open while a modal dialog is open (#237, #244);
        // with the palette itself open, ⌘K closes it. Read the DOM now, at
        // the key press — a state updater may run later, during render.
        // A blocked first ⌘K leaves the palette unloaded (null).
        const blocked = dialogOpen();
        setOpen((o) => (o === null && blocked ? null : !o && !blocked));
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);
  return open === null ? null : (
    <Suspense fallback={open ? <DialogLoading /> : null}>
      <CommandPalette open={open} onOpenChange={setOpen} actions={props.actions} />
    </Suspense>
  );
}
