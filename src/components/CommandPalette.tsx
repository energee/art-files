// CommandPalette.tsx — the ⌘K palette's dialog body (cmdk). Split out of
// CommandMenu.tsx so cmdk loads on the first ⌘K, not with the editor (#410);
// CommandMenu keeps the always-on key listener and the open state.
// Rows are grouped and named exactly as the menus show them (APP_MENUS), so a
// command reads the same on every surface; commands no menu names follow
// under Other. A check row shows its state as a leading check mark, and every
// row in its group keeps that mark's space so the titles line up.
import { CheckIcon } from "lucide-react";
import { useTranslation } from "@/i18n";
import { actionsIn, APP_MENUS, localizedMenus, menuGroups, rowTitle, type CheckedState } from "@/components/AppMenu";
import { shortcutOf, type Command } from "@/components/CommandMenu";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut,
} from "@/components/ui/command";

const menuIds = new Set(APP_MENUS.flatMap((group) => actionsIn(group.items).map((row) => row.id)));

export function CommandPalette(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: Command[];
  /** Which check rows are on (the same map AppMenu gets). */
  checked?: CheckedState;
}) {
  const { t } = useTranslation();
  const groups = menuGroups(localizedMenus(t));
  const index = new Map(props.actions.map((a) => [a.id, a]));
  // cmdk matches the search against value then keywords, in order, so the
  // heading leads the value: bare "Label" or "Dark" is ambiguous, "view
  // label" and "appearance dark" are not. `check` is the row's state, or
  // false for a plain row in a group that has check rows (space, no mark).
  const item = (a: Command, heading: string, title: string, keywords: string[] = [], check?: boolean) => {
    const glyphs = shortcutOf(a);
    return (
      <CommandItem key={a.id} value={`${heading} ${title}`} keywords={keywords} disabled={a.disabled}
        onSelect={() => { props.onOpenChange(false); a.run(); }}>
        {/* A leading element, not CommandItem's own check: CommandShortcut
            hides that one on any row with a shortcut. Off rows, and plain
            rows beside check rows, keep the space so the titles line up.
            The on check is named, so a screen reader still hears the
            state the old "Hide rulers" wording carried. */}
        {check === true && <CheckIcon role="img" aria-label={t("On")} data-palette-check="on" />}
        {check === false && <CheckIcon aria-hidden="true" data-palette-check="off" className="invisible" />}
        {title}
        {/* CommandShortcut, not a bare ml-auto span: its data-slot is what
            hides CommandItem's trailing check icon, whose own ml-auto
            would otherwise split the free space and park the hint mid-row. */}
        {glyphs && <CommandShortcut>{glyphs}</CommandShortcut>}
      </CommandItem>
    );
  };
  const others = props.actions.filter((a) => !menuIds.has(a.id));
  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      <CommandInput placeholder={t("Type a command…")} />
      <CommandList>
        <CommandEmpty>{t("No results.")}</CommandEmpty>
        {groups.map((group) => {
          const gutter = group.rows.some((row) => row.check);
          const rows = group.rows.flatMap((row) => {
            const a = index.get(row.id);
            if (!a) return [];
            const check = gutter ? !!(row.check && props.checked?.[row.id]) : undefined;
            return [item(a, group.heading, rowTitle(row, a), row.keywords, check)];
          });
          return rows.length > 0 && <CommandGroup key={group.heading} heading={group.heading}>{rows}</CommandGroup>;
        })}
        {others.length > 0 && (
          <CommandGroup heading={t("Other")}>{others.map((a) => item(a, t("Other"), a.label))}</CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
