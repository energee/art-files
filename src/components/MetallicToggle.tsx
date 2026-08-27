// MetallicToggle.tsx — the shared metallic-plate toggle: the metal-horns
// icon (Ted's pick, hand-metal-stroke-rounded, inlined since it isn't in
// lucide) on a shadcn Toggle with a "Metallic" tooltip. Used by both the
// layer rows and the inspector's Ink group, so the two surfaces cannot
// drift in behavior or accessibility.
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function HandMetal(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={props.className} aria-hidden="true">
      <path d="M18.5 11.5V5.75C18.5 4.7835 19.2835 4 20.25 4C21.2165 4 22 4.7835 22 5.75V12.8806C22 14.851 22 15.8362 21.803 16.649C21.1855 19.1965 19.1965 21.1855 16.649 21.803C15.8362 22 14.851 22 12.8806 22C11.7766 22 11.2246 22 10.7086 21.9227C9.11179 21.6833 7.64679 20.8993 6.56186 19.7034C6.21132 19.317 5.90513 18.8577 5.29275 17.9391L2.32229 13.4834C2.11214 13.1682 2 12.7978 2 12.419C2 11.3592 2.85916 10.5 3.91898 10.5H4.05489C4.65476 10.5 5.22468 10.7621 5.61507 11.2176L6.69842 12.4815C7.04487 12.8857 7.2181 13.0878 7.36248 13.1291C7.57238 13.1891 7.79697 13.1061 7.91726 12.9239C8 12.7985 8 12.5324 8 12" />
      <path d="M18.5 10.5V9.75C18.5 8.7835 17.7165 8 16.75 8C15.7835 8 15 8.7835 15 9.75V10.5" />
      <path d="M15 11.5V8.75C15 7.7835 14.2165 7 13.25 7C12.2835 7 11.5 7.7835 11.5 8.75V11" />
      <path d="M11.5 10V3.75C11.5 2.7835 10.7165 2 9.75 2C8.7835 2 8 2.7835 8 3.75V12" />
    </svg>
  );
}

export function MetallicToggle(props: {
  pressed: boolean;
  onPressedChange: (on: boolean) => void;
  /** Prefixes the accessible name, e.g. "Beer Name: metallic". */
  label?: string;
  className?: string;
  /** The layers panel disables this for a row that isn't drawing right now
   *  (master-disabled, or its variant is off) — nothing to restyle. */
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            size="sm"
            pressed={props.pressed}
            onPressedChange={props.onPressedChange}
            disabled={props.disabled}
            aria-label={props.label ? `${props.label}: metallic` : "Metallic"}
            className={cn(
              "size-5 min-w-0 shrink-0 rounded-sm p-0",
              !props.pressed && "opacity-40 hover:opacity-100",
              props.className,
            )}
          >
            <HandMetal className="size-3.5" />
          </Toggle>
        }
      />
      <TooltipContent>Metallic</TooltipContent>
    </Tooltip>
  );
}
