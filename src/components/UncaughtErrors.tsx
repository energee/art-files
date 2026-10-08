// UncaughtErrors.tsx — the async counterpart to ErrorBoundary (#398). The
// boundary only catches render throws; a rejected promise nobody awaited
// (a save, export or open that failed outside its own try/catch) or a throw
// in an event handler used to vanish into the console. This listens for
// both on window, logs them, and shows the latest one in a dismissible
// alert pinned to the bottom of the window. The app keeps running: unlike a
// render crash, the tree is intact, so no reload is offered.
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { isAbort } from "@/filePickers";
import { errMsg } from "@/lib/utils";

/** Chromium/WebKit report this when an observer's callback resizes what it
 *  observes; the next frame delivers it. Noise, not a failure. */
const RESIZE_OBSERVER_NOTICE = /^ResizeObserver loop/;

export function UncaughtErrors() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      // A cancelled file picker rejects with AbortError; that is the operator
      // saying no, not a failure.
      if (isAbort(e.reason)) return;
      console.error("Label Lab: unhandled promise rejection", e.reason);
      setMessage(errMsg(e.reason));
    };
    const onError = (e: ErrorEvent) => {
      if (RESIZE_OBSERVER_NOTICE.test(e.message)) return;
      const reason = e.error ?? e.message;
      console.error("Label Lab: uncaught error", reason);
      setMessage(errMsg(reason));
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  if (message === null) return null;
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto w-full max-w-xl px-4">
      <Alert variant="destructive" className="shadow-lg">
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription>
          <p className="break-words font-mono text-xs">{message}</p>
          <p>
            The last action may not have finished. Your open tabs are intact;
            check the result before relying on it.
          </p>
          <Button size="sm" variant="outline" className="mt-1" onClick={() => setMessage(null)}>
            Dismiss
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
