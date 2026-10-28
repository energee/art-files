// ErrorBoundary.tsx — the last line before a blank window. React unmounts the
// whole tree on an uncaught render throw, which left the operator staring at
// an empty page with no hint of what happened. This catches it, shows the
// message, and offers a reload. Function components cannot catch render
// errors, so this is the one class component in the app.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Label Lab crashed while rendering", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="mx-auto mt-16 max-w-xl p-4">
        <Alert variant="destructive">
          <AlertTitle>{t("Label Lab hit an error it could not recover from")}</AlertTitle>
          <AlertDescription>
            <p className="break-words font-mono text-xs">{error.message}</p>
            <p>
              {t("Reloading opens a fresh window. Files already saved to disk are untouched; unsaved tabs are offered back after the reload (changes from the last couple of seconds may be missing).")}
            </p>
          </AlertDescription>
        </Alert>
        <Button className="mt-4" onClick={() => location.reload()}>{t("Reload Label Lab")}</Button>
      </div>
    );
  }
}
