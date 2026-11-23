import type { PageDocumentDto, PageObjectDto } from "@renote/storage-client";

// Port of the old Rust `renote-export` crate: Markdown, plain text, and a printable SVG
// reconstruction of a page that the browser's print dialog turns into a PDF.

type Json = Record<string, unknown>;
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asNumber = (value: unknown): number => (typeof value === "number" ? value : 0);

const escapeMd = (text: string) => text.replace(/[\\*_`[\]]/g, (c) => `\\${c}`);

function markAttr(marks: Json[], kind: string, field: string): string | undefined {
  const value = marks.find((mark) => mark.kind === kind)?.[field];
  return typeof value === "string" ? value : undefined;
}

function runToMarkdown(run: unknown): string {
  const r = (run ?? {}) as Json;
  if (r.kind === "image") return `![${asString(r.alt)}](${asString(r.src)})`;
  const text = asString(r.text);
  const marks = asArray(r.marks) as Json[];
  const has = (kind: string) => marks.some((mark) => mark.kind === kind);
  let out = has("code") ? `\`${text}\`` : escapeMd(text);
  if (has("strikethrough")) out = `~~${out}~~`;
  if (has("italic")) out = `*${out}*`;
  if (has("bold")) out = `**${out}**`;
  const wikilink = markAttr(marks, "wikilink", "attr2");
  const href = markAttr(marks, "link", "attr");
  if (wikilink !== undefined) out = `[[${wikilink}]]`;
  else if (href !== undefined) out = `[${out}](${href})`;
  return out;
}

function paragraphToMarkdown(paragraph: unknown): string {
  const p = (paragraph ?? {}) as Json;
  const text = asArray(p.runs).map(runToMarkdown).join("");
  const heading = asNumber(p.headingLevel);
  const indent = "  ".repeat(asNumber(p.indentLevel));
  let line =
    heading >= 1 && heading <= 6
      ? `${"#".repeat(heading)} ${text}`
      : p.listKind === "bulleted"
        ? `${indent}- ${text}`
        : p.listKind === "numbered"
          ? `${indent}1. ${text}`
          : text;
  for (let i = 0; i < asNumber(p.blockquoteDepth); i++) line = `> ${line}`;
  return line;
}

function blockToMarkdown(block: unknown): string {
  const b = (block ?? {}) as Json;
  if (b.kind === "codeBlock") return `\`\`\`${asString(b.language)}\n${asString(b.text)}\n\`\`\``;
  if (b.kind === "table") {
    const headerRows = asNumber(b.headerRowCount);
    return asArray(b.rows)
      .flatMap((row, index) => {
        const cells = asArray((row as Json).cells).map(paragraphToMarkdown);
        const line = `| ${cells.join(" | ")} |`;
        return index + 1 === headerRows ? [line, `| ${cells.map(() => "---").join(" | ")} |`] : [line];
      })
      .join("\n");
  }
  return paragraphToMarkdown(block);
}

function textBoxMarkdown(object: PageObjectDto): string | null {
  if (object.type !== "text-box") return null;
  const content = (object.data as Json | null)?.content;
  if (typeof content === "string") return content.trim() ? escapeMd(content) : null;
  const paragraphs = (content as Json | null)?.paragraphs;
  if (!Array.isArray(paragraphs)) return null;
  const joined = paragraphs.map(blockToMarkdown).join("\n");
  return joined.trim() ? joined : null;
}

export function pageMarkdown(page: PageDocumentDto): string {
  const parts = [`# ${page.title}`];
  for (const object of page.objects) {
    const md = textBoxMarkdown(object);
    if (md) parts.push(md);
  }
  return parts.join("\n\n");
}

export const pagesMarkdown = (pages: PageDocumentDto[]) => pages.map(pageMarkdown).join("\n\n---\n\n");

const runsText = (block: unknown) =>
  asArray((block as Json | null)?.runs)
    .map((run) => asString((run as Json | null)?.text))
    .join("");

function blockPlainText(block: unknown): string {
  const b = (block ?? {}) as Json;
  if (b.kind === "codeBlock") return asString(b.text);
  if (b.kind === "table")
    return asArray(b.rows)
      .map((row) =>
        asArray((row as Json).cells)
          .map(runsText)
          .join("\t"),
      )
      .join("\n");
  return runsText(block);
}

/** All text a page holds (title + every text box) — also what search and "related pages" match. */
export function pagePlainText(page: PageDocumentDto): string {
  const blocks = [page.title];
  for (const object of page.objects) {
    if (object.type !== "text-box") continue;
    const content = (object.data as Json | null)?.content;
    const text =
      typeof content === "string"
        ? content
        : asArray((content as Json | null)?.paragraphs)
            .map(blockPlainText)
            .join("\n");
    if (text.trim()) blocks.push(text);
  }
  return blocks.join("\n\n");
}

const escapeXml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const PADDING = 40;

/** One page as a standalone SVG — a rough reconstruction (no ink smoothing, no image crop), same
 *  scope the old Rust PDF exporter had. `assetUrl` maps an `assetPath` to a loadable URL. */
function pageSvg(page: PageDocumentDto, assetUrl: (assetPath: string) => string | undefined): string {
  const objects = [...page.objects].sort((a, b) => a.transform.zIndex - b.transform.zIndex);
  let minX = 0, minY = 0, maxX = 200, maxY = 200; // prettier-ignore
  if (objects.length > 0) {
    minX = Math.min(...objects.map((o) => o.bounds.x + o.transform.x));
    minY = Math.min(...objects.map((o) => o.bounds.y + o.transform.y));
    maxX = Math.max(...objects.map((o) => o.bounds.x + o.transform.x + o.bounds.width));
    maxY = Math.max(...objects.map((o) => o.bounds.y + o.transform.y + o.bounds.height));
  }
  const viewBox = [minX - PADDING, minY - PADDING, maxX - minX + 2 * PADDING, maxY - minY + 2 * PADDING];

  const body = objects
    .map((object) => {
      const { bounds: b, transform: t } = object;
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const g = `translate(${cx + t.x} ${cy + t.y}) rotate(${(t.rotation * 180) / Math.PI}) scale(${t.scaleX} ${t.scaleY}) translate(${-cx} ${-cy})`;
      return `<g transform="${g}">${objectSvg(object, assetUrl)}</g>`;
    })
    .join("");
  const fill = page.background.color ?? "#ffffff";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(" ")}"><rect x="${viewBox[0]}" y="${viewBox[1]}" width="${viewBox[2]}" height="${viewBox[3]}" fill="${escapeXml(fill)}"/>${body}</svg>`;
}

function objectSvg(object: PageObjectDto, assetUrl: (assetPath: string) => string | undefined): string {
  const d = (object.data ?? {}) as Json;
  const { x, y, width, height } = object.bounds;
  switch (object.type) {
    case "ink-stroke": {
      const points = asArray(d.points) as { x: number; y: number }[];
      const opacity = d.tool === "highlighter" ? 0.4 : 1;
      return `<polyline fill="none" stroke-linecap="round" stroke-linejoin="round" stroke="${escapeXml(asString(d.color))}" stroke-width="${asNumber(d.width)}" opacity="${opacity}" points="${points.map((p) => `${p.x},${p.y}`).join(" ")}"/>`;
    }
    case "shape": {
      const stroke = `stroke="${escapeXml(asString(d.strokeColor))}" stroke-width="${asNumber(d.strokeWidth)}" fill="${d.fillColor ? escapeXml(asString(d.fillColor)) : "none"}"`;
      if (d.kind === "rectangle")
        return `<rect x="${x}" y="${y}" width="${width}" height="${height}" ${stroke}/>`;
      if (d.kind === "ellipse")
        return `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" ${stroke}/>`;
      const s = (d.startPoint as { x: number; y: number } | undefined) ?? { x, y };
      const e = (d.endPoint as { x: number; y: number } | undefined) ?? { x: x + width, y: y + height };
      let svg = `<line x1="${s.x}" y1="${s.y}" x2="${e.x}" y2="${e.y}" ${stroke}/>`;
      if (d.kind === "arrow") {
        const angle = Math.atan2(e.y - s.y, e.x - s.x);
        const len = 10 + asNumber(d.strokeWidth) * 2;
        const wing = (side: number) =>
          `${e.x - len * Math.cos(angle + side * 0.5)},${e.y - len * Math.sin(angle + side * 0.5)}`;
        svg += `<polyline points="${wing(1)} ${e.x},${e.y} ${wing(-1)}" ${stroke} fill="none"/>`;
      }
      return svg;
    }
    case "text-box": {
      const md = textBoxMarkdown(object);
      if (!md) return "";
      const lines = md
        .split("\n")
        .map((line) => `<div>${escapeXml(line) || "&#160;"}</div>`)
        .join("");
      return `<foreignObject x="${x}" y="${y}" width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" style="font:14px sans-serif;white-space:pre-wrap;overflow-wrap:anywhere">${lines}</div></foreignObject>`;
    }
    case "image": {
      const href = assetUrl(asString(d.assetPath));
      if (href)
        return `<image href="${href}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="none"/>`;
      break;
    }
  }
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="#888" stroke-dasharray="4 4"/><text x="${x + 6}" y="${y + 16}" font-size="12" fill="#888">${escapeXml(object.type)}</text>`;
}

/** A print-ready HTML document, one page per sheet. */
export function printableHtml(
  title: string,
  pages: PageDocumentDto[],
  assetUrl: (assetPath: string) => string | undefined,
): string {
  const sheets = pages
    .map((page) => `<section><h1>${escapeXml(page.title)}</h1>${pageSvg(page, assetUrl)}</section>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeXml(title)}</title><style>
body{margin:0;font-family:sans-serif}section{break-after:page;padding:16px}h1{font-size:18px;margin:0 0 8px}
svg{width:100%;height:auto;max-height:90vh}</style></head><body>${sheets}</body></html>`;
}
