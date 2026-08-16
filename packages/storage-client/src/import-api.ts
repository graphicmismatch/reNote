import { invoke } from "@tauri-apps/api/core";
import type { ImportPlainTextRequestDto, PageObjectDto } from "./types.js";

/**
 * Imports a plain-text file's content as a new text-box object DTO. Does not itself insert
 * anything into the page or write to storage — the caller commits the returned object through
 * the canvas engine's `AddObjectCommand` (undo-stack-aware), the same "backend hands back a
 * payload, frontend owns the insert" split `saveImageAsset` + `createImageObject` already use
 * for images. See `AppShell.tsx`'s import handler.
 */
export function importPlainTextFile(request: ImportPlainTextRequestDto): Promise<PageObjectDto> {
  return invoke("import_plain_text_file", { request });
}
