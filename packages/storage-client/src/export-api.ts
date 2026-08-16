import { invoke } from "@tauri-apps/api/core";
import type {
  ExportNotebookMarkdownRequestDto,
  ExportNotebookPdfRequestDto,
  ExportPageMarkdownRequestDto,
  ExportPagePdfRequestDto,
  ExportPagePlainTextRequestDto,
  ExportSectionMarkdownRequestDto,
  ExportSectionPdfRequestDto,
} from "./types.js";

/**
 * Every export command below writes to `request.destPath`, an absolute path the caller already
 * obtained from a native save-file dialog (`@tauri-apps/plugin-dialog`) — same convention
 * `exportNotebookBackup` uses. None of these resolve a destination on the user's behalf.
 */
export function exportPagePdf(request: ExportPagePdfRequestDto): Promise<void> {
  return invoke("export_page_pdf", { request });
}

export function exportSectionPdf(request: ExportSectionPdfRequestDto): Promise<void> {
  return invoke("export_section_pdf", { request });
}

export function exportNotebookPdf(request: ExportNotebookPdfRequestDto): Promise<void> {
  return invoke("export_notebook_pdf", { request });
}

export function exportPagePlainText(request: ExportPagePlainTextRequestDto): Promise<void> {
  return invoke("export_page_plain_text", { request });
}

export function exportPageMarkdown(request: ExportPageMarkdownRequestDto): Promise<void> {
  return invoke("export_page_markdown", { request });
}

export function exportSectionMarkdown(request: ExportSectionMarkdownRequestDto): Promise<void> {
  return invoke("export_section_markdown", { request });
}

export function exportNotebookMarkdown(request: ExportNotebookMarkdownRequestDto): Promise<void> {
  return invoke("export_notebook_markdown", { request });
}
