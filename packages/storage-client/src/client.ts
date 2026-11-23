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

/** Where a just-recorded audio clip goes. */
export interface SaveAudioAssetRequest {
  notebookId: string;
  sectionId: string;
  pageId: string;
  fileName: string;
}

/** The full storage surface. `apps/desktop` implements it over IndexedDB (`browser-storage-client.ts`). */
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
  exportNotebookBackup(request: ExportNotebookBackupRequestDto): Promise<Blob>;
  importNotebookBackup(request: ImportNotebookBackupRequestDto): Promise<NotebookDto>;
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
  /** Saves a recorded audio clip's bytes, resolving to its `assetPath`. */
  saveAudioAsset(request: SaveAudioAssetRequest, bytes: Uint8Array): Promise<string>;
  /** Resolves an `assetPath` to a URL an `<img>`/`PIXI.Assets.load` can load directly. */
  resolveAssetPath(request: ResolveAssetPathRequestDto): Promise<string>;
  /** Raw bytes of an audio clip, for `Blob`/`URL.createObjectURL` playback. */
  readAudioAsset(request: ResolveAssetPathRequestDto): Promise<ArrayBuffer>;
  /** Copies an asset to another page; resolves to the new `assetPath`. */
  copyPageAsset(request: CopyPageAssetRequestDto): Promise<string>;
  deletePageAsset(request: DeletePageAssetRequestDto): Promise<void>;
  /** Returns a text-box object DTO to insert via `AddObjectCommand`; writes nothing itself. */
  importPlainTextFile(request: ImportPlainTextRequestDto): Promise<PageObjectDto>;
  /** Printable HTML; the app prints it (the OS print dialog offers "Save as PDF"). */
  exportPagePdf(request: ExportPagePdfRequestDto): Promise<string>;
  exportSectionPdf(request: ExportSectionPdfRequestDto): Promise<string>;
  exportNotebookPdf(request: ExportNotebookPdfRequestDto): Promise<string>;
  exportPagePlainText(request: ExportPagePlainTextRequestDto): Promise<Blob>;
  exportPageMarkdown(request: ExportPageMarkdownRequestDto): Promise<Blob>;
  exportSectionMarkdown(request: ExportSectionMarkdownRequestDto): Promise<Blob>;
  exportNotebookMarkdown(request: ExportNotebookMarkdownRequestDto): Promise<Blob>;
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
}
