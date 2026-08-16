//! Image, plain-text, and (stretch) Markdown import.
//!
//! ## Image import has no dedicated path here
//! Phase 5.9 already built everything a generic "Import File..." command would need for an
//! image: `renote_storage::write_asset` (via the `save_image_asset` command) plus the frontend's
//! `createImageObject` insert flow (see `apps/desktop/src/app-shell/AppShell.tsx`'s
//! `handleInsertImage`). A command that detects an image mime type and routes through that
//! existing machinery would just be a second, redundant entry point to the same code — so this
//! crate deliberately does not duplicate it. What's actually new for this phase is plain-text
//! import (see [`import_plain_text`]) and, as a stretch, basic Markdown (see
//! [`import_markdown`]).
//!
//! Rust-only — no `tauri`/`renote-commands` dependency (the command layer wraps this crate, not
//! the other way around; see this workspace's crate-boundary conventions).

use serde_json::{json, Value};

/// Converts plain-text file content into the `RichTextDocument`-shaped JSON value a `text-box`
/// object's `data.content` field expects.
///
/// `renote-storage`/`renote-index` deliberately keep a page object's `data` as opaque
/// `serde_json::Value` (see `extract_plain_text`'s doc comment in
/// `renote-index/src/page_index.rs` for the rationale) — this function builds that JSON shape
/// directly via `serde_json::json!`, without taking a dependency on `packages/text-editor`'s
/// TypeScript schema. The shape mirrors `packages/text-editor/src/schema/marks.ts`'s
/// `RichTextDocument`/`RichTextParagraph`/`RichTextRun` field-for-field:
/// ```json
/// { "paragraphs": [ { "runs": [ { "text": "...", "marks": [] } ], "listKind": "none", "indentLevel": 0, "tagId": null } ] }
/// ```
///
/// One paragraph per input line (split on `\n`; a lone `\r` before it is stripped too, so CRLF
/// line endings don't leave a stray `\r` at the end of each line's text). An empty line becomes
/// a paragraph with an empty `runs` array (no run at all) rather than a run with `text: ""`,
/// matching how the TS side's `emptyRichTextDocument()` represents an empty paragraph. A single
/// trailing newline at the end of `text` is treated as a line terminator, not an extra blank
/// line — `"a\nb\n"` produces two paragraphs ("a", "b"), not three.
pub fn import_plain_text(text: &str) -> Value {
    let normalized = text.replace("\r\n", "\n");
    let body = normalized.strip_suffix('\n').unwrap_or(&normalized);

    let lines: Vec<&str> = if body.is_empty() { vec![""] } else { body.split('\n').collect() };

    let paragraphs: Vec<Value> = lines.into_iter().map(paragraph_of).collect();

    json!({ "paragraphs": paragraphs })
}

fn paragraph_of(line: &str) -> Value {
    if line.is_empty() {
        json!({ "runs": [], "listKind": "none", "indentLevel": 0, "tagId": null })
    } else {
        json!({
            "runs": [{ "text": line, "marks": [] }],
            "listKind": "none",
            "indentLevel": 0,
            "tagId": null,
        })
    }
}

/// Stretch: a small, deliberately non-exhaustive Markdown importer. Recognizes only the
/// subset called out in the project plan — `#`/`##`/... headers (mapped to the paragraph's
/// `headingLevel` field, the same one `packages/text-editor`'s live `# ` input rule sets, with
/// the `#` markers themselves stripped) and `-`/`*` bullet lines (mapped to `listKind:
/// "bulleted"`). Everything else falls back to a plain paragraph, same as [`import_plain_text`].
/// No inline emphasis (`**bold**`, `_italic_`), nested lists, blockquotes, fenced code blocks,
/// tables, links, or numbered lists — those are real standalone parser work, deferred (see the
/// project plan's "Deferred / out of scope" list); the rich-text schema itself already supports
/// all of them, just not via this importer yet.
pub fn import_markdown(text: &str) -> Value {
    let normalized = text.replace("\r\n", "\n");
    let body = normalized.strip_suffix('\n').unwrap_or(&normalized);
    let lines: Vec<&str> = if body.is_empty() { vec![""] } else { body.split('\n').collect() };

    let paragraphs: Vec<Value> = lines.into_iter().map(markdown_paragraph_of).collect();

    json!({ "paragraphs": paragraphs })
}

fn markdown_paragraph_of(line: &str) -> Value {
    if line.is_empty() {
        return json!({ "runs": [], "listKind": "none", "indentLevel": 0, "tagId": null });
    }

    if let Some((level, heading_text)) = strip_markdown_heading(line) {
        return json!({
            "runs": [{ "text": heading_text, "marks": [] }],
            "listKind": "none",
            "indentLevel": 0,
            "tagId": null,
            "headingLevel": level,
        });
    }

    if let Some(bullet_text) = strip_markdown_bullet(line) {
        return json!({
            "runs": [{ "text": bullet_text, "marks": [] }],
            "listKind": "bulleted",
            "indentLevel": 0,
            "tagId": null,
        });
    }

    json!({
        "runs": [{ "text": line, "marks": [] }],
        "listKind": "none",
        "indentLevel": 0,
        "tagId": null,
    })
}

/// Strips a leading run of 1-6 `#` characters followed by a space (an ATX-style Markdown
/// heading), returning the heading level (the `#` count) alongside the remaining text — the
/// same `headingLevel` field `packages/text-editor`'s live-typed `# ` input rule sets on a
/// paragraph, so a heading typed while editing and one imported from a `.md` file round-trip to
/// the same shape. Returns `None` for anything else, including a line that's *only* `#`
/// characters (no space, no content — not a heading by the CommonMark rule this loosely follows).
fn strip_markdown_heading(line: &str) -> Option<(usize, &str)> {
    let hashes = line.chars().take_while(|c| *c == '#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    line[hashes..].strip_prefix(' ').map(str::trim_start).map(|text| (hashes, text))
}

/// Strips a leading `- ` or `* ` bullet marker, returning the remaining text.
fn strip_markdown_bullet(line: &str) -> Option<&str> {
    line.strip_prefix("- ").or_else(|| line.strip_prefix("* ")).map(str::trim_start)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paragraphs_of(doc: &Value) -> &Vec<Value> {
        doc["paragraphs"].as_array().expect("paragraphs array")
    }

    fn run_text(paragraph: &Value, index: usize) -> &str {
        paragraph["runs"][index]["text"].as_str().expect("run text")
    }

    #[test]
    fn multi_line_text_produces_one_paragraph_per_line() {
        let doc = import_plain_text("first line\nsecond line\nthird line");
        let paragraphs = paragraphs_of(&doc);
        assert_eq!(paragraphs.len(), 3);
        assert_eq!(run_text(&paragraphs[0], 0), "first line");
        assert_eq!(run_text(&paragraphs[1], 0), "second line");
        assert_eq!(run_text(&paragraphs[2], 0), "third line");
    }

    #[test]
    fn empty_lines_produce_paragraphs_with_no_runs() {
        let doc = import_plain_text("a\n\nb");
        let paragraphs = paragraphs_of(&doc);
        assert_eq!(paragraphs.len(), 3);
        assert_eq!(run_text(&paragraphs[0], 0), "a");
        assert_eq!(paragraphs[1]["runs"].as_array().expect("runs"), &Vec::<Value>::new());
        assert_eq!(run_text(&paragraphs[2], 0), "b");
    }

    #[test]
    fn trailing_newline_does_not_add_a_spurious_empty_paragraph() {
        let doc = import_plain_text("only line\n");
        let paragraphs = paragraphs_of(&doc);
        assert_eq!(paragraphs.len(), 1);
        assert_eq!(run_text(&paragraphs[0], 0), "only line");
    }

    #[test]
    fn empty_input_produces_a_single_empty_paragraph() {
        let doc = import_plain_text("");
        let paragraphs = paragraphs_of(&doc);
        assert_eq!(paragraphs.len(), 1);
        assert_eq!(paragraphs[0]["runs"].as_array().expect("runs"), &Vec::<Value>::new());
    }

    #[test]
    fn crlf_line_endings_do_not_leave_a_stray_carriage_return() {
        let doc = import_plain_text("a\r\nb\r\n");
        let paragraphs = paragraphs_of(&doc);
        assert_eq!(paragraphs.len(), 2);
        assert_eq!(run_text(&paragraphs[0], 0), "a");
        assert_eq!(run_text(&paragraphs[1], 0), "b");
    }

    #[test]
    fn every_paragraph_carries_the_expected_default_fields() {
        let doc = import_plain_text("hello");
        let paragraph = &paragraphs_of(&doc)[0];
        assert_eq!(paragraph["listKind"], "none");
        assert_eq!(paragraph["indentLevel"], 0);
        assert_eq!(paragraph["tagId"], Value::Null);
        assert_eq!(paragraph["runs"][0]["marks"].as_array().expect("marks"), &Vec::<Value>::new());
    }

    #[test]
    fn markdown_headers_become_plain_paragraphs_with_markers_stripped() {
        let doc = import_markdown("# Title\n## Subtitle\nplain text");
        let paragraphs = paragraphs_of(&doc);
        assert_eq!(run_text(&paragraphs[0], 0), "Title");
        assert_eq!(paragraphs[0]["listKind"], "none");
        assert_eq!(run_text(&paragraphs[1], 0), "Subtitle");
        assert_eq!(run_text(&paragraphs[2], 0), "plain text");
    }

    #[test]
    fn markdown_headers_carry_their_level_in_heading_level() {
        let doc = import_markdown("# H1\n###### H6\nplain text");
        let paragraphs = paragraphs_of(&doc);
        assert_eq!(paragraphs[0]["headingLevel"], 1);
        assert_eq!(paragraphs[1]["headingLevel"], 6);
        // A plain (non-heading) paragraph carries no headingLevel key at all — same
        // "absent key defaults to 0" backward-compat contract `packages/text-editor` relies on.
        assert_eq!(paragraphs[2].get("headingLevel"), None);
    }

    #[test]
    fn a_7th_hash_is_not_treated_as_a_heading_marker() {
        let doc = import_markdown("####### not a heading");
        let paragraphs = paragraphs_of(&doc);
        assert_eq!(paragraphs[0]["listKind"], "none");
        assert_eq!(paragraphs[0].get("headingLevel"), None);
        assert_eq!(run_text(&paragraphs[0], 0), "####### not a heading");
    }

    #[test]
    fn markdown_bullets_become_bulleted_paragraphs() {
        let doc = import_markdown("- first\n* second\nnot a bullet");
        let paragraphs = paragraphs_of(&doc);
        assert_eq!(paragraphs[0]["listKind"], "bulleted");
        assert_eq!(run_text(&paragraphs[0], 0), "first");
        assert_eq!(paragraphs[1]["listKind"], "bulleted");
        assert_eq!(run_text(&paragraphs[1], 0), "second");
        assert_eq!(paragraphs[2]["listKind"], "none");
        assert_eq!(run_text(&paragraphs[2], 0), "not a bullet");
    }

    #[test]
    fn a_lone_hash_with_no_space_is_not_treated_as_a_heading() {
        let doc = import_markdown("#hashtag-like-text");
        let paragraphs = paragraphs_of(&doc);
        assert_eq!(paragraphs[0]["listKind"], "none");
        assert_eq!(run_text(&paragraphs[0], 0), "#hashtag-like-text");
    }
}
