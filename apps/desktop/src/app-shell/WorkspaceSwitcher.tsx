import { useCallback, useEffect, useRef, useState } from "react";
import { PixelButton } from "@renote/ui";
import { useStorageClient } from "../providers/StorageProvider.js";
import { useWorkspace } from "../providers/WorkspaceProvider.js";

/** Last path segment, for display — `workspacePath`/recent paths are always absolute
 *  filesystem paths, and the title bar only has room for the folder name. */
function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const lastSlash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

/**
 * Title-bar control showing the current workspace's folder name; opens a small panel with the
 * full path, a "Choose Different Workspace..." button, and a clickable list of recently used
 * workspaces. Lives in `AppShell.tsx`'s `.renote-title-bar-actions` group, next to Settings.
 *
 * Only one workspace is open per app instance, so both switch paths (picking a new folder or
 * clicking a recent one) go through `useWorkspace().switchWorkspace`, which reloads the app —
 * see that hook's doc comment for why in-place teardown is out of scope here.
 */
export function WorkspaceSwitcher() {
  const client = useStorageClient();
  const { workspacePath, switchWorkspace, chooseDifferentWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    client
      .listRecentWorkspacePaths()
      .then((paths) => {
        if (!cancelled) setRecentPaths(paths);
      })
      .catch((error: unknown) => {
        console.error("Failed to list recent workspaces.", error);
      });
    return () => {
      cancelled = true;
    };
  }, [open, client]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleToggle = useCallback(() => setOpen((wasOpen) => !wasOpen), []);

  return (
    <div className="renote-workspace-switcher" ref={containerRef}>
      <PixelButton type="button" onClick={handleToggle}>
        {basename(workspacePath)}
      </PixelButton>
      {open && (
        <div className="renote-workspace-switcher-panel">
          <div className="renote-workspace-switcher-current-path">{workspacePath}</div>
          <PixelButton type="button" onClick={chooseDifferentWorkspace}>
            Choose Different Workspace...
          </PixelButton>
          {recentPaths.length > 0 && (
            <div className="renote-workspace-switcher-recent">
              <span className="renote-workspace-switcher-recent-title">Recent</span>
              <ul className="renote-workspace-switcher-recent-list">
                {recentPaths.map((path) => (
                  <li key={path}>
                    <button
                      type="button"
                      className="renote-workspace-switcher-recent-item"
                      onClick={() => switchWorkspace(path)}
                      disabled={path === workspacePath}
                    >
                      {basename(path)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
