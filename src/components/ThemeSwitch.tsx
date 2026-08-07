/** Appearance switcher — System / Light / Dark as a segmented icon control.
 *
 *  Built on the shared ToggleGroup so it inherits the app's pressed, hover,
 *  focus-ring and sizing treatment (the same toggleVariants the Bold and
 *  metallic toggles use) instead of restating them.
 *
 *  Owns no state: it reads and writes the preference through useTheme, so it
 *  can drop into any surface with no prop threading. */
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type Theme } from "@/theme";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const MODES = [
  { id: "system", label: "System", Icon: Monitor },
  { id: "light", label: "Light mode", Icon: Sun },
  { id: "dark", label: "Dark mode", Icon: Moon },
] satisfies { id: Theme; label: string; Icon: typeof Monitor }[];

export function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <ToggleGroup
      value={[theme]}
      // A theme is always in effect, so "nothing selected" is not a state this
      // control has: ignore the deselect click rather than clearing.
      onValueChange={(v) => { if (v[0]) setTheme(v[0] as Theme); }}
      spacing={0} aria-label="Display theme"
    >
      {MODES.map(({ id, label, Icon }) => (
        // title, not a Tooltip: the label is static text with no interactive
        // content, and aria-label already carries it for screen readers.
        <ToggleGroupItem key={id} value={id} size="sm" aria-label={label} title={label}
          className="size-6 min-w-0 p-0">
          <Icon className="size-3.5" />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
