//! Request/response DTOs for this crate's Tauri commands.
//!
//! These are the single source of truth for `packages/storage-client`'s
//! TypeScript types (see the project plan's "Rust↔TS type sync" testing
//! strategy): every type here derives `ts_rs::TS` with `#[ts(export)]`, and
//! `cargo test -p renote-commands` (specifically the `export_typescript_bindings`
//! test at the bottom of this file) writes one `.ts` file per type into
//! `packages/storage-client/src/generated/`. `packages/storage-client/src/types.ts`
//! then just re-exports from that generated folder — nothing there is
//! hand-maintained.
//!
//! To regenerate after changing a DTO shape:
//! ```sh
//! cargo test -p renote-commands export_typescript_bindings
//! pnpm format   # ts-rs emits single-line type aliases; this reflows them
//! ```
//!
//! These DTOs deliberately mirror `renote-storage`'s model structs and
//! `packages/core`'s TS domain model field-for-field (see e.g.
//! `renote_storage::model::Notebook` / `packages/core/src/model/notebook.ts`),
//! but are separate types: `renote-storage` itself stays free of any
//! `tauri`/`ts-rs` dependency, and the command layer is the one place
//! allowed to shape a wire contract independently of storage's internal
//! representation (e.g. `PageObjectId`/`NotebookId` etc. are branded types
//! on the TS `@renote/core` side; at the DTO boundary they're plain
//! strings, matching how they're actually transmitted over Tauri's `invoke`
//! bridge as JSON).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

const BINDINGS_DIR: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/../../../packages/storage-client/src/generated/");

// ---------------------------------------------------------------------
// Shared value types
// ---------------------------------------------------------------------

/// Mirrors `renote_storage::PageRuleLines` / `packages/core/src/model/page.ts`'s
/// `PageRuleLines` union.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "kebab-case")]
pub enum PageRuleLinesDto {
    None,
    CollegeRuled,
    WideRuled,
    Graph,
    Dotted,
}

impl From<renote_storage::PageRuleLines> for PageRuleLinesDto {
    fn from(value: renote_storage::PageRuleLines) -> Self {
        match value {
            renote_storage::PageRuleLines::None => Self::None,
            renote_storage::PageRuleLines::CollegeRuled => Self::CollegeRuled,
            renote_storage::PageRuleLines::WideRuled => Self::WideRuled,
            renote_storage::PageRuleLines::Graph => Self::Graph,
            renote_storage::PageRuleLines::Dotted => Self::Dotted,
        }
    }
}

impl From<PageRuleLinesDto> for renote_storage::PageRuleLines {
    fn from(value: PageRuleLinesDto) -> Self {
        match value {
            PageRuleLinesDto::None => Self::None,
            PageRuleLinesDto::CollegeRuled => Self::CollegeRuled,
            PageRuleLinesDto::WideRuled => Self::WideRuled,
            PageRuleLinesDto::Graph => Self::Graph,
            PageRuleLinesDto::Dotted => Self::Dotted,
        }
    }
}

/// Mirrors `renote_storage::PageBackground` / `packages/core/src/model/page.ts`'s
/// `PageBackground`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct PageBackgroundDto {
    pub color: Option<String>,
    pub rule_lines: PageRuleLinesDto,
}

impl From<renote_storage::PageBackground> for PageBackgroundDto {
    fn from(value: renote_storage::PageBackground) -> Self {
        Self { color: value.color, rule_lines: value.rule_lines.into() }
    }
}

impl From<PageBackgroundDto> for renote_storage::PageBackground {
    fn from(value: PageBackgroundDto) -> Self {
        Self { color: value.color, rule_lines: value.rule_lines.into() }
    }
}

/// Mirrors `renote_storage::Transform2D` / `packages/core/src/page-object/transform.ts`'s
/// `Transform2D`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct Transform2DDto {
    pub x: f64,
    pub y: f64,
    pub rotation: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub z_index: f64,
}

impl From<renote_storage::Transform2D> for Transform2DDto {
    fn from(t: renote_storage::Transform2D) -> Self {
        Self {
            x: t.x,
            y: t.y,
            rotation: t.rotation,
            scale_x: t.scale_x,
            scale_y: t.scale_y,
            z_index: t.z_index,
        }
    }
}

impl From<Transform2DDto> for renote_storage::Transform2D {
    fn from(t: Transform2DDto) -> Self {
        Self {
            x: t.x,
            y: t.y,
            rotation: t.rotation,
            scale_x: t.scale_x,
            scale_y: t.scale_y,
            z_index: t.z_index,
        }
    }
}

/// Mirrors `renote_storage::Bounds` / `packages/core/src/page-object/transform.ts`'s
/// `Bounds`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct BoundsDto {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl From<renote_storage::Bounds> for BoundsDto {
    fn from(b: renote_storage::Bounds) -> Self {
        Self { x: b.x, y: b.y, width: b.width, height: b.height }
    }
}

impl From<BoundsDto> for renote_storage::Bounds {
    fn from(b: BoundsDto) -> Self {
        Self { x: b.x, y: b.y, width: b.width, height: b.height }
    }
}

/// Mirrors `renote_storage::PageObjectEnvelope` / `packages/core/src/page-object/envelope.ts`'s
/// `PageObject`. `data` stays an opaque JSON value on the Rust side (see
/// `renote_storage::model` doc comment for why); it's exported to
/// TypeScript as `unknown` (via `#[ts(type = "unknown")]`, overriding
/// ts-rs's default `serde_json::Value` mapping, which would otherwise
/// export its own standalone `JsonValue` type into a stray `bindings/`
/// folder under this crate rather than into `generated/` alongside
/// everything else) — callers narrow it per `type` the same way the
/// not-yet-built canvas-engine object-type registry will.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct PageObjectDto {
    pub id: String,
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub r#type: String,
    pub transform: Transform2DDto,
    pub bounds: BoundsDto,
    #[ts(type = "unknown")]
    pub data: serde_json::Value,
}

impl From<renote_storage::PageObjectEnvelope> for PageObjectDto {
    fn from(o: renote_storage::PageObjectEnvelope) -> Self {
        Self {
            id: o.id,
            r#type: o.r#type,
            transform: o.transform.into(),
            bounds: o.bounds.into(),
            data: o.data,
        }
    }
}

impl From<PageObjectDto> for renote_storage::PageObjectEnvelope {
    fn from(o: PageObjectDto) -> Self {
        Self {
            id: o.id,
            r#type: o.r#type,
            transform: o.transform.into(),
            bounds: o.bounds.into(),
            data: o.data,
        }
    }
}

// ---------------------------------------------------------------------
// Notebook commands
// ---------------------------------------------------------------------

/// Mirrors `renote_storage::Notebook` / `packages/core/src/model/notebook.ts`'s
/// `Notebook`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct NotebookDto {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color: Option<String>,
    pub created_at: String,
    pub modified_at: String,
}

impl From<renote_storage::Notebook> for NotebookDto {
    fn from(n: renote_storage::Notebook) -> Self {
        Self {
            id: n.id,
            name: n.name,
            path: n.path,
            color: n.color,
            created_at: n.created_at,
            modified_at: n.modified_at,
        }
    }
}

/// Request for the `create_notebook` command. `parent_directory` is an
/// optional absolute-path override; when omitted, the command falls back
/// to the app's default library root (see `crate::library`).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct CreateNotebookRequestDto {
    pub name: String,
    pub color: Option<String>,
    pub parent_directory: Option<String>,
}

// ---------------------------------------------------------------------
// Section / section-group commands
// ---------------------------------------------------------------------

/// Mirrors `renote_storage::SectionGroup` / `packages/core/src/model/section.ts`'s
/// `SectionGroup`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct SectionGroupDto {
    pub id: String,
    pub notebook_id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub order_key: String,
}

impl From<renote_storage::SectionGroup> for SectionGroupDto {
    fn from(g: renote_storage::SectionGroup) -> Self {
        Self {
            id: g.id,
            notebook_id: g.notebook_id,
            parent_id: g.parent_id,
            name: g.name,
            order_key: g.order_key,
        }
    }
}

/// Mirrors `renote_storage::Section` / `packages/core/src/model/section.ts`'s `Section`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct SectionDto {
    pub id: String,
    pub notebook_id: String,
    pub parent_group_id: Option<String>,
    pub name: String,
    pub color: Option<String>,
    pub order_key: String,
}

impl From<renote_storage::Section> for SectionDto {
    fn from(s: renote_storage::Section) -> Self {
        Self {
            id: s.id,
            notebook_id: s.notebook_id,
            parent_group_id: s.parent_group_id,
            name: s.name,
            color: s.color,
            order_key: s.order_key,
        }
    }
}

/// Request for `list_sections`/`list_section_groups`: both take the same
/// shape — a notebook, and an optional parent section-group to scope to
/// (omitted means "top-level, directly under the notebook root").
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct ListSectionsRequestDto {
    pub notebook_id: String,
    pub parent_group_id: Option<String>,
}

/// Request for `create_section`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct CreateSectionRequestDto {
    pub notebook_id: String,
    pub parent_group_id: Option<String>,
    pub name: String,
    pub color: Option<String>,
    pub order_key: String,
}

/// Request for `create_section_group`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct CreateSectionGroupRequestDto {
    pub notebook_id: String,
    pub parent_group_id: Option<String>,
    pub name: String,
    pub order_key: String,
}

// ---------------------------------------------------------------------
// Page commands
// ---------------------------------------------------------------------

/// Mirrors `renote_storage::Page` / `packages/core/src/model/page.ts`'s `Page`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct PageDto {
    pub id: String,
    pub section_id: String,
    pub parent_page_id: Option<String>,
    pub order_key: String,
    pub title: String,
    pub background: PageBackgroundDto,
    pub template_id: Option<String>,
    pub created_at: String,
    pub modified_at: String,
    pub schema_version: u32,
}

impl From<renote_storage::Page> for PageDto {
    fn from(p: renote_storage::Page) -> Self {
        Self {
            id: p.id,
            section_id: p.section_id,
            parent_page_id: p.parent_page_id,
            order_key: p.order_key,
            title: p.title,
            background: p.background.into(),
            template_id: p.template_id,
            created_at: p.created_at,
            modified_at: p.modified_at,
            schema_version: p.schema_version,
        }
    }
}

/// Mirrors `renote_storage::page::PageDocument`: a page's full metadata plus
/// its ordered object list, the shape `load_page_objects` returns so the
/// frontend gets page metadata alongside the objects in one round trip.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct PageDocumentDto {
    #[serde(flatten)]
    #[ts(flatten)]
    pub page: PageDto,
    pub objects: Vec<PageObjectDto>,
}

/// Request for `list_pages`. Both a notebook and a section id are required:
/// notebook folders are looked up by id under the library root, and a
/// section's on-disk folder is resolved via that notebook's index (see
/// `crate::library::resolve_section_dir`) rather than requiring the caller
/// to track filesystem paths — storage-client has zero filesystem
/// knowledge by design.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct ListPagesRequestDto {
    pub notebook_id: String,
    pub section_id: String,
}

/// Request for `create_page`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct CreatePageRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub parent_page_id: Option<String>,
    pub order_key: String,
    pub title: String,
    pub background: PageBackgroundDto,
    pub template_id: Option<String>,
}

/// Request for `load_page_objects`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct LoadPageObjectsRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
}

/// Request for `save_page_objects`. Overwrites the page's full object list
/// (matching `renote_storage::write_page`'s replace-not-patch semantics).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct SavePageObjectsRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
    pub objects: Vec<PageObjectDto>,
    /// The page's `modifiedAt` as the caller last saw it. If it doesn't match
    /// what's on disk, something outside this app (a sync client, a text
    /// editor, another window) rewrote the page since, and the save is
    /// rejected instead of clobbering it — see `page::save_page_objects`.
    /// `None` skips the check, which is what `restore_autosave` and a
    /// user-confirmed force-overwrite pass.
    pub expected_modified_at: Option<String>,
}

/// Request for `update_page_background`. Reuses the existing `PageBackgroundDto` — see that
/// type above. Deliberately carries no `objects`: this command leaves the page's object list
/// completely untouched (see `page::update_page_background`'s doc comment).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct UpdatePageBackgroundRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
    pub background: PageBackgroundDto,
}

/// Request for `rename_notebook`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct RenameNotebookRequestDto {
    pub notebook_id: String,
    pub name: String,
}

/// Request for `rename_section`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct RenameSectionRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub name: String,
}

/// Request for `rename_section_group`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct RenameSectionGroupRequestDto {
    pub notebook_id: String,
    pub group_id: String,
    pub name: String,
}

/// Request for `rename_page`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct RenamePageRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
    pub title: String,
}

/// Request for `set_page_parent` (Phase 11.4 indent/outdent): `parentPageId: null` un-indents the
/// page to top-level. Never moves the page between sections — that's `move_page`'s job.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct SetPageParentRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
    pub parent_page_id: Option<String>,
}

// ---------------------------------------------------------------------
// Tag commands
// ---------------------------------------------------------------------

/// Mirrors `renote_storage::TagKind` / `packages/core/src/model/tag.ts`'s
/// `TagKind` union.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "kebab-case")]
pub enum TagKindDto {
    ToDo,
    Important,
    Question,
    Idea,
    Definition,
    Custom,
}

impl From<renote_storage::TagKind> for TagKindDto {
    fn from(value: renote_storage::TagKind) -> Self {
        match value {
            renote_storage::TagKind::ToDo => Self::ToDo,
            renote_storage::TagKind::Important => Self::Important,
            renote_storage::TagKind::Question => Self::Question,
            renote_storage::TagKind::Idea => Self::Idea,
            renote_storage::TagKind::Definition => Self::Definition,
            renote_storage::TagKind::Custom => Self::Custom,
        }
    }
}

impl From<TagKindDto> for renote_storage::TagKind {
    fn from(value: TagKindDto) -> Self {
        match value {
            TagKindDto::ToDo => Self::ToDo,
            TagKindDto::Important => Self::Important,
            TagKindDto::Question => Self::Question,
            TagKindDto::Idea => Self::Idea,
            TagKindDto::Definition => Self::Definition,
            TagKindDto::Custom => Self::Custom,
        }
    }
}

/// Mirrors `renote_storage::Tag` / `packages/core/src/model/tag.ts`'s `Tag`,
/// with `notebook_id` stamped on (the storage-side `Tag` doesn't carry one —
/// it's implicit in which notebook's `tags.json` it lives in — but the
/// frontend, which juggles tags across UI state, benefits from having it
/// explicit on the wire, matching how every other *Dto already carries its
/// owning notebook/section id).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct TagDto {
    pub id: String,
    pub notebook_id: String,
    pub kind: TagKindDto,
    pub label: String,
    pub color: String,
}

impl TagDto {
    pub(crate) fn from_tag(tag: renote_storage::Tag, notebook_id: &str) -> Self {
        Self {
            id: tag.id,
            notebook_id: notebook_id.to_string(),
            kind: tag.kind.into(),
            label: tag.label,
            color: tag.color,
        }
    }
}

/// Request for `list_tags`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct ListTagsRequestDto {
    pub notebook_id: String,
}

/// Request for `create_tag`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct CreateTagRequestDto {
    pub notebook_id: String,
    pub kind: TagKindDto,
    pub label: String,
    pub color: String,
}

/// Request for `update_tag`. Only `label`/`color` are updatable — `kind`
/// and the tag's id are fixed at creation (see `renote_storage::tag::update_tag`).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct UpdateTagRequestDto {
    pub notebook_id: String,
    pub tag_id: String,
    pub label: String,
    pub color: String,
}

/// Request for `delete_tag`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct DeleteTagRequestDto {
    pub notebook_id: String,
    pub tag_id: String,
}

/// Request for `list_tagged_paragraphs` (Phase 11.3 to-do rollup).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct ListTaggedParagraphsRequestDto {
    pub notebook_id: String,
    pub tag_id: String,
}

/// One paragraph tagged with the requested tag, plus enough about its page to navigate there and
/// show a location — what a tag panel lists for e.g. a "to-do" tag. Mirrors
/// `renote_index::TaggedParagraphRow` field-for-field.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct TaggedParagraphDto {
    pub page_id: String,
    pub page_title: String,
    pub object_id: String,
    pub text: String,
}

impl From<renote_index::TaggedParagraphRow> for TaggedParagraphDto {
    fn from(row: renote_index::TaggedParagraphRow) -> Self {
        Self {
            page_id: row.page_id,
            page_title: row.page_title,
            object_id: row.object_id,
            text: row.text,
        }
    }
}

// ---------------------------------------------------------------------
// Search command
// ---------------------------------------------------------------------

/// Mirrors `packages/core/src/search/query.ts`'s `SearchQuery`. `tag_ids`,
/// when non-empty, narrows results to pages carrying a paragraph tagged
/// with one of the given tag ids (see `crate::search`'s use of
/// `renote_index::SearchFilter::tag_ids`).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct SearchQueryDto {
    pub text: String,
    pub notebook_ids: Option<Vec<String>>,
    pub section_ids: Option<Vec<String>>,
    pub tag_ids: Option<Vec<String>>,
    pub modified_after: Option<String>,
    pub modified_before: Option<String>,
}

/// Mirrors `packages/core/src/search/query.ts`'s `SearchHit`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct SearchHitDto {
    pub page_id: String,
    pub notebook_id: String,
    pub section_id: String,
    pub title: String,
    pub snippet: String,
    pub score: f64,
}

impl From<renote_index::SearchHit> for SearchHitDto {
    fn from(hit: renote_index::SearchHit) -> Self {
        Self {
            page_id: hit.page_id,
            notebook_id: hit.notebook_id,
            section_id: hit.section_id,
            title: hit.title,
            snippet: hit.snippet,
            score: hit.score,
        }
    }
}

/// Mirrors `packages/core/src/search/query.ts`'s `SearchResults`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct SearchResultsDto {
    pub query: SearchQueryDto,
    pub hits: Vec<SearchHitDto>,
    pub took_ms: f64,
}

// ---------------------------------------------------------------------
// Trash (recycle bin) commands
// ---------------------------------------------------------------------

/// Mirrors `renote_storage::TrashItemKind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "kebab-case")]
pub enum TrashItemKindDto {
    Notebook,
    SectionGroup,
    Section,
    Page,
}

impl From<renote_storage::TrashItemKind> for TrashItemKindDto {
    fn from(value: renote_storage::TrashItemKind) -> Self {
        match value {
            renote_storage::TrashItemKind::Notebook => Self::Notebook,
            renote_storage::TrashItemKind::SectionGroup => Self::SectionGroup,
            renote_storage::TrashItemKind::Section => Self::Section,
            renote_storage::TrashItemKind::Page => Self::Page,
        }
    }
}

/// Mirrors `renote_storage::TrashEntry`. Deliberately omits `originalDirName`
/// (a notebook-restore implementation detail the frontend never needs to see
/// or act on) — every other field here is what a trash-bin UI needs to list
/// entries and let the user restore one.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct TrashEntryDto {
    pub id: String,
    pub kind: TrashItemKindDto,
    pub original_id: String,
    pub name: String,
    pub notebook_id: Option<String>,
    pub parent_group_id: Option<String>,
    pub section_id: Option<String>,
    pub deleted_at: String,
}

impl From<renote_storage::TrashEntry> for TrashEntryDto {
    fn from(entry: renote_storage::TrashEntry) -> Self {
        Self {
            id: entry.id,
            kind: entry.kind.into(),
            original_id: entry.original_id,
            name: entry.name,
            notebook_id: entry.notebook_id,
            parent_group_id: entry.parent_group_id,
            section_id: entry.section_id,
            deleted_at: entry.deleted_at,
        }
    }
}

/// Request for `trash_notebook`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct TrashNotebookRequestDto {
    pub notebook_id: String,
}

/// Request for `trash_section_group`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct TrashSectionGroupRequestDto {
    pub notebook_id: String,
    pub group_id: String,
}

/// Request for `trash_section`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct TrashSectionRequestDto {
    pub notebook_id: String,
    pub section_id: String,
}

/// Request for `trash_page`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct TrashPageRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
}

/// Request for `restore_from_trash`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct RestoreFromTrashRequestDto {
    pub entry_id: String,
}

/// Request for `empty_trash_entry`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct EmptyTrashEntryRequestDto {
    pub entry_id: String,
}

// ---------------------------------------------------------------------
// Backup / restore commands
// ---------------------------------------------------------------------

/// Request for `export_notebook_backup`. `dest_path` is an absolute path
/// the frontend obtained from a native save-file dialog (`@tauri-apps/plugin-dialog`)
/// — this crate never picks a destination on the user's behalf.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct ExportNotebookBackupRequestDto {
    pub notebook_id: String,
    pub dest_path: String,
}

/// Request for `import_notebook_backup`. `archive_path` is an absolute path
/// the frontend obtained from a native open-file dialog.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct ImportNotebookBackupRequestDto {
    pub archive_path: String,
}

// ---------------------------------------------------------------------
// Workspace commands
// ---------------------------------------------------------------------

/// Request for `set_workspace_path`. `path` is an absolute path the
/// frontend obtained from a native directory-picker dialog
/// (`@tauri-apps/plugin-dialog`'s `open({ directory: true })`).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct SetWorkspacePathRequestDto {
    pub path: String,
}

// ---------------------------------------------------------------------
// Asset commands
// ---------------------------------------------------------------------

/// Response for `save_image_asset`: the relative `assetPath` to store on the
/// object's `data.assetPath` field (see `renote_storage::asset::write_asset`),
/// plus the probed pixel dimensions of the source image.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct AssetRefDto {
    pub asset_path: String,
    pub natural_width: u32,
    pub natural_height: u32,
}

/// Request for `save_image_asset`. `source_path` is an absolute filesystem
/// path the frontend obtained from a native open-file dialog
/// (`@tauri-apps/plugin-dialog`) — NOT necessarily inside the open
/// workspace, or even inside any directory the Tauri asset-protocol scope
/// has been granted for (that scope only ever covers the workspace tree,
/// see `renote_lib::run()`'s setup hook / `crate::workspace::set_workspace_path`
/// — a user's photo picked from e.g. their Pictures/Downloads folder is
/// almost always OUTSIDE it). The command reads `source_path`'s bytes
/// directly via `std::fs::read` in Rust, which — unlike a WebView-side
/// `fetch(convertFileSrc(...))` or `@tauri-apps/plugin-fs` call — is not
/// subject to any capability/scope restriction at all; only the WebView's
/// own asset-protocol/fs-plugin surface is scope-checked, plain Rust code
/// never is. This also lets dimension-probing happen server-side (see
/// `AssetRefDto.naturalWidth`/`naturalHeight`) via the `image` crate,
/// instead of the frontend fetching the bytes twice (once to probe
/// dimensions, again — redundantly — inside `save_image_asset` itself).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct SaveImageAssetRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
    pub source_path: String,
}

/// Request for `resolve_asset_path`. `asset_path` is the relative path
/// previously returned by `save_image_asset` (`AssetRefDto.asset_path`).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct ResolveAssetPathRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub asset_path: String,
}

/// Request for `move_page`. The first triple is where the page is now, the
/// `target_*` pair is where it should end up — which may be another notebook
/// entirely. `order_key` is its position among its new siblings; the frontend
/// computes it the same way it does for a newly created page.
///
/// The page keeps its id, so every wikilink pointing at it keeps resolving
/// (see `resolve_wikilink_target`) — a move is not a delete-and-recreate.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct MovePageRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
    pub target_notebook_id: String,
    pub target_section_id: String,
    pub order_key: String,
}

/// Request for `reorder_pages`: `page_ids` is the section's pages in the
/// order the user just dragged them into. Every one of them is renumbered,
/// rather than trying to squeeze a new key between two neighbours — order
/// keys are fixed-width (see `AppShell`'s `newOrderKey`), so there is no room
/// between adjacent values, and a section holds tens of pages.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct ReorderPagesRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_ids: Vec<String>,
}

/// Request for `move_section` / `move_section_group`: moves the whole folder
/// under a different parent within the SAME notebook — the notebook root when
/// `target_parent_group_id` is `null`, otherwise that section-group.
///
/// Cross-notebook moves are deliberately not offered: only one notebook is
/// expanded in the tree at a time, so there is no gesture that would ask for
/// one, and it would mean moving every page's index rows between two
/// databases rather than rebuilding one.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct MoveSectionRequestDto {
    pub notebook_id: String,
    /// The section's or section-group's id, depending on which command this
    /// is sent to.
    pub id: String,
    pub target_parent_group_id: Option<String>,
}

/// Request for `copy_page_asset` — duplicating an existing asset file for a
/// different page, which is what pasting an image (or any other
/// `assetPath`-backed object) onto another page needs. An `assetPath` is
/// relative to its SECTION directory, so a copied object that lands in a
/// different section would otherwise point at a file that isn't there; within
/// one section it would still resolve, but the two pages would then share a
/// single file and deleting either object would break the other.
///
/// The source triple is spelled out separately from the destination rather
/// than assumed equal: a copy can cross notebooks, not just pages.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct CopyPageAssetRequestDto {
    pub source_notebook_id: String,
    pub source_section_id: String,
    pub source_asset_path: String,
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
}

/// Request for `delete_page_asset`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct DeletePageAssetRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
    pub asset_path: String,
}

/// Request for `stop_native_audio_capture` (Linux/BSD native-microphone fallback — see
/// `crate::audio`'s doc comment for why it exists alongside `save_audio_asset`). No file name
/// field, unlike `SaveAudioAssetRequestDto`: the command mints its own timestamped one, since
/// the bytes never leave Rust for the frontend to name.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct StopNativeAudioCaptureRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
}

// ---------------------------------------------------------------------
// Import commands
// ---------------------------------------------------------------------

/// Request for `import_plain_text_file`. `text` is the picked file's raw content, already
/// decoded to a Rust `String` frontend-side (a native open-file dialog + a `fetch(...).text()`
/// read — see `crate::import`'s doc comment). `file_name` is carried along for a future revision
/// that might want it (e.g. a default object label); a text-box object has no title field of
/// its own today, so it isn't used to set one.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct ImportPlainTextRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
    /// Absolute filesystem path from a native open-file dialog — read server-side by the
    /// command itself (`std::fs::read_to_string`), not by the frontend, for the same reason
    /// `SaveImageAssetRequestDto.sourcePath` is: a user-picked file is almost never inside the
    /// Tauri asset-protocol's workspace-scoped read permission, so a WebView-side
    /// `fetch(convertFileSrc(...))` read would fail for any file outside the open workspace.
    pub source_path: String,
}

// ---------------------------------------------------------------------
// Export commands
// ---------------------------------------------------------------------

/// Request for `export_page_pdf`. `dest_path` is an absolute path the frontend obtained from a
/// native save-file dialog — same convention `ExportNotebookBackupRequestDto` uses.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct ExportPagePdfRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
    pub dest_path: String,
}

/// Request for `export_section_pdf`: every page in the section, batched into one PDF (one PDF
/// page per note page), in the section's own page order.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct ExportSectionPdfRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub dest_path: String,
}

/// Request for `export_notebook_pdf`: every page in every section (recursively, through nested
/// section groups) of the notebook, batched into one PDF.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct ExportNotebookPdfRequestDto {
    pub notebook_id: String,
    pub dest_path: String,
}

/// Request for `export_page_plain_text`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct ExportPagePlainTextRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
    pub dest_path: String,
}

/// Request for `export_page_markdown`. Same shape/convention as `ExportPagePdfRequestDto`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct ExportPageMarkdownRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
    pub dest_path: String,
}

/// Request for `export_section_markdown`: every page in the section, joined into one `.md` file
/// (a `---` thematic break between pages), in the section's own page order — the Markdown trio's
/// mirror of `ExportSectionPdfRequestDto`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct ExportSectionMarkdownRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub dest_path: String,
}

/// Request for `export_notebook_markdown`: every page in every section (recursively, through
/// nested section groups) of the notebook, joined into one `.md` file.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct ExportNotebookMarkdownRequestDto {
    pub notebook_id: String,
    pub dest_path: String,
}

// ---------------------------------------------------------------------
// Autosave commands
// ---------------------------------------------------------------------

/// Mirrors `renote_storage::AutosaveMeta`: cheap status metadata for a
/// page's single autosave slot (no page object data included).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct AutosaveMetaDto {
    pub timestamp: String,
    /// `f64`, not `u64`: ts-rs maps `u64` to TS `bigint`, which doesn't
    /// round-trip through Tauri's JSON `invoke` bridge cleanly (the actual
    /// runtime value arrives as a plain `number`, not a `bigint`). `f64`
    /// matches how every other byte-count-shaped field on the wire here
    /// (e.g. `SearchHitDto.score`) is represented, and safely covers file
    /// sizes far beyond anything an autosave folder will ever reach.
    pub size_bytes: f64,
    pub object_count: u32,
}

impl From<renote_storage::AutosaveMeta> for AutosaveMetaDto {
    fn from(value: renote_storage::AutosaveMeta) -> Self {
        Self {
            timestamp: value.timestamp,
            size_bytes: value.size_bytes as f64,
            object_count: value.object_count as u32,
        }
    }
}

/// Request for `get_autosave_status`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct GetAutosaveStatusRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
}

/// Request for `restore_autosave`. No timestamp field: unlike the old
/// multi-version-history design, a page has at most one autosave, so
/// nothing else is needed to identify it.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct RestoreAutosaveRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
}

/// Request for `save_autosave`. Called on a timer from the frontend, at the
/// interval the user picked in Settings — see `crate::autosave`'s doc
/// comment.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct SaveAutosaveRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
}

// ---------------------------------------------------------------------
// Page linking / graph view commands (Phase 7)
// ---------------------------------------------------------------------

/// Request for `list_backlinks`: every page linking TO `page_id` ("Linked Mentions").
/// `section_id` isn't strictly needed to answer the query (a page id alone is enough once the
/// owning notebook's index is open) but is included for the same reason every other page-scoped
/// request here (e.g. `GetAutosaveStatusRequestDto`) carries it: it doubles as a existence check
/// via `crate::library::resolve_section_dir` and keeps this request shaped like its siblings.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct ListBacklinksRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
}

/// Request for `find_related_pages` (Phase 13's local semantic layer): the page's own stored
/// embedding vector is read back, not recomputed, so this needs the same identifying triple as
/// `ListBacklinksRequestDto` plus how many neighbours to return.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct FindRelatedPagesRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub page_id: String,
    pub limit: u32,
}

/// Request for `resolve_wikilink_target`: look up every page in `notebook_id` whose title
/// exactly matches `title` (case-sensitive — see `crate::link::resolve_wikilink_target`'s doc
/// comment for why case-sensitive exact match is fine for v1).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct ResolveWikilinkTargetRequestDto {
    pub notebook_id: String,
    pub title: String,
}

/// Response for `resolve_wikilink_target`: a tagged union so the frontend can branch on exactly
/// which of the three resolution outcomes it got without a separate "how many pages matched"
/// query. `#[serde(tag = "kind")]` (mirrored by `#[ts(rename_all = ...)]`'s effect on the
/// variant names below) makes this an internally-tagged enum, which `ts-rs` exports as the
/// discriminated union `{ kind: "found", page: PageDto } | { kind: "ambiguous", pages: PageDto[] }
/// | { kind: "notFound" }` — the frontend narrows on `.kind` exactly like it would any other
/// discriminated union.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub enum WikilinkResolutionDto {
    /// Exactly one existing page in the notebook has this title.
    Found { page: Box<PageDto> },
    /// More than one existing page shares this title — the frontend should show a small
    /// disambiguation popover rather than guessing.
    Ambiguous { pages: Vec<PageDto> },
    /// No existing page has this title — the frontend should auto-create one via
    /// `create_linked_page`.
    NotFound,
}

/// Request for `create_linked_page`: auto-creates a new, empty page titled `title` in
/// `section_id` — the "no existing page with this title" path `resolve_wikilink_target`'s
/// `NotFound` result leads to. Deliberately carries no `orderKey`/`background`/`templateId`
/// (unlike `CreatePageRequestDto`): an auto-created linked page always gets a fresh
/// end-of-section order key and an empty default background, generated server-side (see
/// `crate::link::create_linked_page`), since there's no user-facing "new page" form driving this
/// creation for the frontend to have already collected those from.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct CreateLinkedPageRequestDto {
    pub notebook_id: String,
    pub section_id: String,
    pub title: String,
}

/// Request for `list_page_links`: every `(source, target)` wikilink pair among pages in
/// `notebook_id` — feeds the graph view.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct ListPageLinksRequestDto {
    pub notebook_id: String,
}

/// One graph-view edge: mirrors `renote_index`'s `(source_page_id, target_page_id)` pair
/// verbatim. `sourcePageId == targetPageId` is a valid self-link edge, not filtered out.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct PageLinkDto {
    pub source_page_id: String,
    pub target_page_id: String,
}

impl From<(String, String)> for PageLinkDto {
    fn from((source_page_id, target_page_id): (String, String)) -> Self {
        Self { source_page_id, target_page_id }
    }
}

/// One page's full workspace address — `Notebook > Section > Page`, ids alongside names.
/// Unambiguous because `crate::naming` keeps each of those three names unique within its parent,
/// which is what lets the frontend render a link suggestion's whole location and resolve an exact
/// `[[!Notebook@Section$Page#Heading` path typed anywhere in the workspace.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = BINDINGS_DIR, rename_all = "camelCase")]
pub struct PageLocationDto {
    pub page_id: String,
    pub page_title: String,
    pub section_id: String,
    pub section_name: String,
    pub notebook_id: String,
    pub notebook_name: String,
}

#[cfg(test)]
mod tests {
    //! Running this test (`cargo test -p renote-commands export_typescript_bindings`)
    //! is how a developer (re)generates `packages/storage-client/src/generated/*.ts`
    //! after changing any DTO above — every `#[ts(export)]`-annotated type in
    //! this file writes itself there. See this file's module doc comment.
    use super::*;

    #[test]
    fn export_typescript_bindings() {
        let cfg = ts_rs::Config::default();
        NotebookDto::export_all(&cfg).expect("export NotebookDto (+ dependencies)");
        CreateNotebookRequestDto::export_all(&cfg).expect("export CreateNotebookRequestDto");
        SectionGroupDto::export_all(&cfg).expect("export SectionGroupDto");
        SectionDto::export_all(&cfg).expect("export SectionDto");
        ListSectionsRequestDto::export_all(&cfg).expect("export ListSectionsRequestDto");
        CreateSectionRequestDto::export_all(&cfg).expect("export CreateSectionRequestDto");
        CreateSectionGroupRequestDto::export_all(&cfg)
            .expect("export CreateSectionGroupRequestDto");
        PageDto::export_all(&cfg).expect("export PageDto (+ dependencies)");
        PageDocumentDto::export_all(&cfg).expect("export PageDocumentDto (+ dependencies)");
        ListPagesRequestDto::export_all(&cfg).expect("export ListPagesRequestDto");
        CreatePageRequestDto::export_all(&cfg)
            .expect("export CreatePageRequestDto (+ dependencies)");
        LoadPageObjectsRequestDto::export_all(&cfg).expect("export LoadPageObjectsRequestDto");
        SavePageObjectsRequestDto::export_all(&cfg).expect("export SavePageObjectsRequestDto");
        UpdatePageBackgroundRequestDto::export_all(&cfg)
            .expect("export UpdatePageBackgroundRequestDto");
        RenameNotebookRequestDto::export_all(&cfg).expect("export RenameNotebookRequestDto");
        RenameSectionRequestDto::export_all(&cfg).expect("export RenameSectionRequestDto");
        RenameSectionGroupRequestDto::export_all(&cfg)
            .expect("export RenameSectionGroupRequestDto");
        RenamePageRequestDto::export_all(&cfg).expect("export RenamePageRequestDto");
        SetPageParentRequestDto::export_all(&cfg).expect("export SetPageParentRequestDto");
        SearchQueryDto::export_all(&cfg).expect("export SearchQueryDto");
        SearchResultsDto::export_all(&cfg).expect("export SearchResultsDto (+ dependencies)");
        TrashEntryDto::export_all(&cfg).expect("export TrashEntryDto (+ dependencies)");
        TrashNotebookRequestDto::export_all(&cfg).expect("export TrashNotebookRequestDto");
        TrashSectionGroupRequestDto::export_all(&cfg).expect("export TrashSectionGroupRequestDto");
        TrashSectionRequestDto::export_all(&cfg).expect("export TrashSectionRequestDto");
        TrashPageRequestDto::export_all(&cfg).expect("export TrashPageRequestDto");
        RestoreFromTrashRequestDto::export_all(&cfg).expect("export RestoreFromTrashRequestDto");
        EmptyTrashEntryRequestDto::export_all(&cfg).expect("export EmptyTrashEntryRequestDto");
        ExportNotebookBackupRequestDto::export_all(&cfg)
            .expect("export ExportNotebookBackupRequestDto");
        ImportNotebookBackupRequestDto::export_all(&cfg)
            .expect("export ImportNotebookBackupRequestDto");
        SetWorkspacePathRequestDto::export_all(&cfg).expect("export SetWorkspacePathRequestDto");
        AssetRefDto::export_all(&cfg).expect("export AssetRefDto");
        SaveImageAssetRequestDto::export_all(&cfg).expect("export SaveImageAssetRequestDto");
        ResolveAssetPathRequestDto::export_all(&cfg).expect("export ResolveAssetPathRequestDto");
        CopyPageAssetRequestDto::export_all(&cfg).expect("export CopyPageAssetRequestDto");
        MovePageRequestDto::export_all(&cfg).expect("export MovePageRequestDto");
        ReorderPagesRequestDto::export_all(&cfg).expect("export ReorderPagesRequestDto");
        MoveSectionRequestDto::export_all(&cfg).expect("export MoveSectionRequestDto");
        DeletePageAssetRequestDto::export_all(&cfg).expect("export DeletePageAssetRequestDto");
        StopNativeAudioCaptureRequestDto::export_all(&cfg)
            .expect("export StopNativeAudioCaptureRequestDto");
        ImportPlainTextRequestDto::export_all(&cfg).expect("export ImportPlainTextRequestDto");
        ExportPagePdfRequestDto::export_all(&cfg).expect("export ExportPagePdfRequestDto");
        ExportSectionPdfRequestDto::export_all(&cfg).expect("export ExportSectionPdfRequestDto");
        ExportNotebookPdfRequestDto::export_all(&cfg).expect("export ExportNotebookPdfRequestDto");
        ExportPagePlainTextRequestDto::export_all(&cfg)
            .expect("export ExportPagePlainTextRequestDto");
        ExportPageMarkdownRequestDto::export_all(&cfg)
            .expect("export ExportPageMarkdownRequestDto");
        ExportSectionMarkdownRequestDto::export_all(&cfg)
            .expect("export ExportSectionMarkdownRequestDto");
        ExportNotebookMarkdownRequestDto::export_all(&cfg)
            .expect("export ExportNotebookMarkdownRequestDto");
        PageLocationDto::export_all(&cfg).expect("export PageLocationDto");
        TagDto::export_all(&cfg).expect("export TagDto (+ dependencies)");
        ListTagsRequestDto::export_all(&cfg).expect("export ListTagsRequestDto");
        CreateTagRequestDto::export_all(&cfg).expect("export CreateTagRequestDto (+ dependencies)");
        UpdateTagRequestDto::export_all(&cfg).expect("export UpdateTagRequestDto");
        DeleteTagRequestDto::export_all(&cfg).expect("export DeleteTagRequestDto");
        ListTaggedParagraphsRequestDto::export_all(&cfg)
            .expect("export ListTaggedParagraphsRequestDto");
        TaggedParagraphDto::export_all(&cfg).expect("export TaggedParagraphDto");
        AutosaveMetaDto::export_all(&cfg).expect("export AutosaveMetaDto");
        GetAutosaveStatusRequestDto::export_all(&cfg).expect("export GetAutosaveStatusRequestDto");
        RestoreAutosaveRequestDto::export_all(&cfg).expect("export RestoreAutosaveRequestDto");
        SaveAutosaveRequestDto::export_all(&cfg).expect("export SaveAutosaveRequestDto");
        ListBacklinksRequestDto::export_all(&cfg).expect("export ListBacklinksRequestDto");
        FindRelatedPagesRequestDto::export_all(&cfg).expect("export FindRelatedPagesRequestDto");
        ResolveWikilinkTargetRequestDto::export_all(&cfg)
            .expect("export ResolveWikilinkTargetRequestDto");
        WikilinkResolutionDto::export_all(&cfg)
            .expect("export WikilinkResolutionDto (+ dependencies)");
        CreateLinkedPageRequestDto::export_all(&cfg).expect("export CreateLinkedPageRequestDto");
        ListPageLinksRequestDto::export_all(&cfg).expect("export ListPageLinksRequestDto");
        PageLinkDto::export_all(&cfg).expect("export PageLinkDto");
    }
}
