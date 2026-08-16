import { invoke } from "@tauri-apps/api/core";
import type { ExportNotebookBackupRequestDto, ImportNotebookBackupRequestDto, NotebookDto } from "./types.js";

export function exportNotebookBackup(request: ExportNotebookBackupRequestDto): Promise<void> {
  return invoke("export_notebook_backup", { request });
}

export function importNotebookBackup(request: ImportNotebookBackupRequestDto): Promise<NotebookDto> {
  return invoke("import_notebook_backup", { request });
}
