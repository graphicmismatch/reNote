//! renote-storage: the directory-tree source of truth for reNote notebooks.
//!
//! Rust-only — no other crate touches notebook filesystem data directly,
//! and this crate does not depend on `tauri`, so it is fully usable/testable
//! standalone. It owns:
//! - Notebook/section/section-group directory-tree create/list/delete
//!   ([`notebook`], [`section`] modules).
//! - Page JSON read/write with versioned schema migration ([`page`]).
//! - The binary ink-stroke point-blob format ([`blob`]).
//! - Generic per-page asset (image/audio/attachment) file I/O ([`asset`]).
//! - Notebook backup/restore as a self-contained zip archive ([`backup`]).
//!
//! ## On-disk layout
//! ```text
//! <root>/
//!   <notebook-folder>/              folder name = sanitized Notebook.name, deduped
//!     .renote-notebook.json         Notebook metadata
//!     <section-group-id>/           folder name = SectionGroup.id
//!       .renote-section-group.json  SectionGroup metadata
//!       <...more nested groups/sections...>
//!     <section-id>/                 folder name = Section.id
//!       .renote-section.json        Section metadata
//!       <page-id>.page.json         Page metadata + ordered PageObjectEnvelope array
//!       assets/
//!         <page-id>/
//!           strokes/<stroke-id>.bin     packed f32 [x, y, pressure] triples — see `blob`
//!           <other files>                images/audio/attachments — see `asset`
//! ```
//!
//! Section groups and sections may nest arbitrarily under a notebook root
//! or under each other. Pages never nest on disk: a page's `parentPageId` +
//! `orderKey` (see [`model::Page`]) express subpage ordering/indentation
//! among siblings as data, not filesystem structure — every page in a
//! section sits as a flat sibling `.page.json` file directly inside that
//! section's folder.
//!
//! Notebook/section/section-group folders are named deterministically (by
//! id, except notebooks which are named after their sanitized `name` since
//! `Notebook.path` is the one model struct that stores an absolute path);
//! callers therefore never need to separately track a folder location
//! alongside the metadata struct returned by this crate's functions.

mod asset;
mod autosave;
mod backup;
mod blob;
mod error;
mod json_io;
mod model;
mod notebook;
mod page;
mod section;
mod tag;
mod trash;
mod util;
mod workspace;

pub use asset::{delete_asset, page_assets_dir, read_asset, write_asset};
pub use autosave::{
    autosave_status, read_autosave, write_autosave, AutosaveMeta, AUTOSAVE_DIR_NAME,
};
pub use backup::{create_notebook_archive, restore_notebook_archive};
pub use blob::{read_stroke_blob, strokes_dir, write_stroke_blob};
pub use error::StorageError;
pub use model::{
    Bounds, Notebook, NotebookId, Page, PageBackground, PageId, PageObjectEnvelope, PageObjectId,
    PageRuleLines, Section, SectionGroup, SectionGroupId, SectionId, Tag, TagId, TagKind,
    Transform2D,
};
pub use notebook::{
    create_notebook, delete_notebook, list_notebooks, read_notebook, rename_notebook,
    NOTEBOOK_MARKER_FILE,
};
pub use page::{
    create_page, delete_page, list_pages, move_page, page_json_path, read_page, rename_page,
    set_page_order_key, set_page_parent, write_page, PageDocument, CURRENT_PAGE_SCHEMA_VERSION,
};
pub use section::{
    create_section, create_section_group, delete_section, delete_section_group,
    list_section_groups, list_sections, move_section, move_section_group, read_section,
    read_section_group, rename_section, rename_section_group, section_dir, section_group_dir,
    SECTION_GROUP_MARKER_FILE, SECTION_MARKER_FILE,
};
pub use tag::{create_tag, delete_tag, list_tags, update_tag};
pub use trash::{
    empty_trash, empty_trash_entry, list_trash, restore_from_trash, trash_notebook, trash_page,
    trash_root_dir, trash_section, trash_section_group, TrashEntry, TrashItemKind, TRASH_DIR_NAME,
};
pub use util::new_id;
pub use workspace::{
    add_recent_workspace_path, load_workspace_config, save_workspace_config, WorkspaceConfig,
};
