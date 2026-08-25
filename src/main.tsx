// main.tsx — React entry point.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import TabsShell from "./TabsShell";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TabsShell />
  </StrictMode>,
);
