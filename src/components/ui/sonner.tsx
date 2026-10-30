// ui/sonner.tsx — the shadcn Sonner Toaster (`npx shadcn add sonner`, base-nova),
// with a few changes. The theme comes from useTheme() (src/theme.ts) instead of
// next-themes, which this app doesn't have. The stack sits at the bottom centre
// and shows six toasts, all expanded: Sonner's default folds older toasts into
// slivers behind the newest, and a persistent warning or error must stay
// readable. Callers can override all three.
//
// Why six: Sonner hides the OLDEST toast past the limit, and that is often a
// persistent one. Six is what one editor can have up at once in normal use (a
// blocked export, a render error, layer warnings, an asset load error, an export
// warning and an open warning), with Saved or Switched landing on top. The stack
// grows up from just above the preview toolbar (index.css), so no count can cover
// the toolbar; the cost of more is height. A toast with a one-line description is
// about 75 px plus a 14 px gap, so six reach about 510 px: inside the preview pane
// of the 700 px minimum window, where a seventh or eighth would run off the top.
//
// The close button's label, which Sonner words in English, goes through t(), and
// so does the region's: it is passed whole (customAriaLabel) because Sonner
// otherwise appends its hotkey to the label. The icons take the semantic text
// colours of the rest of the UI. Sonner's Alt+T hotkey (focus the toast list) is
// turned off: Option+T types "†" on macOS, so while a toast was up it stole focus
// from the text field being typed in. Mount it once (main.tsx) and send messages
// through src/notify.ts, never Sonner's toast() directly. Where the stack sits is
// set in index.css (--toast-center-x / --toast-bottom).
import type { CSSProperties } from "react";
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";

const Toaster = ({ ...props }: ToasterProps) => {
  const [theme] = useTheme();
  const { t } = useTranslation();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="bottom-center"
      visibleToasts={6}
      expand
      hotkey={[]}
      customAriaLabel={t("Notifications")}
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
        closeButtonAriaLabel: t("Close"),
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
