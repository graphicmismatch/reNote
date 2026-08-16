import { invoke } from "@tauri-apps/api/core";
import type { SetWorkspacePathRequestDto } from "./types.js";

export function getWorkspacePath(): Promise<string | null> {
  return invoke("get_workspace_path");
}

export function setWorkspacePath(request: SetWorkspacePathRequestDto): Promise<void> {
  return invoke("set_workspace_path", { request });
}

export function listRecentWorkspacePaths(): Promise<string[]> {
  return invoke("list_recent_workspace_paths");
}
