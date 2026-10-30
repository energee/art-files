// ui/sonner.tsx — the shadcn Sonner Toaster (`npx shadcn add sonner`, base-nova),
// with three changes. The theme comes from useTheme() (src/theme.ts) instead of
// next-themes, which this app doesn't have. The stack sits at the bottom centre
// and shows four toasts; callers can override both. The icons take the
// semantic text colours of the rest of the UI. Mount it once (main.tsx) and
// send messages through src/notify.ts, never Sonner's toast() directly. Where
// the stack sits is set in index.css (--toast-center-x / --toast-bottom).
import type { CSSProperties } from "react";
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/theme";

const Toaster = ({ ...props }: ToasterProps) => {
  const [theme] = useTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="bottom-center"
      visibleToasts={4}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      // Inline style outranks Sonner's per-theme palette; the tokens are
      // light-dark() so they follow the theme on their own.
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          success: "[&_[data-icon]]:text-success-text",
          info: "[&_[data-icon]]:text-info-text",
          warning: "[&_[data-icon]]:text-warning-text",
          error: "[&_[data-icon]]:text-destructive-text",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
