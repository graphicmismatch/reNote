//! Markdown export: walks a page's `text-box` objects' rich-text content (headings, lists,
//! blockquotes, code blocks, tables, inline marks) and joins it with the page title into one
//! Markdown document.
//!
//! Untyped `serde_json::Value` walk, same reasoning as `text.rs`'s `collect_string_leaves`: this
//! crate has no dependency on `@renote/text-editor`'s TS-side `RichTextDocument` types (nor
//! should it gain one for a single export path), so the JSON is read generically via
//! `Value::get`/`as_str`/etc. rather than through a parallel typed Rust mirror of that schema.

use renote_storage::{PageDocument, PageObjectEnvelope};
use serde_json::Value;

/// Escapes Markdown special characters in plain (non-code) text so they render literally rather
/// than being misread as syntax.
fn escape(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('*', "\\*")
        .replace('_', "\\_")
        .replace('`', "\\`")
        .replace('[', "\\[")
        .replace(']', "\\]")
}

fn has_mark(marks: &[Value], kind: &str) -> bool {
    marks.iter().any(|mark| mark.get("kind").and_then(Value::as_str) == Some(kind))
}

fn mark_attr<'a>(marks: &'a [Value], kind: &str, field: &str) -> Option<&'a str> {
    marks
        .iter()
        .find(|mark| mark.get("kind").and_then(Value::as_str) == Some(kind))
        .and_then(|mark| mark.get(field))
        .and_then(Value::as_str)
}

/// One `RichTextRun` (a text span with marks, or an inline image) rendered to Markdown.
fn run_to_markdown(run: &Value) -> String {
    if run.get("kind").and_then(Value::as_str) == Some("image") {
        let alt = run.get("alt").and_then(Value::as_str).unwrap_or("");
        let src = run.get("src").and_then(Value::as_str).unwrap_or("");
        return format!("![{alt}]({src})");
    }

    let text = run.get("text").and_then(Value::as_str).unwrap_or("");
    let empty = Vec::new();
    let marks = run.get("marks").and_then(Value::as_array).unwrap_or(&empty);

    // Code wins over escaping and over the other inline marks: a code span's content renders
    // literally, and stacking bold/italic around backticks is valid CommonMark but rare/
    // confusing in practice — this keeps a code-marked run simple rather than fully general.
    let mut rendered = if has_mark(marks, "code") { format!("`{text}`") } else { escape(text) };
    if has_mark(marks, "strikethrough") {
        rendered = format!("~~{rendered}~~");
    }
    if has_mark(marks, "italic") {
        rendered = format!("*{rendered}*");
    }
    if has_mark(marks, "bold") {
        rendered = format!("**{rendered}**");
    }
    // Highlight/textColor/underline have no CommonMark equivalent — left as plain rendered text,
    // same "not every mark round-trips to a file format" scope PDF export already accepts.
    if let Some(display) = mark_attr(marks, "wikilink", "attr2") {
        rendered = format!("[[{display}]]");
    } else if let Some(href) = mark_attr(marks, "link", "attr") {
        rendered = format!("[{rendered}]({href})");
    }
    rendered
}

/// One paragraph block (heading/list/blockquote/plain), the runs inside it already rendered.
fn paragraph_to_markdown(paragraph: &Value) -> String {
    let empty = Vec::new();
    let runs = paragraph.get("runs").and_then(Value::as_array).unwrap_or(&empty);
    let text: String = runs.iter().map(run_to_markdown).collect();

    let heading_level = paragraph.get("headingLevel").and_then(Value::as_u64).unwrap_or(0);
    let list_kind = paragraph.get("listKind").and_then(Value::as_str).unwrap_or("none");
    let indent_level = paragraph.get("indentLevel").and_then(Value::as_u64).unwrap_or(0) as usize;
    let blockquote_depth = paragraph.get("blockquoteDepth").and_then(Value::as_u64).unwrap_or(0);

    let mut line = if (1..=6).contains(&heading_level) {
        format!("{} {text}", "#".repeat(heading_level as usize))
    } else if list_kind == "bulleted" {
        format!("{}- {text}", "  ".repeat(indent_level))
    } else if list_kind == "numbered" {
        // ponytail: always "1." rather than a real running per-level counter — every CommonMark
        // renderer auto-numbers a list from its first item regardless of the literal digit on
        // each source line, so this only matters if something reads the raw .md source itself.
        // Upgrade to real counters if a reader ever needs that.
        format!("{}1. {text}", "  ".repeat(indent_level))
    } else {
        text
    };

    for _ in 0..blockquote_depth {
        line = format!("> {line}");
    }
    line
}

fn table_to_markdown(table: &Value) -> String {
    let empty = Vec::new();
    let rows = table.get("rows").and_then(Value::as_array).unwrap_or(&empty);
    let header_row_count =
        table.get("headerRowCount").and_then(Value::as_u64).unwrap_or(0) as usize;

    let mut lines = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let cell_empty = Vec::new();
        let cells = row.get("cells").and_then(Value::as_array).unwrap_or(&cell_empty);
        let cell_text: Vec<String> = cells.iter().map(paragraph_to_markdown).collect();
        lines.push(format!("| {} |", cell_text.join(" | ")));
        if index + 1 == header_row_count {
            lines.push(format!("| {} |", vec!["---"; cell_text.len()].join(" | ")));
        }
    }
    lines.join("\n")
}

/// One `RichTextBlock` (paragraph, fenced code block, or table) rendered to Markdown.
fn block_to_markdown(block: &Value) -> String {
    match block.get("kind").and_then(Value::as_str) {
        Some("codeBlock") => {
            let text = block.get("text").and_then(Value::as_str).unwrap_or("");
            let language = block.get("language").and_then(Value::as_str).unwrap_or("");
            format!("```{language}\n{text}\n```")
        }
        Some("table") => table_to_markdown(block),
        _ => paragraph_to_markdown(block),
    }
}

/// The Markdown content of one `text-box` object, or `None` for a non-`text-box` object or one
/// with nothing to export.
fn text_box_markdown(object: &PageObjectEnvelope) -> Option<String> {
    if object.r#type != "text-box" {
        return None;
    }
    let content = object.data.get("content")?;

    if let Some(paragraphs) = content.get("paragraphs").and_then(Value::as_array) {
        let joined = paragraphs.iter().map(block_to_markdown).collect::<Vec<_>>().join("\n");
        return if joined.trim().is_empty() { None } else { Some(joined) };
    }

    // Legacy/never-focused shape: `content` is a bare string, not yet a `RichTextDocument` (see
    // `PageEditorView.tsx`'s `isRichTextDocument`) — degrade to plain escaped text, matching
    // `export_page_plain_text`'s coverage of the same shape.
    match content.as_str() {
        Some(text) if !text.trim().is_empty() => Some(escape(text)),
        _ => None,
    }
}

/// Markdown export of one page: an H1 of the page title, followed by every `text-box` object's
/// rendered content (in object-list order), each block separated by a blank line. Non-text
/// objects (ink strokes, images, shapes, tables-the-canvas-object, file attachments, audio
/// clips) contribute nothing — same scope `export_page_plain_text` uses.
pub fn export_page_markdown(page: &PageDocument) -> String {
    let mut sections = vec![format!("# {}", page.page.title)];
    for object in &page.objects {
        if let Some(markdown) = text_box_markdown(object) {
            sections.push(markdown);
        }
    }
    sections.join("\n\n")
}

/// Markdown export of a whole section or notebook: every page's own `export_page_markdown`,
/// joined by a Markdown thematic break (`---`) — the closest Markdown has to a PDF's page break.
/// Order matches `pages`' own order (section/notebook page order, same as the PDF trio's
/// `export_pages_to_pdf`).
pub fn export_pages_to_markdown(pages: &[PageDocument]) -> String {
    pages.iter().map(export_page_markdown).collect::<Vec<_>>().join("\n\n---\n\n")
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

    fn text_box(id: &str, paragraphs: Value) -> PageObjectEnvelope {
        PageObjectEnvelope {
            id: id.to_string(),
            r#type: "text-box".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: json!({ "content": { "paragraphs": paragraphs } }),
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
    fn title_becomes_an_h1_and_plain_paragraphs_follow() {
        let page = sample_page(
            "My Page",
            vec![text_box(
                "obj-1",
                json!([{ "runs": [{ "text": "hello", "marks": [] }], "listKind": "none", "indentLevel": 0, "tagId": null }]),
            )],
        );
        assert_eq!(export_page_markdown(&page), "# My Page\n\nhello");
    }

    #[test]
    fn heading_level_becomes_hash_prefix() {
        let page = sample_page(
            "T",
            vec![text_box(
                "obj-1",
                json!([{ "runs": [{ "text": "Section", "marks": [] }], "listKind": "none", "indentLevel": 0, "tagId": null, "headingLevel": 2 }]),
            )],
        );
        assert_eq!(export_page_markdown(&page), "# T\n\n## Section");
    }

    #[test]
    fn bulleted_list_gets_a_dash_prefix_indented_by_level() {
        let page = sample_page(
            "T",
            vec![text_box(
                "obj-1",
                json!([{ "runs": [{ "text": "item", "marks": [] }], "listKind": "bulleted", "indentLevel": 1, "tagId": null }]),
            )],
        );
        assert_eq!(export_page_markdown(&page), "# T\n\n  - item");
    }

    #[test]
    fn bold_italic_and_code_marks_render_as_expected_and_can_combine() {
        let page = sample_page(
            "T",
            vec![text_box(
                "obj-1",
                json!([{
                    "runs": [
                        { "text": "bold", "marks": [{ "kind": "bold" }] },
                        { "text": " and ", "marks": [] },
                        { "text": "both", "marks": [{ "kind": "bold" }, { "kind": "italic" }] },
                        { "text": " and ", "marks": [] },
                        { "text": "code", "marks": [{ "kind": "code" }] },
                    ],
                    "listKind": "none", "indentLevel": 0, "tagId": null,
                }]),
            )],
        );
        assert_eq!(export_page_markdown(&page), "# T\n\n**bold** and ***both*** and `code`");
    }

    #[test]
    fn a_link_mark_wraps_the_run_in_markdown_link_syntax() {
        let page = sample_page(
            "T",
            vec![text_box(
                "obj-1",
                json!([{
                    "runs": [{ "text": "site", "marks": [{ "kind": "link", "attr": "https://example.com" }] }],
                    "listKind": "none", "indentLevel": 0, "tagId": null,
                }]),
            )],
        );
        assert_eq!(export_page_markdown(&page), "# T\n\n[site](https://example.com)");
    }

    #[test]
    fn a_wikilink_mark_becomes_double_bracket_syntax() {
        let page = sample_page(
            "T",
            vec![text_box(
                "obj-1",
                json!([{
                    "runs": [{ "text": "ignored", "marks": [{ "kind": "wikilink", "attr": "page-2", "attr2": "Other Page" }] }],
                    "listKind": "none", "indentLevel": 0, "tagId": null,
                }]),
            )],
        );
        assert_eq!(export_page_markdown(&page), "# T\n\n[[Other Page]]");
    }

    #[test]
    fn blockquote_depth_prefixes_with_angle_brackets() {
        let page = sample_page(
            "T",
            vec![text_box(
                "obj-1",
                json!([{ "runs": [{ "text": "quoted", "marks": [] }], "listKind": "none", "indentLevel": 0, "tagId": null, "blockquoteDepth": 2 }]),
            )],
        );
        assert_eq!(export_page_markdown(&page), "# T\n\n> > quoted");
    }

    #[test]
    fn a_code_block_becomes_a_fenced_block_with_its_language() {
        let page = sample_page(
            "T",
            vec![text_box(
                "obj-1",
                json!([{ "kind": "codeBlock", "text": "let x = 1;", "language": "ts" }]),
            )],
        );
        assert_eq!(export_page_markdown(&page), "# T\n\n```ts\nlet x = 1;\n```");
    }

    #[test]
    fn a_table_becomes_a_gfm_pipe_table_with_a_header_separator() {
        let page = sample_page(
            "T",
            vec![text_box(
                "obj-1",
                json!([{
                    "kind": "table",
                    "headerRowCount": 1,
                    "rows": [
                        { "cells": [
                            { "runs": [{ "text": "A", "marks": [] }], "listKind": "none", "indentLevel": 0, "tagId": null },
                            { "runs": [{ "text": "B", "marks": [] }], "listKind": "none", "indentLevel": 0, "tagId": null },
                        ] },
                        { "cells": [
                            { "runs": [{ "text": "1", "marks": [] }], "listKind": "none", "indentLevel": 0, "tagId": null },
                            { "runs": [{ "text": "2", "marks": [] }], "listKind": "none", "indentLevel": 0, "tagId": null },
                        ] },
                    ],
                }]),
            )],
        );
        assert_eq!(export_page_markdown(&page), "# T\n\n| A | B |\n| --- | --- |\n| 1 | 2 |");
    }

    #[test]
    fn ignores_non_text_box_objects() {
        let mut ink = text_box("obj-1", json!([]));
        ink.r#type = "ink-stroke".to_string();
        ink.data =
            json!({ "tool": "pen", "color": "#000", "width": 2.0, "pointDataAssetPath": "x" });
        let page = sample_page("Title Only", vec![ink]);
        assert_eq!(export_page_markdown(&page), "# Title Only");
    }

    #[test]
    fn skips_text_boxes_with_no_string_content() {
        let mut empty = text_box("obj-1", json!([]));
        empty.data = json!({ "content": "" });
        let page = sample_page("Empty Body", vec![empty]);
        assert_eq!(export_page_markdown(&page), "# Empty Body");
    }

    #[test]
    fn export_pages_to_markdown_joins_pages_with_a_thematic_break() {
        let page_a = sample_page("A", vec![]);
        let page_b = sample_page("B", vec![]);
        assert_eq!(export_pages_to_markdown(&[page_a, page_b]), "# A\n\n---\n\n# B");
    }

    #[test]
    fn special_characters_in_plain_text_are_escaped() {
        let page = sample_page(
            "T",
            vec![text_box(
                "obj-1",
                json!([{ "runs": [{ "text": "a*b_c`d[e]f", "marks": [] }], "listKind": "none", "indentLevel": 0, "tagId": null }]),
            )],
        );
        assert_eq!(export_page_markdown(&page), "# T\n\na\\*b\\_c\\`d\\[e\\]f");
    }
}
