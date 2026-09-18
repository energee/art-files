// main.tsx — React entry point. ErrorBoundary is the outermost element so a
// render crash anywhere shows a recovery screen instead of a blank window.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import TabsShell from "./TabsShell";
import { ErrorBoundary } from "./ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <TabsShell />
    </ErrorBoundary>
  </StrictMode>,
);
