import {
  copyPageAsset,
  deletePageAsset,
  readAudioAsset,
  resolveAssetPath,
  saveAudioAsset,
  saveImageAsset,
  type SaveAudioAssetRequest,
} from "./asset-api.js";
import { getAutosaveStatus, restoreAutosave, saveAutosave } from "./autosave-api.js";
import { exportNotebookBackup, importNotebookBackup } from "./backup-api.js";
import {
  exportNotebookMarkdown,
  exportNotebookPdf,
  exportPageMarkdown,
  exportPagePdf,
  exportPagePlainText,
  exportSectionMarkdown,
  exportSectionPdf,
} from "./export-api.js";
import { importPlainTextFile } from "./import-api.js";
import {
  createLinkedPage,
  listBacklinks,
  listPageLinks,
  listPageLocations,
  resolveWikilinkTarget,
} from "./link-api.js";
import { createNotebook, listNotebooks, renameNotebook } from "./notebook-api.js";
import { startNativeAudioCapture, stopNativeAudioCapture } from "./native-audio-api.js";
import { findRelatedPages } from "./semantic-api.js";
import {
  createPage,
  listPages,
  loadPageDocument,
  movePage,
  renamePage,
  reorderPages,
  savePageObjects,
  setPageParent,
  updatePageBackground,
} from "./page-api.js";
import { search } from "./search-api.js";
import {
  createSection,
  createSectionGroup,
  listSectionGroups,
  listSections,
  moveSection,
  moveSectionGroup,
  renameSection,
  renameSectionGroup,
} from "./section-api.js";
import { createTag, deleteTag, listTaggedParagraphs, listTags, updateTag } from "./tag-api.js";
import {
  emptyTrash,
  emptyTrashEntry,
  listTrash,
  restoreFromTrash,
  trashNotebook,
  trashPage,
  trashSection,
  trashSectionGroup,
} from "./trash-api.js";
import { getWorkspacePath, listRecentWorkspacePaths, setWorkspacePath } from "./workspace-api.js";
import type {
  AssetRefDto,
  AutosaveMetaDto,
  CreateLinkedPageRequestDto,
  CreateNotebookRequestDto,
  CreatePageRequestDto,
  CreateSectionGroupRequestDto,
  CreateSectionRequestDto,
  CreateTagRequestDto,
  CopyPageAssetRequestDto,
  MovePageRequestDto,
  MoveSectionRequestDto,
  ReorderPagesRequestDto,
  DeletePageAssetRequestDto,
  DeleteTagRequestDto,
  EmptyTrashEntryRequestDto,
  ExportNotebookBackupRequestDto,
  ExportNotebookMarkdownRequestDto,
  ExportNotebookPdfRequestDto,
  ExportPageMarkdownRequestDto,
  ExportPagePdfRequestDto,
  ExportPagePlainTextRequestDto,
  ExportSectionMarkdownRequestDto,
  ExportSectionPdfRequestDto,
  FindRelatedPagesRequestDto,
  GetAutosaveStatusRequestDto,
  ImportNotebookBackupRequestDto,
  ImportPlainTextRequestDto,
  ListBacklinksRequestDto,
  ListPageLinksRequestDto,
  ListPagesRequestDto,
  ListSectionsRequestDto,
  ListTaggedParagraphsRequestDto,
  ListTagsRequestDto,
  LoadPageObjectsRequestDto,
  NotebookDto,
  PageDocumentDto,
  PageDto,
  PageLinkDto,
  PageLocationDto,
  PageObjectDto,
  RenameNotebookRequestDto,
  RenamePageRequestDto,
  RenameSectionGroupRequestDto,
  RenameSectionRequestDto,
  ResolveAssetPathRequestDto,
  ResolveWikilinkTargetRequestDto,
  RestoreAutosaveRequestDto,
  RestoreFromTrashRequestDto,
  SaveAutosaveRequestDto,
  SaveImageAssetRequestDto,
  SavePageObjectsRequestDto,
  SearchHitDto,
  SearchQueryDto,
  SearchResultsDto,
  SectionDto,
  SectionGroupDto,
  SetPageParentRequestDto,
  SetWorkspacePathRequestDto,
  StopNativeAudioCaptureRequestDto,
  TagDto,
  TaggedParagraphDto,
  TrashEntryDto,
  TrashNotebookRequestDto,
  TrashPageRequestDto,
  TrashSectionGroupRequestDto,
  TrashSectionRequestDto,
  UpdatePageBackgroundRequestDto,
  UpdateTagRequestDto,
  WikilinkResolutionDto,
} from "./types.js";

/**
 * The full storage surface as a single interface, so callers can depend on
 * `StorageClient` instead of importing `invoke`-backed functions directly.
 * `apps/desktop` swaps this for an in-memory fake when it isn't running
 * inside a Tauri WebView (e.g. a plain browser used for visual testing),
 * where `@tauri-apps/api`'s `invoke` has nothing to talk to.
 */
export interface StorageClient {
  listNotebooks(): Promise<NotebookDto[]>;
  createNotebook(request: CreateNotebookRequestDto): Promise<NotebookDto>;
  renameNotebook(request: RenameNotebookRequestDto): Promise<NotebookDto>;
  listSections(request: ListSectionsRequestDto): Promise<SectionDto[]>;
  listSectionGroups(request: ListSectionsRequestDto): Promise<SectionGroupDto[]>;
  createSection(request: CreateSectionRequestDto): Promise<SectionDto>;
  createSectionGroup(request: CreateSectionGroupRequestDto): Promise<SectionGroupDto>;
  renameSection(request: RenameSectionRequestDto): Promise<SectionDto>;
  renameSectionGroup(request: RenameSectionGroupRequestDto): Promise<SectionGroupDto>;
  /** Moves a section (or, below, a section group) under a different parent in the same
   *  notebook. */
  moveSection(request: MoveSectionRequestDto): Promise<SectionDto>;
  moveSectionGroup(request: MoveSectionRequestDto): Promise<SectionGroupDto>;
  listPages(request: ListPagesRequestDto): Promise<PageDto[]>;
  createPage(request: CreatePageRequestDto): Promise<PageDto>;
  loadPageDocument(request: LoadPageObjectsRequestDto): Promise<PageDocumentDto>;
  savePageObjects(request: SavePageObjectsRequestDto): Promise<PageDto>;
  updatePageBackground(request: UpdatePageBackgroundRequestDto): Promise<PageDto>;
  renamePage(request: RenamePageRequestDto): Promise<PageDto>;
  /** Sets a page's `parentPageId` (subpage indent/outdent) — `null` un-indents it. Never moves
   *  the page between sections. */
  setPageParent(request: SetPageParentRequestDto): Promise<PageDto>;
  /** Moves a page to another section, keeping its id so links into it still resolve. */
  movePage(request: MovePageRequestDto): Promise<PageDto>;
  /** Renumbers a section's pages into the given order. */
  reorderPages(request: ReorderPagesRequestDto): Promise<PageDto[]>;
  search(query: SearchQueryDto): Promise<SearchResultsDto>;
  trashNotebook(request: TrashNotebookRequestDto): Promise<TrashEntryDto>;
  trashSectionGroup(request: TrashSectionGroupRequestDto): Promise<TrashEntryDto>;
  trashSection(request: TrashSectionRequestDto): Promise<TrashEntryDto>;
  trashPage(request: TrashPageRequestDto): Promise<TrashEntryDto>;
  listTrash(): Promise<TrashEntryDto[]>;
  restoreFromTrash(request: RestoreFromTrashRequestDto): Promise<TrashEntryDto>;
  emptyTrashEntry(request: EmptyTrashEntryRequestDto): Promise<void>;
  emptyTrash(): Promise<void>;
  exportNotebookBackup(request: ExportNotebookBackupRequestDto): Promise<void>;
  importNotebookBackup(request: ImportNotebookBackupRequestDto): Promise<NotebookDto>;
  getWorkspacePath(): Promise<string | null>;
  setWorkspacePath(request: SetWorkspacePathRequestDto): Promise<void>;
  listRecentWorkspacePaths(): Promise<string[]>;
  listTags(request: ListTagsRequestDto): Promise<TagDto[]>;
  createTag(request: CreateTagRequestDto): Promise<TagDto>;
  updateTag(request: UpdateTagRequestDto): Promise<TagDto>;
  deleteTag(request: DeleteTagRequestDto): Promise<void>;
  /** Every paragraph across the notebook currently carrying the given tag (Phase 11.3 to-do
   *  rollup), most-recently-modified page first. */
  listTaggedParagraphs(request: ListTaggedParagraphsRequestDto): Promise<TaggedParagraphDto[]>;
  /** `null` when the page has no autosave yet. */
  getAutosaveStatus(request: GetAutosaveStatusRequestDto): Promise<AutosaveMetaDto | null>;
  restoreAutosave(request: RestoreAutosaveRequestDto): Promise<PageDto>;
  /** Overwrites the page's one autosave slot with its current live state. */
  saveAutosave(request: SaveAutosaveRequestDto): Promise<void>;
  saveImageAsset(request: SaveImageAssetRequestDto): Promise<AssetRefDto>;
  /** Saves a recorded audio clip's bytes, resolving to its `assetPath`. See `saveAudioAsset`'s
   *  doc comment in `asset-api.ts` for why `bytes` is a second argument rather than a DTO field. */
  saveAudioAsset(request: SaveAudioAssetRequest, bytes: Uint8Array): Promise<string>;
  /**
   * Resolves an `assetPath` to a URL directly loadable by an `<img>`/`PIXI.Assets.load` —
   * the real client returns a Tauri asset-protocol URL (via `convertFileSrc`); the fake client
   * returns a `data:` URL instead (see `fake-storage-client.ts`'s own doc comment on that
   * divergence). Either way, callers never need to know which.
   */
  resolveAssetPath(request: ResolveAssetPathRequestDto): Promise<string>;
  /** Raw bytes of an audio clip, for `Blob`/`URL.createObjectURL` playback — see `readAudioAsset`'s
   *  doc comment in `asset-api.ts` for why audio can't just use `resolveAssetPath` like images do. */
  readAudioAsset(request: ResolveAssetPathRequestDto): Promise<ArrayBuffer>;
  /** Copies an asset to another page; resolves to the new `assetPath`. */
  copyPageAsset(request: CopyPageAssetRequestDto): Promise<string>;
  deletePageAsset(request: DeletePageAssetRequestDto): Promise<void>;
  /** See `import-api.ts`'s doc comment: returns a text-box object DTO to insert via
   *  `AddObjectCommand`, does not itself write anything to storage. */
  importPlainTextFile(request: ImportPlainTextRequestDto): Promise<PageObjectDto>;
  exportPagePdf(request: ExportPagePdfRequestDto): Promise<void>;
  exportSectionPdf(request: ExportSectionPdfRequestDto): Promise<void>;
  exportNotebookPdf(request: ExportNotebookPdfRequestDto): Promise<void>;
  exportPagePlainText(request: ExportPagePlainTextRequestDto): Promise<void>;
  exportPageMarkdown(request: ExportPageMarkdownRequestDto): Promise<void>;
  exportSectionMarkdown(request: ExportSectionMarkdownRequestDto): Promise<void>;
  exportNotebookMarkdown(request: ExportNotebookMarkdownRequestDto): Promise<void>;
  /** Every page linking TO `request.pageId` ("Linked Mentions"), resolved to full `PageDto`s. */
  listBacklinks(request: ListBacklinksRequestDto): Promise<PageDto[]>;
  /** Resolves a typed `[[title` wikilink to a target page within `request.notebookId`. A page
   *  resolving to itself (a self-link) is a legitimate `found` result, never excluded. */
  resolveWikilinkTarget(request: ResolveWikilinkTargetRequestDto): Promise<WikilinkResolutionDto>;
  /** Auto-creates a new, empty page titled `request.title` — the path a `notFound` resolution
   *  from `resolveWikilinkTarget` leads to. */
  createLinkedPage(request: CreateLinkedPageRequestDto): Promise<PageDto>;
  /** Every `(source, target)` wikilink pair among pages in `request.notebookId` — feeds the graph view. */
  listPageLinks(request: ListPageLinksRequestDto): Promise<PageLinkDto[]>;
  /** Every page in the workspace with its full `Notebook > Section > Page` address — what the
   *  link autocomplete labels each suggestion with, and resolves an exact
   *  `[[!Notebook@Section$Page#Heading` path against. */
  listPageLocations(): Promise<PageLocationDto[]>;
  /** Phase 13's local semantic layer: `request.pageId`'s nearest neighbours by embedding
   *  similarity — "Related Notes" for the open page and "Find Similar". */
  findRelatedPages(request: FindRelatedPagesRequestDto): Promise<SearchHitDto[]>;
  /** Linux/BSD `MediaRecorder` fallback — see `native-audio-api.ts`'s doc comment. Not called
   *  outside a real Tauri WebView on Linux; the fake client's implementation is never exercised. */
  startNativeAudioCapture(): Promise<void>;
  stopNativeAudioCapture(request: StopNativeAudioCaptureRequestDto): Promise<string>;
}

/** The real implementation, backed by Tauri IPC. Only valid inside a Tauri WebView. */
export const tauriStorageClient: StorageClient = {
  listNotebooks,
  createNotebook,
  renameNotebook,
  listSections,
  listSectionGroups,
  createSection,
  createSectionGroup,
  renameSection,
  renameSectionGroup,
  moveSection,
  moveSectionGroup,
  listPages,
  createPage,
  loadPageDocument,
  savePageObjects,
  updatePageBackground,
  movePage,
  reorderPages,
  renamePage,
  setPageParent,
  search,
  trashNotebook,
  trashSectionGroup,
  trashSection,
  trashPage,
  listTrash,
  restoreFromTrash,
  emptyTrashEntry,
  emptyTrash,
  exportNotebookBackup,
  importNotebookBackup,
  getWorkspacePath,
  setWorkspacePath,
  listRecentWorkspacePaths,
  listTags,
  createTag,
  updateTag,
  deleteTag,
  listTaggedParagraphs,
  getAutosaveStatus,
  restoreAutosave,
  saveAutosave,
  saveImageAsset,
  saveAudioAsset,
  resolveAssetPath,
  readAudioAsset,
  copyPageAsset,
  deletePageAsset,
  importPlainTextFile,
  exportPagePdf,
  exportSectionPdf,
  exportNotebookPdf,
  exportPagePlainText,
  exportPageMarkdown,
  exportSectionMarkdown,
  exportNotebookMarkdown,
  listBacklinks,
  resolveWikilinkTarget,
  createLinkedPage,
  listPageLinks,
  listPageLocations,
  findRelatedPages,
  startNativeAudioCapture,
  stopNativeAudioCapture,
};
