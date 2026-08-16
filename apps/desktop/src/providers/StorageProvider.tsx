import { isTauri } from "@tauri-apps/api/core";
import { tauriStorageClient, type StorageClient } from "@renote/storage-client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createFakeStorageClient } from "./fake-storage-client.js";

const StorageContext = createContext<StorageClient | null>(null);

/**
 * Supplies the app's `StorageClient` — the real Tauri-IPC-backed one inside
 * the packaged app, or an in-memory fake anywhere else (plain browser dev,
 * the `run-desktop` headless-Chrome verification skill). Everything that
 * needs storage should call `useStorageClient()`, never import
 * `@tauri-apps/api` or `tauriStorageClient` directly — that's what keeps
 * the app's navigation/editor code drivable outside a Tauri WebView.
 */
export function StorageProvider({
  children,
  client: clientOverride,
}: {
  children: ReactNode;
  /**
   * Injects a specific `StorageClient` instead of the usual real-or-fake auto-selection —
   * used by component tests (e.g. `GraphView.test.tsx`) that need to seed known notebook/
   * section/page data into a `createFakeStorageClient()` instance BEFORE rendering, which
   * the normal `useMemo`-constructed-internally client makes impossible to reach from outside.
   * Never set outside tests.
   */
  client?: StorageClient;
}) {
  const client = useMemo(
    () => clientOverride ?? (isTauri() ? tauriStorageClient : createFakeStorageClient()),
    [clientOverride],
  );
  (window as unknown as { __renoteDebugStorage?: StorageClient }).__renoteDebugStorage = client;
  return <StorageContext.Provider value={client}>{children}</StorageContext.Provider>;
}

export function useStorageClient(): StorageClient {
  const client = useContext(StorageContext);
  if (!client) {
    throw new Error("useStorageClient must be used within a StorageProvider.");
  }
  return client;
}
