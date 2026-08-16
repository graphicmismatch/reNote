import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { open as openDirectoryDialog } from "@tauri-apps/plugin-dialog";
import { WorkspacePicker } from "@renote/ui";
import { useStorageClient } from "./StorageProvider.js";

interface WorkspaceContextValue {
  /** The currently open workspace's absolute folder path. Always non-null inside the provider's
   *  `children` branch — see `WorkspaceProvider` below for the loading/none-chosen-yet branches. */
  workspacePath: string;
  /** Switches the open workspace to `path` and reloads the app. Only one workspace is open per
   *  app instance, and switching invalidates all in-memory navigation state + the mounted
   *  `PageEngine`; rather than tearing that down in place (out of scope for this phase), this
   *  persists the new path server-side then does a full `window.location.reload()`. */
  switchWorkspace: (path: string) => void;
  /** Opens the native directory-picker dialog and, if the user picks a folder, switches to it
   *  (see `switchWorkspace`). No-op if the user cancels the dialog. */
  chooseDifferentWorkspace: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/**
 * Gates the app behind "a workspace is open": on mount, reads the persisted workspace path via
 * `client.getWorkspacePath()` (see `renote-storage`'s `workspace.json`, loaded/migrated once at
 * Tauri startup — this call just reads whatever the backend already resolved). While that read
 * is in flight, renders nothing; once resolved to `null` (no workspace chosen yet), renders
 * `WorkspacePicker` instead of `children`; once resolved to a real path, renders `children`
 * normally with `useWorkspace()` available to them.
 *
 * Must be mounted inside `StorageProvider` (needs `useStorageClient()`) — see
 * `AppProviders.tsx` for the nesting order.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const client = useStorageClient();
  const [workspacePath, setWorkspacePath] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    client
      .getWorkspacePath()
      .then((path) => {
        if (!cancelled) setWorkspacePath(path);
      })
      .catch((error: unknown) => {
        console.error("Failed to load the workspace path.", error);
        if (!cancelled) setWorkspacePath(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const switchWorkspace = useCallback(
    (path: string) => {
      client
        .setWorkspacePath({ path })
        .then(() => {
          window.location.reload();
        })
        .catch((error: unknown) => {
          console.error("Failed to switch workspace.", error);
        });
    },
    [client],
  );

  const chooseDifferentWorkspace = useCallback(() => {
    openDirectoryDialog({ directory: true, multiple: false })
      .then((selected) => {
        if (!selected || Array.isArray(selected)) return; // user cancelled the dialog
        switchWorkspace(selected);
      })
      .catch((error: unknown) => {
        console.error("Failed to choose a workspace folder.", error);
      });
  }, [switchWorkspace]);

  if (workspacePath === undefined) {
    return null;
  }

  if (workspacePath === null) {
    return <WorkspacePicker onChooseFolder={chooseDifferentWorkspace} />;
  }

  return (
    <WorkspaceContext.Provider value={{ workspacePath, switchWorkspace, chooseDifferentWorkspace }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider.");
  }
  return value;
}
