//! Plain-text file import: builds a full text-box `PageObjectDto` from imported plain-text
//! content, for the frontend to insert via the existing `AddObjectCommand`/undo-stack path (see
//! `packages/canvas-engine/src/register-built-ins.ts`'s `createTextBox` for the equivalent
//! frontend-side object construction this mirrors).
//!
//! Deliberately does NOT itself write anything to storage/the index: unlike every other command
//! in this crate, nothing is persisted here. The returned object only becomes real once the
//! frontend commits it through `AddObjectCommand` and the next debounced `save_page_objects`
//! call writes it to disk — the same "backend hands back a payload, frontend owns the undoable
//! insert" split `save_image_asset` + `createImageObject` already use for images (see
//! `crate::asset`'s doc comment and `AppShell.tsx`'s `handleInsertImage`). `notebook_id`/
//! `section_id`/`page_id` on the request aren't needed to build the object itself, but are used
//! here to validate the target page actually exists before returning success — failing fast
//! here beats a confusing failure later when the frontend's next auto-save can't find it.
//!
//! No dedicated image-import path lives in this crate — see `renote_import`'s crate doc comment
//! for why a generic "Import File..." command would just duplicate the existing image-insert
//! machinery.

use tauri::Runtime;

use crate::dto::{BoundsDto, ImportPlainTextRequestDto, PageObjectDto, Transform2DDto};
use crate::library;

/// Default size (page/world units) for a freshly imported plain-text object. There's no
/// "natural size" to derive this from (a plain-text file carries no layout information), so
/// this is just a reasonable starting box roughly matching what a user manually drawing a small
/// text box on the canvas would produce; the frontend repositions it to the current viewport
/// center before inserting (see `AppShell.tsx`'s import handler, mirroring how
/// `handleInsertImage` centers a newly inserted image).
const DEFAULT_WIDTH: f64 = 400.0;
const DEFAULT_HEIGHT: f64 = 300.0;

#[tauri::command]
pub fn import_plain_text_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ImportPlainTextRequestDto,
) -> Result<PageObjectDto, String> {
    let (_notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    renote_storage::read_page(&section_dir, &request.page_id).map_err(|err| err.to_string())?;

    let source_path = std::path::Path::new(&request.source_path);
    let text = std::fs::read_to_string(source_path)
        .map_err(|err| format!("failed to read {}: {err}", source_path.display()))?;

    let content = renote_import::import_plain_text(&text);

    Ok(PageObjectDto {
        id: uuid::Uuid::new_v4().to_string(),
        r#type: "text-box".to_string(),
        transform: Transform2DDto {
            x: 0.0,
            y: 0.0,
            rotation: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            z_index: 0.0,
        },
        bounds: BoundsDto { x: 0.0, y: 0.0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
        data: serde_json::json!({ "content": content }),
    })
}
