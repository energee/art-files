// CommandMenu.tsx — ⌘K palette exposing the app's actions.
import { useEffect, useState } from "react";
import {
  CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";

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
export const shortcutOf = (c: Command) =>
  c.shortcut ?? (c.key ? `${c.mods ?? ""}${c.key.toUpperCase()}` : undefined);

export function CommandMenu(props: { actions: Command[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);
  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        {props.actions.map((a) => {
          const glyphs = shortcutOf(a);
          return (
            <CommandItem key={a.id} disabled={a.disabled}
              onSelect={() => { setOpen(false); a.run(); }}>
              {a.label}
              {glyphs && (
                <span className="ml-auto text-xs text-muted-foreground">{glyphs}</span>
              )}
            </CommandItem>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
