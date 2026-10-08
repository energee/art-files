// CommandPalette.tsx — the ⌘K palette's dialog body (cmdk). Split out of
// CommandMenu.tsx so cmdk loads on the first ⌘K, not with the editor (#410);
// CommandMenu keeps the always-on key listener and the open state.
import { shortcutOf, type Command } from "@/components/CommandMenu";
import {
  CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList, CommandShortcut,
} from "@/components/ui/command";

export function CommandPalette(props: { open: boolean; onOpenChange: (open: boolean) => void; actions: Command[] }) {
  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      <CommandInput placeholder="Type a command…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        {props.actions.map((a) => {
          const glyphs = shortcutOf(a);
          return (
            <CommandItem key={a.id} disabled={a.disabled}
              onSelect={() => { props.onOpenChange(false); a.run(); }}>
              {a.label}
              {/* CommandShortcut, not a bare ml-auto span: its data-slot is what
                  hides CommandItem's trailing check icon, whose own ml-auto
                  would otherwise split the free space and park the hint mid-row. */}
              {glyphs && <CommandShortcut>{glyphs}</CommandShortcut>}
            </CommandItem>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
