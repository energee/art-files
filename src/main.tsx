// main.tsx — React entry point. ErrorBoundary is the outermost element so a
// render crash anywhere shows a recovery screen instead of a blank window.
// UncaughtErrors sits beside it (not inside, so it survives a render crash)
// and surfaces what the boundary can't see: unhandled promise rejections
// and uncaught event-handler errors (#398). Toaster is the window's one toast
// stack (messages go through src/notify.ts); it too sits outside the boundary
// so a toast can still report a failure while the recovery screen is up.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import "./index.css";
import TabsShell from "./TabsShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { UncaughtErrors } from "@/components/UncaughtErrors";
import { Toaster } from "@/components/ui/sonner";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <TabsShell />
    </ErrorBoundary>
    <UncaughtErrors />
    <Toaster />
  </StrictMode>,
);
