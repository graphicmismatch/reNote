import { invoke } from "@tauri-apps/api/core";
import type { CreateNotebookRequestDto, NotebookDto, RenameNotebookRequestDto } from "./types.js";

export function listNotebooks(): Promise<NotebookDto[]> {
  return invoke("list_notebooks");
}

export function createNotebook(request: CreateNotebookRequestDto): Promise<NotebookDto> {
  return invoke("create_notebook", { request });
}

export function renameNotebook(request: RenameNotebookRequestDto): Promise<NotebookDto> {
  return invoke("rename_notebook", { request });
}
