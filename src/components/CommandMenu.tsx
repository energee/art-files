// CommandMenu.tsx — ⌘K palette exposing the app's actions.
import { useEffect, useState } from "react";
import {
  CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";

export function CommandMenu(props: {
  actions: { label: string; run: () => void; disabled?: boolean }[];
}) {
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
        {props.actions.map((a) => (
          <CommandItem key={a.label} disabled={a.disabled}
            onSelect={() => { setOpen(false); a.run(); }}>
            {a.label}
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
