import { invoke } from "@tauri-apps/api/core";
import type {
  EmptyTrashEntryRequestDto,
  RestoreFromTrashRequestDto,
  TrashEntryDto,
  TrashNotebookRequestDto,
  TrashPageRequestDto,
  TrashSectionGroupRequestDto,
  TrashSectionRequestDto,
} from "./types.js";

export function trashNotebook(request: TrashNotebookRequestDto): Promise<TrashEntryDto> {
  return invoke("trash_notebook", { request });
}

export function trashSectionGroup(request: TrashSectionGroupRequestDto): Promise<TrashEntryDto> {
  return invoke("trash_section_group", { request });
}

export function trashSection(request: TrashSectionRequestDto): Promise<TrashEntryDto> {
  return invoke("trash_section", { request });
}

export function trashPage(request: TrashPageRequestDto): Promise<TrashEntryDto> {
  return invoke("trash_page", { request });
}

export function listTrash(): Promise<TrashEntryDto[]> {
  return invoke("list_trash");
}

export function restoreFromTrash(request: RestoreFromTrashRequestDto): Promise<TrashEntryDto> {
  return invoke("restore_from_trash", { request });
}

export function emptyTrashEntry(request: EmptyTrashEntryRequestDto): Promise<void> {
  return invoke("empty_trash_entry", { request });
}

export function emptyTrash(): Promise<void> {
  return invoke("empty_trash");
}
