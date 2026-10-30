// ui/sonner.tsx — the app's one Sonner toaster. shadcn's stock wrapper reads
// its theme from next-themes, which this app doesn't have, so the theme comes
// from useTheme() (src/theme.ts) and the colours from the same CSS tokens as
// the rest of the UI. Mount it once (main.tsx) and send messages through
// src/notify.ts, never Sonner's toast() directly. Where it sits is set in
// index.css (--toast-center-x / --toast-bottom).
import type { CSSProperties } from "react";
import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/theme";

export function Toaster() {
  const [theme] = useTheme();
  return (
    <Sonner
      theme={theme}
      position="bottom-center"
      visibleToasts={4}
      // Inline style outranks Sonner's per-theme palette; the tokens are
      // light-dark() so they follow the theme on their own.
      style={{
        "--normal-bg": "var(--popover)",
        "--normal-text": "var(--popover-foreground)",
        "--normal-border": "var(--border)",
        "--border-radius": "var(--radius)",
      } as CSSProperties}
      toastOptions={{
        classNames: {
          success: "[&_[data-icon]]:text-success-text",
          info: "[&_[data-icon]]:text-info-text",
          warning: "[&_[data-icon]]:text-warning-text",
          error: "[&_[data-icon]]:text-destructive-text",
        },
      }}
    />
  );
}
