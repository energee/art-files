// UncaughtErrors.tsx — the async counterpart to ErrorBoundary (#398). The
// boundary only catches render throws; a rejected promise nobody awaited
// (a save, export or open that failed outside its own try/catch) or a throw
// in an event handler used to vanish into the console. This listens for
// both on window, logs them, and reports the latest one as an error toast
// that stays until dismissed (src/notify.ts; one id, so a newer failure
// replaces the older one). It renders nothing itself. The app keeps running:
// unlike a render crash, the tree is intact, so no reload is offered.
import { useEffect } from "react";
import { isAbort } from "@/filePickers";
import { errMsg } from "@/lib/utils";
import { t } from "@/i18n";
import { notify } from "@/notify";

/** Chromium/WebKit report this when an observer's callback resizes what it
 *  observes; the next frame delivers it. Noise, not a failure. */
const RESIZE_OBSERVER_NOTICE = /^ResizeObserver loop/;

const UNCAUGHT_TOAST = "uncaught-error";

/** The reason, then (on its own line; see index.css) what to do about it. An
 *  empty reason is left out: its line would show as a blank one. */
function report(reason: unknown) {
  const advice = t("The last action may not have finished. Your open tabs are intact; check the result before relying on it.");
  const message = errMsg(reason).trim();
  notify.error(t("Something went wrong"), { id: UNCAUGHT_TOAST, description: message ? `${message}\n${advice}` : advice });
}

export function UncaughtErrors() {
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      // A cancelled file picker rejects with AbortError; that is the operator
      // saying no, not a failure.
      if (isAbort(e.reason)) return;
      console.error("Label Lab: unhandled promise rejection", e.reason);
      report(e.reason);
    };
    const onError = (e: ErrorEvent) => {
      if (RESIZE_OBSERVER_NOTICE.test(e.message)) return;
      const reason = e.error ?? e.message;
      console.error("Label Lab: uncaught error", reason);
      report(reason);
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return null;
}
