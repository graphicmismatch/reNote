import { invoke } from "@tauri-apps/api/core";
import type {
  AutosaveMetaDto,
  GetAutosaveStatusRequestDto,
  PageDto,
  RestoreAutosaveRequestDto,
  SaveAutosaveRequestDto,
} from "./types.js";

/** `null` when the page has no autosave yet. */
export function getAutosaveStatus(request: GetAutosaveStatusRequestDto): Promise<AutosaveMetaDto | null> {
  return invoke("get_autosave_status", { request });
}

export function restoreAutosave(request: RestoreAutosaveRequestDto): Promise<PageDto> {
  return invoke("restore_autosave", { request });
}

/** Overwrites the page's one autosave slot with its current live state. */
export function saveAutosave(request: SaveAutosaveRequestDto): Promise<void> {
  return invoke("save_autosave", { request });
}
