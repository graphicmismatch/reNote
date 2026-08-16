//! Plain-text export: walks a page's `text-box` objects for their text content and joins it
//! with the page title into one plain-text document.

use renote_storage::{PageDocument, PageObjectEnvelope};

/// Recursively collects every JSON string leaf under `value`, skipping blank-only strings.
/// Object keys are not leaves, only string values are. This is a local, self-contained
/// reimplementation of `renote-index/src/page_index.rs`'s `collect_string_leaves` (same ~15
/// lines) rather than a cross-crate dependency on renote-index, which this crate has no other
/// reason to depend on — see that function's doc comment for why a generic "walk the opaque
/// JSON" approach is used at all instead of a typed `RichTextDocument` decode.
pub(crate) fn collect_string_leaves(value: &serde_json::Value, out: &mut Vec<String>) {
    match value {
        serde_json::Value::String(s) => {
            if !s.trim().is_empty() {
                out.push(s.clone());
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_string_leaves(item, out);
            }
        }
        serde_json::Value::Object(map) => {
            for v in map.values() {
                collect_string_leaves(v, out);
            }
        }
        _ => {}
    }
}

/// The flattened text content of one `text-box` object (its string leaves joined with a single
/// space), or `None` for a non-`text-box` object or one with no text content at all.
pub(crate) fn text_box_text(object: &PageObjectEnvelope) -> Option<String> {
    if object.r#type != "text-box" {
        return None;
    }
    let mut parts = Vec::new();
    collect_string_leaves(&object.data, &mut parts);
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" "))
    }
}

/// Plain-text export of one page: the page's title, followed by every `text-box` object's
/// flattened text content (in object-list order), each block separated by a blank line.
/// Non-text objects (ink strokes, images, shapes, tables, attachments, audio) contribute
/// nothing — same "text-box is the only searchable/extractable text source" scope `renote-index`
/// uses for search indexing.
///
/// Inherited quirk (pre-existing in `renote-index::page_index::extract_plain_text`, which this
/// mirrors — not introduced here): because the string-leaf walk has no schema awareness, a
/// paragraph's own `listKind`/`tagId` *values* (e.g. the literal string `"none"`) are
/// indistinguishable from real run text and get swept in too whenever they're non-blank
/// strings. Harmless for search recall (the existing, shipped use of this same walk), but worth
/// knowing before treating this export's text as a byte-faithful transcript.
pub fn export_page_plain_text(page: &PageDocument) -> String {
    let mut blocks = vec![page.page.title.clone()];
    for object in &page.objects {
        if let Some(text) = text_box_text(object) {
            blocks.push(text);
        }
    }
    blocks.join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use renote_storage::{Bounds, PageBackground, PageRuleLines, Transform2D};
    use serde_json::json;

    fn sample_transform() -> Transform2D {
        Transform2D { x: 0.0, y: 0.0, rotation: 0.0, scale_x: 1.0, scale_y: 1.0, z_index: 0.0 }
    }

    fn sample_bounds() -> Bounds {
        Bounds { x: 0.0, y: 0.0, width: 100.0, height: 40.0 }
    }

    fn text_box(id: &str, text: &str) -> PageObjectEnvelope {
        PageObjectEnvelope {
            id: id.to_string(),
            r#type: "text-box".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: json!({
                "content": {
                    "paragraphs": [{
                        "runs": [{ "text": text, "marks": [] }],
                        "listKind": "none",
                        "indentLevel": 0,
                        "tagId": null,
                    }]
                }
            }),
        }
    }

    fn sample_page(title: &str, objects: Vec<PageObjectEnvelope>) -> PageDocument {
        PageDocument {
            page: renote_storage::Page {
                id: "page-1".to_string(),
                section_id: "section-1".to_string(),
                parent_page_id: None,
                order_key: "a0".to_string(),
                title: title.to_string(),
                background: PageBackground { color: None, rule_lines: PageRuleLines::None },
                template_id: None,
                created_at: "2024-01-01T00:00:00Z".to_string(),
                modified_at: "2024-01-01T00:00:00Z".to_string(),
                schema_version: 1,
            },
            objects,
        }
    }

    #[test]
    fn joins_title_and_text_box_content_with_blank_lines_in_order() {
        let page = sample_page(
            "My Page",
            vec![text_box("obj-1", "First paragraph"), text_box("obj-2", "Second paragraph")],
        );
        let text = export_page_plain_text(&page);
        // Each block also picks up "none" ahead of its real text — the paragraph's own
        // `listKind: "none"` field, swept in by the untyped string-leaf walk (see this module's
        // doc comment on `export_page_plain_text` for why that's an accepted, inherited quirk,
        // not a bug in this function).
        assert_eq!(text, "My Page\n\nnone First paragraph\n\nnone Second paragraph");
    }

    #[test]
    fn ignores_non_text_box_objects() {
        let mut ink = text_box("obj-1", "irrelevant");
        ink.r#type = "ink-stroke".to_string();
        ink.data =
            json!({ "tool": "pen", "color": "#000", "width": 2.0, "pointDataAssetPath": "x" });
        let page = sample_page("Title Only", vec![ink]);
        assert_eq!(export_page_plain_text(&page), "Title Only");
    }

    #[test]
    fn skips_text_boxes_with_no_string_content() {
        // Matches `createTextBox`'s actual default (`register-built-ins.ts`): a freshly
        // inserted, not-yet-typed-into text box has `data: { content: "" }` — a bare empty
        // string, not yet a `RichTextDocument` at all.
        let mut empty = text_box("obj-1", "");
        empty.data = json!({ "content": "" });
        let page = sample_page("Empty Body", vec![empty]);
        assert_eq!(export_page_plain_text(&page), "Empty Body");
    }
}
