import type { ReactNode } from "react";
import { ThemeProvider } from "@renote/ui";
import { StorageProvider } from "./StorageProvider.js";
import { SettingsProvider, useSettings } from "./SettingsProvider.js";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <PersistedThemeProvider>
        <StorageProvider>{children}</StorageProvider>
      </PersistedThemeProvider>
    </SettingsProvider>
  );
}

/** `ThemeProvider` seeded with the mode the user left the app in. It has to sit inside
 *  `SettingsProvider` (that's where the persisted mode is read from) but still outside everything
 *  that renders chrome. */
function PersistedThemeProvider({ children }: { children: ReactNode }) {
  const { themeMode } = useSettings();
  return <ThemeProvider defaultMode={themeMode}>{children}</ThemeProvider>;
}
