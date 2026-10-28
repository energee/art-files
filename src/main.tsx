// main.tsx — React entry point. ErrorBoundary is the outermost element so a
// render crash anywhere shows a recovery screen instead of a blank window.
// UncaughtErrors sits beside it (not inside, so it survives a render crash)
// and surfaces what the boundary can't see: unhandled promise rejections
// and uncaught event-handler errors (#398).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import "./index.css";
import TabsShell from "./TabsShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { UncaughtErrors } from "@/components/UncaughtErrors";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <TabsShell />
    </ErrorBoundary>
    <UncaughtErrors />
  </StrictMode>,
);
