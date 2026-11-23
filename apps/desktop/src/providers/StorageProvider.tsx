import type { StorageClient } from "@renote/storage-client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createBrowserStorageClient } from "./browser-storage-client.js";
import { openIdbStore } from "./idb-store.js";

const StorageContext = createContext<StorageClient | null>(null);

/**
 * Supplies the app's `StorageClient`, backed by this device's IndexedDB. Renders nothing until the
 * stored workspace has loaded. Everything that needs storage calls `useStorageClient()`.
 */
export function StorageProvider({
  children,
  client: clientOverride,
}: {
  children: ReactNode;
  /** Injects a specific client (tests seed a `createBrowserStorageClient()` before rendering). */
  client?: StorageClient;
}) {
  const [client, setClient] = useState<StorageClient | null>(clientOverride ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (clientOverride) return;
    let cancelled = false;
    openIdbStore()
      .then((store) => {
        if (!cancelled) setClient(createBrowserStorageClient(store));
      })
      .catch((cause: unknown) => {
        console.error("Failed to open local storage.", cause);
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [clientOverride]);

  if (error) return <p role="alert">reNote can't open this device's storage: {error}</p>;
  if (!client) return null;
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
