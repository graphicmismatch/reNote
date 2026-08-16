import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./app-shell/AppShell.js";
import { AppProviders } from "./providers/AppProviders.js";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element.");
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <AppShell />
    </AppProviders>
  </StrictMode>,
);
