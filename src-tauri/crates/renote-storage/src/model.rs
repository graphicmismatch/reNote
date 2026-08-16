//! Serde structs mirroring the TypeScript domain model in `packages/core`.
//!
//! Every struct here uses `#[serde(rename_all = "camelCase")]` so the JSON
//! keys this crate reads/writes are byte-identical to what the TypeScript
//! side produces/expects, regardless of which side wrote the file. IDs are
//! plain strings at the JSON level (branded ID types are a TS-only
//! compile-time device); this crate uses the type aliases below rather than
//! wrapper structs so serialization stays a bare string.

use serde::{Deserialize, Serialize};

/// See module docs: all ID aliases below serialize as bare JSON strings.
pub type NotebookId = String;
pub type SectionGroupId = String;
pub type SectionId = String;
pub type PageId = String;
pub type PageObjectId = String;

/// A notebook: the top-level container, backed by a folder on disk.
///
/// Mirrors `packages/core/src/model/notebook.ts`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notebook {
    pub id: NotebookId,
    pub name: String,
    /// Absolute path to the notebook's root folder on disk.
    pub path: String,
    pub color: Option<String>,
    /// ISO 8601 timestamp.
    pub created_at: String,
    /// ISO 8601 timestamp.
    pub modified_at: String,
}

/// A folder used purely to group sections/other section-groups.
///
/// Mirrors `packages/core/src/model/section.ts`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionGroup {
    pub id: SectionGroupId,
    pub notebook_id: NotebookId,
    pub parent_id: Option<SectionGroupId>,
    pub name: String,
    pub order_key: String,
}

/// A section: holds pages directly. Mirrors `packages/core/src/model/section.ts`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub id: SectionId,
    pub notebook_id: NotebookId,
    pub parent_group_id: Option<SectionGroupId>,
    pub name: String,
    pub color: Option<String>,
    pub order_key: String,
}

/// Page background rule-line styles. Mirrors the TS union
/// `"none" | "college-ruled" | "wide-ruled" | "graph" | "dotted"` exactly:
/// `rename_all = "kebab-case"` turns each PascalCase variant into the
/// matching kebab-case JSON string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PageRuleLines {
    None,
    CollegeRuled,
    WideRuled,
    Graph,
    Dotted,
}

/// Mirrors `packages/core/src/model/page.ts`'s `PageBackground`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageBackground {
    pub color: Option<String>,
    pub rule_lines: PageRuleLines,
}

/// A page's metadata (not its objects — see `PageDocument` in `crate::page`
/// for the full on-disk shape). Mirrors `packages/core/src/model/page.ts`.
///
/// `parent_page_id` + `order_key` express subpage ordering/indentation
/// among siblings; they are NOT filesystem nesting (see crate docs).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub id: PageId,
    pub section_id: SectionId,
    pub parent_page_id: Option<PageId>,
    pub order_key: String,
    pub title: String,
    pub background: PageBackground,
    pub template_id: Option<String>,
    /// ISO 8601 timestamp.
    pub created_at: String,
    /// ISO 8601 timestamp.
    pub modified_at: String,
    /// Schema version of THIS page's on-disk JSON; see `crate::page` for
    /// the versioned-upgrade mechanism keyed off this field.
    pub schema_version: u32,
}

/// Mirrors `packages/core/src/page-object/transform.ts`'s `Transform2D`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transform2D {
    pub x: f64,
    pub y: f64,
    pub rotation: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub z_index: f64,
}

/// Mirrors `packages/core/src/page-object/transform.ts`'s `Bounds`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// The shared envelope every object on a page uses, mirroring
/// `packages/core/src/page-object/envelope.ts`'s `PageObject<TType, TData>`.
///
/// `data`'s shape depends on `type` (see `built-in-types.ts` on the TS
/// side: `TextBoxData`, `InkStrokeData`, `ImageData`, `ShapeData`,
/// `TableData`, `FileAttachmentData`, `AudioClipData`, ...). renote-storage
/// deliberately keeps `data` as an opaque `serde_json::Value` rather than a
/// strongly-typed Rust enum: this crate's job is byte-faithful read/write,
/// not per-type validation (that belongs to canvas-engine's
/// ObjectTypeRegistry on the TypeScript side).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageObjectEnvelope {
    pub id: PageObjectId,
    pub r#type: String,
    pub transform: Transform2D,
    pub bounds: Bounds,
    pub data: serde_json::Value,
}

/// A tag's id. See module docs: serializes as a bare JSON string.
pub type TagId = String;

/// Built-in tag kinds mirroring OneNote's default tag set; custom tags use
/// `Custom`. Mirrors `packages/core/src/model/tag.ts`'s `TagKind` union
/// exactly via `rename_all = "kebab-case"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TagKind {
    ToDo,
    Important,
    Question,
    Idea,
    Definition,
    Custom,
}

/// A notebook-scoped tag, mirroring `packages/core/src/model/tag.ts`'s `Tag`.
/// The canonical list lives in `<notebook_dir>/tags.json` (see `crate::tag`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: TagId,
    pub kind: TagKind,
    pub label: String,
    pub color: String,
    /// For "to-do" tags: whether the checkbox is checked. Ignored for other
    /// kinds. `#[serde(skip_serializing_if)]` mirrors the TS side's optional
    /// (`checked?`) field, which is simply absent rather than `null` when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
}
