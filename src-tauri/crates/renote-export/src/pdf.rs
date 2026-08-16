//! PDF export: a rough visual reconstruction of a page from its `PageObjectEnvelope` list, not
//! pixel-parity with the live PixiJS renderer. Per-object-type simplifications are documented on
//! each `draw_*` function below; the short version:
//! - `ink-stroke`: a simple polyline through the raw points (no Catmull-Rom smoothing, no
//!   per-point circle-stamping/pressure taper).
//! - `shape`: rectangle/line/arrow drawn exactly; ellipse approximated as a 32-sided polygon
//!   (printpdf has no native ellipse primitive).
//! - `text-box`: plain text at the object's top-left, one line, no bold/italic/color/wrapping.
//! - `image`: embedded and scaled to `bounds`; crop is not applied.
//! - `table`/`file-attachment`/`audio-clip` (and any future/unknown type): a dashed bordered box
//!   with a text label.
//! - Page background color is filled; rule lines are not drawn (nice-to-have, not required).
//!
//! ## Coordinate space
//! A page's canvas is an infinite plane with no inherent "paper size" or DPI, so this module
//! makes one deliberate simplifying choice: **1 page/world-space unit = 1 PDF point**, and the
//! PDF page is sized to the content's own bounding box (every object's `bounds` translated by
//! its `transform.x`/`transform.y`, padded on all sides) rather than a fixed paper size like
//! Letter/A4. `transform.rotation`/`transform.scale` are NOT applied (a rough-reconstruction
//! scope decision — see module doc comment above); only the translate component matters, since
//! that's the one non-identity value a plain move (as opposed to a resize/rotate drag) produces
//! today. World space grows Y-downward; PDF space has its origin at the bottom-left and grows
//! Y-upward, so every coordinate is flipped through [`PageSpace::to_point`].

use std::path::{Path, PathBuf};

use printpdf::{
    BuiltinFont, Color, Line, LineCapStyle, LineDashPattern, LineJoinStyle, LinePoint, Mm, Op,
    PaintMode, PdfDocument, PdfFontHandle, PdfPage, PdfSaveOptions, Point, Polygon, PolygonRing,
    Pt, RawImage, Rgb, TextItem, WindingOrder, XObjectTransform,
};
use serde_json::Value;

use renote_storage::{PageDocument, PageObjectEnvelope};

use crate::error::ExportError;
use crate::text::collect_string_leaves;

const PADDING_PT: f64 = 40.0;
const MIN_PAGE_DIMENSION_PT: f64 = 200.0;
/// The PDF spec caps a page edge at 14400pt; this stays comfortably under that even after
/// padding is added back on top.
const MAX_CONTENT_DIMENSION_PT: f64 = 14000.0;
const DEFAULT_CONTENT_WIDTH_PT: f64 = 600.0;
const DEFAULT_CONTENT_HEIGHT_PT: f64 = 800.0;
const BODY_FONT_SIZE_PT: f32 = 12.0;
const PLACEHOLDER_FONT_SIZE_PT: f32 = 10.0;
const ELLIPSE_SEGMENTS: usize = 32;

/// Renders one page's objects as a single-page PDF byte stream.
pub fn export_page_to_pdf(page: &PageDocument, section_dir: &Path) -> Result<Vec<u8>, ExportError> {
    let mut doc = PdfDocument::new(&page.page.title);
    let pdf_page = build_pdf_page(&mut doc, page, section_dir)?;
    let mut warnings = Vec::new();
    let bytes = doc.with_pages(vec![pdf_page]).save(&PdfSaveOptions::default(), &mut warnings);
    Ok(bytes)
}

/// Batch export: one PDF page per `(PageDocument, section_dir)` pair, in the given order.
/// Section/notebook export is "collect every page in scope (in display order), call this" —
/// the collection walk itself lives in `renote-commands` (this crate has no notion of a section
/// or notebook tree, only individual pages).
pub fn export_pages_to_pdf(pages: &[(PageDocument, PathBuf)]) -> Result<Vec<u8>, ExportError> {
    let title = pages.first().map(|(p, _)| p.page.title.as_str()).unwrap_or("reNote Export");
    let mut doc = PdfDocument::new(title);
    let mut pdf_pages = Vec::with_capacity(pages.len());
    for (page, section_dir) in pages {
        pdf_pages.push(build_pdf_page(&mut doc, page, section_dir)?);
    }
    let mut warnings = Vec::new();
    let bytes = doc.with_pages(pdf_pages).save(&PdfSaveOptions::default(), &mut warnings);
    Ok(bytes)
}

fn build_pdf_page(
    doc: &mut PdfDocument,
    page: &PageDocument,
    section_dir: &Path,
) -> Result<PdfPage, ExportError> {
    let space = content_page_space(page);
    let mut ops = Vec::new();

    if let Some(color) = page.page.background.color.as_deref() {
        push_background_fill(&mut ops, &space, color);
    }

    // Low-to-high z-index, mirroring how the live PixiJS renderer stacks objects
    // (`view.zIndex = object.transform.zIndex`).
    let mut objects: Vec<&PageObjectEnvelope> = page.objects.iter().collect();
    objects.sort_by(|a, b| {
        a.transform.z_index.partial_cmp(&b.transform.z_index).unwrap_or(std::cmp::Ordering::Equal)
    });

    for object in objects {
        draw_object(doc, &mut ops, object, section_dir, &space)?;
    }

    Ok(PdfPage::new(Mm::from(Pt(space.width_pt as f32)), Mm::from(Pt(space.height_pt as f32)), ops))
}

/// Maps a page's content bounding box onto one PDF page's coordinate space, with `PADDING_PT` of
/// margin on every side.
struct PageSpace {
    min_x: f64,
    min_y: f64,
    width_pt: f64,
    height_pt: f64,
}

impl PageSpace {
    /// World point -> PDF point (bottom-left origin, Y-up).
    fn to_point(&self, x: f64, y: f64) -> Point {
        Point {
            x: Pt((PADDING_PT + (x - self.min_x)) as f32),
            y: Pt((self.height_pt - PADDING_PT - (y - self.min_y)) as f32),
        }
    }

    fn line_point(&self, x: f64, y: f64) -> LinePoint {
        LinePoint { p: self.to_point(x, y), bezier: false }
    }
}

/// Computes the PDF page's coordinate space from the union of every object's `bounds`
/// (translated by `transform.x`/`transform.y` — see module doc comment on why rotation/scale
/// are not folded in). An empty page (no objects) falls back to a fixed default canvas size
/// rather than producing a degenerate near-zero-area PDF page.
fn content_page_space(page: &PageDocument) -> PageSpace {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;

    for object in &page.objects {
        let x0 = object.bounds.x + object.transform.x;
        let y0 = object.bounds.y + object.transform.y;
        let x1 = x0 + object.bounds.width;
        let y1 = y0 + object.bounds.height;
        min_x = min_x.min(x0);
        min_y = min_y.min(y0);
        max_x = max_x.max(x1);
        max_y = max_y.max(y1);
    }

    if !min_x.is_finite() {
        return PageSpace {
            min_x: 0.0,
            min_y: 0.0,
            width_pt: DEFAULT_CONTENT_WIDTH_PT + 2.0 * PADDING_PT,
            height_pt: DEFAULT_CONTENT_HEIGHT_PT + 2.0 * PADDING_PT,
        };
    }

    let width = (max_x - min_x).clamp(1.0, MAX_CONTENT_DIMENSION_PT);
    let height = (max_y - min_y).clamp(1.0, MAX_CONTENT_DIMENSION_PT);

    PageSpace {
        min_x,
        min_y,
        width_pt: (width + 2.0 * PADDING_PT).max(MIN_PAGE_DIMENSION_PT),
        height_pt: (height + 2.0 * PADDING_PT).max(MIN_PAGE_DIMENSION_PT),
    }
}

fn push_background_fill(ops: &mut Vec<Op>, space: &PageSpace, color: &str) {
    ops.push(Op::SetFillColor { col: parse_hex_color(color) });
    let ring = PolygonRing {
        points: vec![
            LinePoint { p: Point { x: Pt(0.0), y: Pt(0.0) }, bezier: false },
            LinePoint { p: Point { x: Pt(space.width_pt as f32), y: Pt(0.0) }, bezier: false },
            LinePoint {
                p: Point { x: Pt(space.width_pt as f32), y: Pt(space.height_pt as f32) },
                bezier: false,
            },
            LinePoint { p: Point { x: Pt(0.0), y: Pt(space.height_pt as f32) }, bezier: false },
        ],
    };
    ops.push(Op::DrawPolygon {
        polygon: Polygon {
            rings: vec![ring],
            mode: PaintMode::Fill,
            winding_order: WindingOrder::NonZero,
        },
    });
}

fn draw_object(
    doc: &mut PdfDocument,
    ops: &mut Vec<Op>,
    object: &PageObjectEnvelope,
    section_dir: &Path,
    space: &PageSpace,
) -> Result<(), ExportError> {
    let ox = object.transform.x;
    let oy = object.transform.y;
    match object.r#type.as_str() {
        "ink-stroke" => draw_ink_stroke(ops, object, section_dir, space, ox, oy)?,
        "shape" => draw_shape(ops, object, space, ox, oy),
        "text-box" => draw_text_box(ops, object, space, ox, oy),
        "image" => draw_image(doc, ops, object, section_dir, space, ox, oy)?,
        "table" => draw_placeholder(ops, object, space, ox, oy, "[table]"),
        "file-attachment" => {
            let label = object
                .data
                .get("fileName")
                .and_then(Value::as_str)
                .map(|name| format!("[attachment: {name}]"))
                .unwrap_or_else(|| "[attachment]".to_string());
            draw_placeholder(ops, object, space, ox, oy, &label);
        }
        "audio-clip" => {
            let label = object
                .data
                .get("durationSeconds")
                .and_then(Value::as_f64)
                .map(|seconds| format!("[audio {}]", format_mm_ss(seconds)))
                .unwrap_or_else(|| "[audio clip]".to_string());
            draw_placeholder(ops, object, space, ox, oy, &label);
        }
        other => draw_placeholder(ops, object, space, ox, oy, &format!("[{other}]")),
    }
    Ok(())
}

/// `ink-stroke`: reads the raw `[x, y, pressure]` points via `renote_storage::read_stroke_blob`
/// and draws a single-width polyline through them — not the live renderer's Catmull-Rom-smoothed,
/// pressure-tapered, per-point-circle-stamped stroke (see `ink-stroke-object-type.ts`'s
/// `drawStroke`). A lone single-point stroke (a tap, no drag) draws as a small filled circle
/// instead of a zero-length line, so it isn't invisible in the export.
fn draw_ink_stroke(
    ops: &mut Vec<Op>,
    object: &PageObjectEnvelope,
    section_dir: &Path,
    space: &PageSpace,
    ox: f64,
    oy: f64,
) -> Result<(), ExportError> {
    let Some(asset_path) = object.data.get("pointDataAssetPath").and_then(Value::as_str) else {
        return Ok(());
    };
    let color = object.data.get("color").and_then(Value::as_str).unwrap_or("#000000");
    let width = object.data.get("width").and_then(Value::as_f64).unwrap_or(2.0).max(0.5);

    let points = renote_storage::read_stroke_blob(section_dir, asset_path)?;
    if points.is_empty() {
        return Ok(());
    }

    if points.len() == 1 {
        let (x, y, _pressure) = points[0];
        ops.push(Op::SetFillColor { col: parse_hex_color(color) });
        let ring = ellipse_ring(space, x as f64 + ox, y as f64 + oy, width, width);
        ops.push(Op::DrawPolygon {
            polygon: Polygon {
                rings: vec![ring],
                mode: PaintMode::Fill,
                winding_order: WindingOrder::NonZero,
            },
        });
        return Ok(());
    }

    ops.push(Op::SetOutlineColor { col: parse_hex_color(color) });
    ops.push(Op::SetOutlineThickness { pt: Pt(width as f32) });
    ops.push(Op::SetLineCapStyle { cap: LineCapStyle::Round });
    ops.push(Op::SetLineJoinStyle { join: LineJoinStyle::Round });
    let line_points: Vec<LinePoint> = points
        .iter()
        .map(|(x, y, _pressure)| space.line_point(*x as f64 + ox, *y as f64 + oy))
        .collect();
    ops.push(Op::DrawLine { line: Line { points: line_points, is_closed: false } });
    Ok(())
}

/// `shape`: rectangle/ellipse/line/arrow per `ShapeData.kind`. Ellipse is approximated as a
/// `ELLIPSE_SEGMENTS`-sided polygon (printpdf has no native ellipse primitive). Arrow draws the
/// shaft as a plain line plus a simple two-stroke "V" arrowhead at the end point — not a filled
/// triangular head.
fn draw_shape(ops: &mut Vec<Op>, object: &PageObjectEnvelope, space: &PageSpace, ox: f64, oy: f64) {
    let kind = object.data.get("kind").and_then(Value::as_str).unwrap_or("rectangle");
    let stroke_color = object.data.get("strokeColor").and_then(Value::as_str).unwrap_or("#000000");
    let stroke_width =
        object.data.get("strokeWidth").and_then(Value::as_f64).unwrap_or(2.0).max(0.5);
    let fill_color = object.data.get("fillColor").and_then(Value::as_str);

    let x = object.bounds.x + ox;
    let y = object.bounds.y + oy;
    let w = object.bounds.width;
    let h = object.bounds.height;

    ops.push(Op::SetOutlineColor { col: parse_hex_color(stroke_color) });
    ops.push(Op::SetOutlineThickness { pt: Pt(stroke_width as f32) });
    if let Some(fill) = fill_color {
        ops.push(Op::SetFillColor { col: parse_hex_color(fill) });
    }
    let mode = if fill_color.is_some() { PaintMode::FillStroke } else { PaintMode::Stroke };

    match kind {
        "ellipse" => {
            let ring = ellipse_ring(space, x + w / 2.0, y + h / 2.0, w / 2.0, h / 2.0);
            ops.push(Op::DrawPolygon {
                polygon: Polygon { rings: vec![ring], mode, winding_order: WindingOrder::NonZero },
            });
        }
        "line" | "arrow" => {
            let (sx, sy) = read_point(&object.data, "startPoint").unwrap_or((x, y));
            let (ex, ey) = read_point(&object.data, "endPoint").unwrap_or((x + w, y + h));
            let (sx, sy) = (sx + ox, sy + oy);
            let (ex, ey) = (ex + ox, ey + oy);
            ops.push(Op::DrawLine {
                line: Line {
                    points: vec![space.line_point(sx, sy), space.line_point(ex, ey)],
                    is_closed: false,
                },
            });
            if kind == "arrow" {
                push_arrowhead(ops, space, sx, sy, ex, ey);
            }
        }
        // "rectangle" and any future/unrecognized kind fall back to a rectangle outline.
        _ => {
            let ring = PolygonRing {
                points: vec![
                    space.line_point(x, y),
                    space.line_point(x + w, y),
                    space.line_point(x + w, y + h),
                    space.line_point(x, y + h),
                ],
            };
            ops.push(Op::DrawPolygon {
                polygon: Polygon { rings: vec![ring], mode, winding_order: WindingOrder::NonZero },
            });
        }
    }
}

fn read_point(data: &Value, key: &str) -> Option<(f64, f64)> {
    let point = data.get(key)?;
    Some((point.get("x")?.as_f64()?, point.get("y")?.as_f64()?))
}

/// Draws a simple two-segment "V" arrowhead at `(ex, ey)`, pointing back along the shaft
/// direction from `(sx, sy)` — a rough stand-in for the live renderer's filled triangular head.
fn push_arrowhead(ops: &mut Vec<Op>, space: &PageSpace, sx: f64, sy: f64, ex: f64, ey: f64) {
    const HEAD_LEN: f64 = 10.0;
    const HEAD_SPREAD_RADIANS: f64 = 0.5;

    let dx = ex - sx;
    let dy = ey - sy;
    let len = (dx * dx + dy * dy).sqrt();
    if len < 1e-6 {
        return;
    }
    let ux = dx / len;
    let uy = dy / len;

    for sign in [-1.0_f64, 1.0] {
        let angle = HEAD_SPREAD_RADIANS * sign;
        let (sin_a, cos_a) = angle.sin_cos();
        let rx = ux * cos_a - uy * sin_a;
        let ry = ux * sin_a + uy * cos_a;
        let wing_x = ex - rx * HEAD_LEN;
        let wing_y = ey - ry * HEAD_LEN;
        ops.push(Op::DrawLine {
            line: Line {
                points: vec![space.line_point(ex, ey), space.line_point(wing_x, wing_y)],
                is_closed: false,
            },
        });
    }
}

/// `text-box`: plain text at the object's top-left, one line, no wrapping/bold/italic/color —
/// see `crate::text::collect_string_leaves`'s doc comment for why a generic JSON string-leaf
/// walk is used instead of a typed `RichTextDocument` decode (paragraph/line breaks are lost in
/// that walk, same simplification `renote-index`'s search text extraction already accepts).
fn draw_text_box(
    ops: &mut Vec<Op>,
    object: &PageObjectEnvelope,
    space: &PageSpace,
    ox: f64,
    oy: f64,
) {
    let mut parts = Vec::new();
    collect_string_leaves(&object.data, &mut parts);
    let text = parts.join(" ");
    if text.trim().is_empty() {
        return;
    }

    // Baseline near the top of the box, roughly matching where a text editor's first line
    // starts.
    let baseline_y = object.bounds.y + oy + BODY_FONT_SIZE_PT as f64;
    let origin = space.to_point(object.bounds.x + ox, baseline_y);

    ops.push(Op::StartTextSection);
    ops.push(Op::SetTextCursor { pos: origin });
    ops.push(Op::SetFont {
        font: PdfFontHandle::Builtin(BuiltinFont::Helvetica),
        size: Pt(BODY_FONT_SIZE_PT),
    });
    ops.push(Op::SetLineHeight { lh: Pt(BODY_FONT_SIZE_PT) });
    ops.push(Op::SetFillColor { col: black() });
    ops.push(Op::ShowText { items: vec![TextItem::Text(text)] });
    ops.push(Op::EndTextSection);
}

/// `image`: reads the asset's raw bytes via `renote_storage::read_asset`, decodes it, and embeds
/// it scaled to exactly fill `bounds` (aspect ratio not preserved if `bounds` and the image's
/// natural size disagree — matches how the live renderer stretches a resized image object).
/// `ImageData.cropRect` is not applied (documented scope simplification — the full uncropped
/// image is always embedded).
fn draw_image(
    doc: &mut PdfDocument,
    ops: &mut Vec<Op>,
    object: &PageObjectEnvelope,
    section_dir: &Path,
    space: &PageSpace,
    ox: f64,
    oy: f64,
) -> Result<(), ExportError> {
    let Some(asset_path) = object.data.get("assetPath").and_then(Value::as_str) else {
        return Ok(());
    };
    let bytes = renote_storage::read_asset(section_dir, asset_path)?;
    let mut warnings = Vec::new();
    let image = RawImage::decode_from_bytes(&bytes, &mut warnings)
        .map_err(|message| ExportError::Image { path: asset_path.to_string(), message })?;
    if image.width == 0 || image.height == 0 {
        return Ok(());
    }

    let image_id = doc.add_image(&image);
    let x = object.bounds.x + ox;
    let y = object.bounds.y + oy;
    // The image's PDF placement origin is its bottom-left corner in PDF space, which is the
    // world-space point (x, y + height) — the bottom edge in Y-down world space.
    let bottom_left = space.to_point(x, y + object.bounds.height);

    ops.push(Op::UseXobject {
        id: image_id,
        transform: XObjectTransform {
            translate_x: Some(bottom_left.x),
            translate_y: Some(bottom_left.y),
            // dpi=72 makes 1 image pixel == 1 PDF point before scale_x/scale_y, so those two
            // fields alone stretch the image to exactly `bounds`' size.
            dpi: Some(72.0),
            scale_x: Some((object.bounds.width / image.width as f64) as f32),
            scale_y: Some((object.bounds.height / image.height as f64) as f32),
            ..Default::default()
        },
    });
    Ok(())
}

/// `table`/`file-attachment`/`audio-clip`/any unrecognized type: a dashed bordered box with a
/// text label — no attempt at rendering table grid lines, waveforms, or file-type icons.
fn draw_placeholder(
    ops: &mut Vec<Op>,
    object: &PageObjectEnvelope,
    space: &PageSpace,
    ox: f64,
    oy: f64,
    label: &str,
) {
    let x = object.bounds.x + ox;
    let y = object.bounds.y + oy;
    let w = object.bounds.width.max(1.0);
    let h = object.bounds.height.max(1.0);

    let ring = PolygonRing {
        points: vec![
            space.line_point(x, y),
            space.line_point(x + w, y),
            space.line_point(x + w, y + h),
            space.line_point(x, y + h),
        ],
    };
    ops.push(Op::SetOutlineColor { col: gray() });
    ops.push(Op::SetOutlineThickness { pt: Pt(1.0) });
    ops.push(Op::SetLineDashPattern { dash: LineDashPattern::new(0.0, &[4.0, 3.0]) });
    ops.push(Op::DrawPolygon {
        polygon: Polygon {
            rings: vec![ring],
            mode: PaintMode::Stroke,
            winding_order: WindingOrder::NonZero,
        },
    });
    // Reset the dash pattern so it doesn't leak into whatever's drawn after this placeholder.
    ops.push(Op::SetLineDashPattern { dash: LineDashPattern::new(0.0, &[]) });

    let text_origin = space.to_point(x + 4.0, y + h / 2.0);
    ops.push(Op::StartTextSection);
    ops.push(Op::SetTextCursor { pos: text_origin });
    ops.push(Op::SetFont {
        font: PdfFontHandle::Builtin(BuiltinFont::Helvetica),
        size: Pt(PLACEHOLDER_FONT_SIZE_PT),
    });
    ops.push(Op::SetLineHeight { lh: Pt(PLACEHOLDER_FONT_SIZE_PT) });
    ops.push(Op::SetFillColor { col: gray() });
    ops.push(Op::ShowText { items: vec![TextItem::Text(label.to_string())] });
    ops.push(Op::EndTextSection);
}

/// Formats a duration in seconds as `mm:ss`, e.g. `3.5` -> `"00:03"`. Negative/non-finite input
/// (malformed data, never produced by the recorder itself) clamps to zero rather than panicking.
fn format_mm_ss(seconds: f64) -> String {
    let total_seconds =
        if seconds.is_finite() && seconds > 0.0 { seconds.round() as u64 } else { 0 };
    format!("{:02}:{:02}", total_seconds / 60, total_seconds % 60)
}

fn ellipse_ring(space: &PageSpace, cx: f64, cy: f64, rx: f64, ry: f64) -> PolygonRing {
    let mut points = Vec::with_capacity(ELLIPSE_SEGMENTS);
    for i in 0..ELLIPSE_SEGMENTS {
        let theta = (i as f64) / (ELLIPSE_SEGMENTS as f64) * std::f64::consts::TAU;
        points.push(space.line_point(cx + rx * theta.cos(), cy + ry * theta.sin()));
    }
    PolygonRing { points }
}

fn black() -> Color {
    Color::Rgb(Rgb { r: 0.0, g: 0.0, b: 0.0, icc_profile: None })
}

fn gray() -> Color {
    Color::Rgb(Rgb { r: 0.45, g: 0.45, b: 0.45, icc_profile: None })
}

/// Parses a `#rgb`/`#rrggbb` hex color string (the only format any built-in tool in this app
/// ever produces — pen/highlighter/shape defaults are hex constants, and the `<input
/// type="color">` swatch picker always emits `#rrggbb` — see `register-built-ins.ts`). Any other
/// CSS color syntax (named colors, `rgb(...)`, ...) falls back to black rather than failing the
/// whole export over one unparseable object.
fn parse_hex_color(value: &str) -> Color {
    let hex = value.trim_start_matches('#');
    let channel = |slice: &str| u8::from_str_radix(slice, 16).unwrap_or(0);

    let (r, g, b) = match hex.len() {
        6 => (channel(&hex[0..2]), channel(&hex[2..4]), channel(&hex[4..6])),
        3 => {
            let double = |c: char| -> u8 {
                let s: String = std::iter::repeat_n(c, 2).collect();
                channel(&s)
            };
            let mut chars = hex.chars();
            (
                double(chars.next().unwrap_or('0')),
                double(chars.next().unwrap_or('0')),
                double(chars.next().unwrap_or('0')),
            )
        }
        _ => (0, 0, 0),
    };

    Color::Rgb(Rgb {
        r: r as f32 / 255.0,
        g: g as f32 / 255.0,
        b: b as f32 / 255.0,
        icc_profile: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use renote_storage::{Bounds, PageBackground, PageRuleLines, Transform2D};
    use serde_json::json;

    const PDF_MAGIC: &[u8] = b"%PDF-";

    fn transform() -> Transform2D {
        Transform2D { x: 0.0, y: 0.0, rotation: 0.0, scale_x: 1.0, scale_y: 1.0, z_index: 0.0 }
    }

    fn bounds(x: f64, y: f64, width: f64, height: f64) -> Bounds {
        Bounds { x, y, width, height }
    }

    fn page_with(objects: Vec<PageObjectEnvelope>) -> PageDocument {
        PageDocument {
            page: renote_storage::Page {
                id: "page-1".to_string(),
                section_id: "section-1".to_string(),
                parent_page_id: None,
                order_key: "a0".to_string(),
                title: "Test Page".to_string(),
                background: PageBackground {
                    color: Some("#ffffff".to_string()),
                    rule_lines: PageRuleLines::None,
                },
                template_id: None,
                created_at: "2024-01-01T00:00:00Z".to_string(),
                modified_at: "2024-01-01T00:00:00Z".to_string(),
                schema_version: 1,
            },
            objects,
        }
    }

    fn assert_valid_pdf(bytes: &[u8]) {
        assert!(!bytes.is_empty(), "PDF bytes must be non-empty");
        assert!(bytes.starts_with(PDF_MAGIC), "PDF bytes must start with the %PDF- magic bytes");
    }

    #[test]
    fn empty_page_still_produces_a_valid_pdf() {
        let dir = tempfile::tempdir().expect("tempdir");
        let page = page_with(vec![]);
        let bytes = export_page_to_pdf(&page, dir.path()).expect("export");
        assert_valid_pdf(&bytes);
    }

    #[test]
    fn ink_stroke_object_exports_to_a_valid_pdf() {
        let dir = tempfile::tempdir().expect("tempdir");
        let relative_path = renote_storage::write_stroke_blob(
            dir.path(),
            "page-1",
            "stroke-1",
            &[(0.0, 0.0, 1.0), (50.0, 50.0, 1.0)],
        )
        .expect("write_stroke_blob");

        let object = PageObjectEnvelope {
            id: "obj-1".to_string(),
            r#type: "ink-stroke".to_string(),
            transform: transform(),
            bounds: bounds(0.0, 0.0, 50.0, 50.0),
            data: json!({ "tool": "pen", "color": "#ff0000", "width": 2.0, "pointDataAssetPath": relative_path }),
        };

        let page = page_with(vec![object]);
        let bytes = export_page_to_pdf(&page, dir.path()).expect("export");
        assert_valid_pdf(&bytes);
    }

    #[test]
    fn single_point_ink_stroke_exports_to_a_valid_pdf() {
        let dir = tempfile::tempdir().expect("tempdir");
        let relative_path = renote_storage::write_stroke_blob(
            dir.path(),
            "page-1",
            "stroke-1",
            &[(10.0, 10.0, 1.0)],
        )
        .expect("write_stroke_blob");

        let object = PageObjectEnvelope {
            id: "obj-1".to_string(),
            r#type: "ink-stroke".to_string(),
            transform: transform(),
            bounds: bounds(9.0, 9.0, 2.0, 2.0),
            data: json!({ "tool": "pen", "color": "#000000", "width": 2.0, "pointDataAssetPath": relative_path }),
        };

        let bytes = export_page_to_pdf(&page_with(vec![object]), dir.path()).expect("export");
        assert_valid_pdf(&bytes);
    }

    #[test]
    fn every_shape_kind_exports_to_a_valid_pdf() {
        let dir = tempfile::tempdir().expect("tempdir");
        let kinds = ["rectangle", "ellipse", "line", "arrow"];
        let objects: Vec<PageObjectEnvelope> = kinds
            .iter()
            .enumerate()
            .map(|(i, kind)| PageObjectEnvelope {
                id: format!("obj-{i}"),
                r#type: "shape".to_string(),
                transform: transform(),
                bounds: bounds(i as f64 * 100.0, 0.0, 80.0, 60.0),
                data: json!({
                    "kind": kind,
                    "strokeColor": "#000000",
                    "strokeWidth": 2.0,
                    "fillColor": "#00ff00",
                    "startPoint": { "x": i as f64 * 100.0, "y": 0.0 },
                    "endPoint": { "x": i as f64 * 100.0 + 80.0, "y": 60.0 },
                }),
            })
            .collect();

        let bytes = export_page_to_pdf(&page_with(objects), dir.path()).expect("export");
        assert_valid_pdf(&bytes);
    }

    #[test]
    fn text_box_object_exports_to_a_valid_pdf() {
        let dir = tempfile::tempdir().expect("tempdir");
        let object = PageObjectEnvelope {
            id: "obj-1".to_string(),
            r#type: "text-box".to_string(),
            transform: transform(),
            bounds: bounds(0.0, 0.0, 200.0, 50.0),
            data: json!({ "content": { "paragraphs": [{ "runs": [{ "text": "Hello world", "marks": [] }], "listKind": "none", "indentLevel": 0, "tagId": null }] } }),
        };

        let bytes = export_page_to_pdf(&page_with(vec![object]), dir.path()).expect("export");
        assert_valid_pdf(&bytes);
    }

    #[test]
    fn image_object_exports_to_a_valid_pdf() {
        let dir = tempfile::tempdir().expect("tempdir");
        // A minimal valid 1x1 PNG (solid red, RGBA).
        let png_bytes: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
            0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0xF0, 0x1F, 0x00, 0x05, 0x00, 0x01, 0xFF, 0x89, 0x99,
            0x3D, 0x1D, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        let asset_path = renote_storage::write_asset(dir.path(), "page-1", "pixel.png", png_bytes)
            .expect("write_asset");

        let object = PageObjectEnvelope {
            id: "obj-1".to_string(),
            r#type: "image".to_string(),
            transform: transform(),
            bounds: bounds(0.0, 0.0, 100.0, 100.0),
            data: json!({ "assetPath": asset_path, "naturalWidth": 1, "naturalHeight": 1, "cropRect": null }),
        };

        let bytes = export_page_to_pdf(&page_with(vec![object]), dir.path()).expect("export");
        assert_valid_pdf(&bytes);
    }

    #[test]
    fn table_file_attachment_and_audio_clip_placeholders_export_to_a_valid_pdf() {
        let dir = tempfile::tempdir().expect("tempdir");
        let objects = vec![
            PageObjectEnvelope {
                id: "table-1".to_string(),
                r#type: "table".to_string(),
                transform: transform(),
                bounds: bounds(0.0, 0.0, 100.0, 60.0),
                data: json!({ "columnWidths": [50.0], "rowHeights": [30.0], "cells": [[null]], "mergedRanges": [] }),
            },
            PageObjectEnvelope {
                id: "attachment-1".to_string(),
                r#type: "file-attachment".to_string(),
                transform: transform(),
                bounds: bounds(0.0, 100.0, 100.0, 40.0),
                data: json!({ "assetPath": "assets/page-1/file.pdf", "fileName": "notes.pdf", "fileSizeBytes": 100, "mimeType": "application/pdf" }),
            },
            PageObjectEnvelope {
                id: "audio-1".to_string(),
                r#type: "audio-clip".to_string(),
                transform: transform(),
                bounds: bounds(0.0, 200.0, 100.0, 40.0),
                data: json!({ "assetPath": "assets/page-1/clip.wav", "durationSeconds": 3.5 }),
            },
        ];

        let bytes = export_page_to_pdf(&page_with(objects), dir.path()).expect("export");
        assert_valid_pdf(&bytes);
    }

    #[test]
    fn export_pages_to_pdf_batches_multiple_pages() {
        let dir = tempfile::tempdir().expect("tempdir");
        let page_a = page_with(vec![]);
        let mut page_b = page_with(vec![]);
        page_b.page.id = "page-2".to_string();
        page_b.page.title = "Second Page".to_string();

        let bytes = export_pages_to_pdf(&[
            (page_a, dir.path().to_path_buf()),
            (page_b, dir.path().to_path_buf()),
        ])
        .expect("export");
        assert_valid_pdf(&bytes);
    }

    #[test]
    fn export_pages_to_pdf_of_an_empty_slice_still_produces_a_valid_pdf() {
        let bytes = export_pages_to_pdf(&[]).expect("export");
        assert_valid_pdf(&bytes);
    }

    #[test]
    fn hex_color_parsing_handles_3_and_6_digit_forms() {
        let Color::Rgb(rgb6) = parse_hex_color("#ff0000") else { panic!("expected Rgb") };
        assert_eq!((rgb6.r, rgb6.g, rgb6.b), (1.0, 0.0, 0.0));

        let Color::Rgb(rgb3) = parse_hex_color("#f00") else { panic!("expected Rgb") };
        assert_eq!((rgb3.r, rgb3.g, rgb3.b), (1.0, 0.0, 0.0));
    }
}
