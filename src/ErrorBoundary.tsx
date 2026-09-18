// ErrorBoundary.tsx — the last line before a blank window. A render throw
// anywhere under TabsShell used to unmount the whole editor (React's default),
// taking the operator's unsaved work with it. This catches it, keeps the
// document alive in memory, and offers a reload. Function components cannot
// catch render errors, so this is the one class component in the app.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

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
      <div role="alert" className="mx-auto mt-16 max-w-xl p-4">
        <Alert variant="destructive">
          <AlertTitle>Label Lab hit an error it could not recover from</AlertTitle>
          <AlertDescription>
            <p className="break-words font-mono text-xs">{error.message}</p>
            <p>
              Reloading restores the last saved state of each tab. Unsaved
              edits since then are lost.
            </p>
          </AlertDescription>
        </Alert>
        <Button className="mt-4" onClick={() => location.reload()}>Reload Label Lab</Button>
      </div>
    );
  }
}
