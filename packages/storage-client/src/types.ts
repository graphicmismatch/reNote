/**
 * DTO shapes mirroring the Rust command surface. This file is a thin,
 * hand-written re-export barrel; the actual type definitions are codegen
 * output from `ts-rs`, generated straight from the Rust structs in
 * `src-tauri/crates/renote-commands/src/dto.rs` into `./generated/`, so the
 * two sides can't silently drift (see the project plan's "Rust↔TS type
 * sync" testing strategy).
 *
 * To regenerate `./generated/*.ts` after a DTO shape changes on the Rust
 * side:
 * ```sh
 * cargo test -p renote-commands export_typescript_bindings
 * pnpm format   # ts-rs emits single-line type aliases; this reflows them
 * ```
 * (See the doc comment on `renote-commands/src/dto.rs` for details.)
 * `./generated/` is checked in like any other generated-but-committed
 * artifact (comparable to a lockfile) so `storage-client` builds without
 * requiring a Rust toolchain.
 */
export type { BoundsDto } from "./generated/BoundsDto.js";
export type { CreateNotebookRequestDto } from "./generated/CreateNotebookRequestDto.js";
export type { CreatePageRequestDto } from "./generated/CreatePageRequestDto.js";
export type { CreateSectionGroupRequestDto } from "./generated/CreateSectionGroupRequestDto.js";
export type { CreateSectionRequestDto } from "./generated/CreateSectionRequestDto.js";
export type { ListPagesRequestDto } from "./generated/ListPagesRequestDto.js";
export type { ListSectionsRequestDto } from "./generated/ListSectionsRequestDto.js";
export type { LoadPageObjectsRequestDto } from "./generated/LoadPageObjectsRequestDto.js";
export type { NotebookDto } from "./generated/NotebookDto.js";
export type { PageBackgroundDto } from "./generated/PageBackgroundDto.js";
export type { PageDocumentDto } from "./generated/PageDocumentDto.js";
export type { PageDto } from "./generated/PageDto.js";
export type { PageObjectDto } from "./generated/PageObjectDto.js";
export type { PageRuleLinesDto } from "./generated/PageRuleLinesDto.js";
export type { SavePageObjectsRequestDto } from "./generated/SavePageObjectsRequestDto.js";
export type { UpdatePageBackgroundRequestDto } from "./generated/UpdatePageBackgroundRequestDto.js";
export type { SearchHitDto } from "./generated/SearchHitDto.js";
export type { SearchQueryDto } from "./generated/SearchQueryDto.js";
export type { SearchResultsDto } from "./generated/SearchResultsDto.js";
export type { SectionDto } from "./generated/SectionDto.js";
export type { SectionGroupDto } from "./generated/SectionGroupDto.js";
export type { SetWorkspacePathRequestDto } from "./generated/SetWorkspacePathRequestDto.js";
export type { Transform2DDto } from "./generated/Transform2DDto.js";
export type { TagDto } from "./generated/TagDto.js";
export type { TagKindDto } from "./generated/TagKindDto.js";
export type { ListTagsRequestDto } from "./generated/ListTagsRequestDto.js";
export type { CreateTagRequestDto } from "./generated/CreateTagRequestDto.js";
export type { UpdateTagRequestDto } from "./generated/UpdateTagRequestDto.js";
export type { DeleteTagRequestDto } from "./generated/DeleteTagRequestDto.js";
export type { ListTaggedParagraphsRequestDto } from "./generated/ListTaggedParagraphsRequestDto.js";
export type { TaggedParagraphDto } from "./generated/TaggedParagraphDto.js";
export type { EmptyTrashEntryRequestDto } from "./generated/EmptyTrashEntryRequestDto.js";
export type { ExportNotebookBackupRequestDto } from "./generated/ExportNotebookBackupRequestDto.js";
export type { ImportNotebookBackupRequestDto } from "./generated/ImportNotebookBackupRequestDto.js";
export type { RestoreFromTrashRequestDto } from "./generated/RestoreFromTrashRequestDto.js";
export type { TrashEntryDto } from "./generated/TrashEntryDto.js";
export type { TrashItemKindDto } from "./generated/TrashItemKindDto.js";
export type { TrashNotebookRequestDto } from "./generated/TrashNotebookRequestDto.js";
export type { TrashPageRequestDto } from "./generated/TrashPageRequestDto.js";
export type { TrashSectionGroupRequestDto } from "./generated/TrashSectionGroupRequestDto.js";
export type { TrashSectionRequestDto } from "./generated/TrashSectionRequestDto.js";
export type { AutosaveMetaDto } from "./generated/AutosaveMetaDto.js";
export type { GetAutosaveStatusRequestDto } from "./generated/GetAutosaveStatusRequestDto.js";
export type { RestoreAutosaveRequestDto } from "./generated/RestoreAutosaveRequestDto.js";
export type { SaveAutosaveRequestDto } from "./generated/SaveAutosaveRequestDto.js";
export type { AssetRefDto } from "./generated/AssetRefDto.js";
export type { SaveImageAssetRequestDto } from "./generated/SaveImageAssetRequestDto.js";
export type { ResolveAssetPathRequestDto } from "./generated/ResolveAssetPathRequestDto.js";
export type { DeletePageAssetRequestDto } from "./generated/DeletePageAssetRequestDto.js";
export type { CopyPageAssetRequestDto } from "./generated/CopyPageAssetRequestDto.js";
export type { MovePageRequestDto } from "./generated/MovePageRequestDto.js";
export type { ReorderPagesRequestDto } from "./generated/ReorderPagesRequestDto.js";
export type { MoveSectionRequestDto } from "./generated/MoveSectionRequestDto.js";
export type { ImportPlainTextRequestDto } from "./generated/ImportPlainTextRequestDto.js";
export type { ExportPagePdfRequestDto } from "./generated/ExportPagePdfRequestDto.js";
export type { ExportSectionPdfRequestDto } from "./generated/ExportSectionPdfRequestDto.js";
export type { ExportNotebookPdfRequestDto } from "./generated/ExportNotebookPdfRequestDto.js";
export type { ExportPagePlainTextRequestDto } from "./generated/ExportPagePlainTextRequestDto.js";
export type { ExportPageMarkdownRequestDto } from "./generated/ExportPageMarkdownRequestDto.js";
export type { ExportSectionMarkdownRequestDto } from "./generated/ExportSectionMarkdownRequestDto.js";
export type { ExportNotebookMarkdownRequestDto } from "./generated/ExportNotebookMarkdownRequestDto.js";
export type { ListBacklinksRequestDto } from "./generated/ListBacklinksRequestDto.js";
export type { FindRelatedPagesRequestDto } from "./generated/FindRelatedPagesRequestDto.js";
export type { StopNativeAudioCaptureRequestDto } from "./generated/StopNativeAudioCaptureRequestDto.js";
export type { ResolveWikilinkTargetRequestDto } from "./generated/ResolveWikilinkTargetRequestDto.js";
export type { WikilinkResolutionDto } from "./generated/WikilinkResolutionDto.js";
export type { CreateLinkedPageRequestDto } from "./generated/CreateLinkedPageRequestDto.js";
export type { ListPageLinksRequestDto } from "./generated/ListPageLinksRequestDto.js";
export type { PageLinkDto } from "./generated/PageLinkDto.js";
export type { PageLocationDto } from "./generated/PageLocationDto.js";
export type { RenameNotebookRequestDto } from "./generated/RenameNotebookRequestDto.js";
export type { RenameSectionRequestDto } from "./generated/RenameSectionRequestDto.js";
export type { RenameSectionGroupRequestDto } from "./generated/RenameSectionGroupRequestDto.js";
export type { RenamePageRequestDto } from "./generated/RenamePageRequestDto.js";
export type { SetPageParentRequestDto } from "./generated/SetPageParentRequestDto.js";
