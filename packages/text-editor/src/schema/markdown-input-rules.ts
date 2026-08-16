import { InputRule } from "prosemirror-inputrules";
import type { MarkType, ResolvedPos } from "prosemirror-model";
import { TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import type { ListKind } from "./marks.js";
import {
  richTextSchema,
  type CodeBlockAttrs,
  type ImageAttrs,
  type ParagraphAttrs,
} from "./prosemirror-schema.js";

/**
 * Resolves `pos` and confirms it's inside a plain paragraph textblock — every markdown-triggered
 * input rule needs this, not just the list-marker one that originally had it: once `code_block`
 * exists (schema `marks: ""`, no inline formatting), typing literal `**foo**` inside one must
 * NOT strip the `**` characters just because the regex matches; the rule has to no-op there. This
 * is also the single place that knows paragraphs sit at different depths depending on context
 * (depth 1 directly under `doc`, deeper inside a future `table_cell`) — `$pos.before($pos.depth)`
 * (the immediate parent's position, whatever depth it actually is) replaces the older, narrower
 * `before(1)` this package used before nested containers existed.
 */
function plainParagraphContext(state: EditorState, pos: number) {
  const $pos = state.doc.resolve(pos);
  return $pos.parent.type === richTextSchema.nodes.paragraph ? $pos : null;
}

/**
 * True if `matchStart` (an offset within `paragraphText`) sits after an odd number of backtick
 * characters — i.e. inside an unterminated `` `code ``  span on the same line. Delimiter-pair
 * rules (bold/italic/strikethrough/link) check this before firing: since Phase 1's rules apply
 * per keystroke, typing `` `**bold**` `` character-by-character would otherwise let the bold rule
 * fire the instant `**bold**` completes — before the closing backtick even exists — stripping the
 * `**` inside what the user intended as literal code text. The code mark's own rule doesn't need
 * this guard; backticks pairing with themselves is exactly what it's matching.
 */
function isInsideOpenBacktick(paragraphText: string, matchStart: number): boolean {
  const before = paragraphText.slice(0, matchStart);
  return (before.match(/`/g)?.length ?? 0) % 2 === 1;
}

/**
 * Toggles `markType` onto the text captured by `match[1]`, stripping the markdown delimiter
 * characters around it — e.g. typing the closing `*` of `*word*` turns it into an italic-marked
 * "word", delimiters gone. The standard `prosemirror-example-setup` `markInputRule` shape,
 * adapted for this schema's mark names (`bold`/`italic` instead of `strong`/`em`) and narrowed
 * to marks that take no attrs, which covers everything Phase 1 needs (bold/italic/strikethrough)
 * plus the inline `code` mark. `removeStoredMark` afterward stops the mark from silently
 * continuing into whatever the user types next — ProseMirror's "stored marks" would otherwise
 * carry it forward from the insertion point.
 *
 * `guardAgainstOpenCode` defaults to true (bold/italic/strikethrough/link must not fire inside
 * an unterminated `` `code ``  span) but the `code` mark's own rule passes `false` — backticks
 * pairing with themselves is exactly what that rule matches, so guarding it against itself would
 * make it unable to ever fire.
 */
function markInputRule(regexp: RegExp, markType: MarkType, guardAgainstOpenCode = true): InputRule {
  return new InputRule(regexp, (state: EditorState, match: RegExpMatchArray, start: number, end: number) => {
    const $start = plainParagraphContext(state, start);
    if (!$start) return null;
    if (guardAgainstOpenCode && isInsideOpenBacktick($start.parent.textContent, start - $start.start())) {
      return null;
    }
    const content = match[1];
    if (content === undefined) return null;
    const tr = state.tr;
    const textStart = start + match[0].indexOf(content);
    const textEnd = textStart + content.length;
    if (textEnd < end) tr.delete(textEnd, end);
    if (textStart > start) tr.delete(start, textStart);
    tr.addMark(start, start + content.length, markType.create());
    tr.removeStoredMark(markType);
    return tr;
  });
}

/**
 * Sets `listKind` on the paragraph the typed marker was in and deletes the marker text itself
 * — e.g. "- " at the start of an empty paragraph becomes that same paragraph, now bulleted, with
 * no visible marker (the bullet itself is chrome the app renders from `listKind`, same as the
 * existing UI-driven list toggle). `^` in each regexp is scoped to the *paragraph's* own start
 * (`InputRule` matches against text from the start of the current textblock to the cursor — see
 * `prosemirror-inputrules`), not the whole document, so this only fires when the marker is the
 * very first thing typed on the line, matching every other markdown editor's convention.
 */
function listMarkerInputRule(regexp: RegExp, listKind: ListKind): InputRule {
  return new InputRule(regexp, (state: EditorState, _match: RegExpMatchArray, start: number, end: number) => {
    const $start = plainParagraphContext(state, start);
    if (!$start) return null;
    const attrs: ParagraphAttrs = { ...($start.parent.attrs as ParagraphAttrs), listKind };
    return state.tr.delete(start, end).setNodeMarkup($start.before($start.depth), undefined, attrs);
  });
}

/**
 * "# " through "###### " at the start of a paragraph sets `headingLevel` to the number of `#`
 * characters typed and deletes the marker — same "structural indicator, not content" treatment
 * `listMarkerInputRule` already gives list markers. No upper re-trigger guard is needed: typing
 * "## " again on an already-heading paragraph just overwrites `headingLevel` with the new count.
 */
function headingInputRule(): InputRule {
  return new InputRule(
    /^(#{1,6})\s$/,
    (state: EditorState, match: RegExpMatchArray, start: number, end: number) => {
      const $start = plainParagraphContext(state, start);
      if (!$start) return null;
      const level = match[1]?.length;
      if (level === undefined) return null;
      const attrs: ParagraphAttrs = { ...($start.parent.attrs as ParagraphAttrs), headingLevel: level };
      return state.tr.delete(start, end).setNodeMarkup($start.before($start.depth), undefined, attrs);
    },
  );
}

/**
 * "> " at the start of a paragraph deletes the marker and increments `blockquoteDepth` by one —
 * since the marker is always deleted, retyping "> " immediately at the (now-empty-again)
 * paragraph start re-triggers, so "> > > text" typed as one continuous stream naturally nests to
 * depth 3 with no need for this rule to itself match a run of `>` characters.
 */
function blockquoteInputRule(): InputRule {
  return new InputRule(
    /^>\s$/,
    (state: EditorState, _match: RegExpMatchArray, start: number, end: number) => {
      const $start = plainParagraphContext(state, start);
      if (!$start) return null;
      const attrs = $start.parent.attrs as ParagraphAttrs;
      return state.tr.delete(start, end).setNodeMarkup($start.before($start.depth), undefined, {
        ...attrs,
        blockquoteDepth: attrs.blockquoteDepth + 1,
      });
    },
  );
}

/**
 * `[text](url)` -> a single text run reading `text`, marked with a `link` pointing at `url` —
 * same `replaceWith`-a-marked-text-node shape `ProseMirrorRichTextField.insertWikilink` already
 * uses for the structurally identical `[[wikilink]]` case.
 */
const linkInputRule = new InputRule(
  /\[([^[\]]+)\]\(([^()\s]+)\)$/,
  (state: EditorState, match: RegExpMatchArray, start: number, end: number) => {
    const $start = plainParagraphContext(state, start);
    if (!$start) return null;
    if (isInsideOpenBacktick($start.parent.textContent, start - $start.start())) return null;
    const [, text, href] = match;
    if (!text || !href) return null;
    const mark = richTextSchema.marks.link.create({ href });
    return state.tr.replaceWith(start, end, richTextSchema.text(text, [mark]));
  },
);

const HTTP_URL = /^https?:\/\//;

/**
 * `![alt](https://...)` -> an inline `image` atom node, `http(s)://` sources only — a bare
 * `![alt](./local.png)` matches this rule's regex (so `linkInputRule` never gets a turn at it,
 * see below) but isn't converted: the existing toolbar "Insert Image" action (a Tauri
 * file-dialog copying a local file into the page's asset folder) remains the only path for local
 * images, since a typed relative path has no way to resolve to an actual file from inside this
 * DOM-library-agnostic package. Returning `state.tr` (a valid, non-null *no-op* transaction) in
 * that case — rather than `null` — is what actually keeps the text literal: `null` would mean
 * "not handled," letting `prosemirror-inputrules` fall through to the next rule in the list, and
 * `linkInputRule`'s own pattern *also* matches the "[alt](url)" tail of this same text (its regex
 * isn't `^`-anchored), so a plain `null` here would let the leading "!" survive as stray text
 * while the rest silently became a link. Consuming the match with a transaction that just
 * reinserts `match[0]` verbatim — rather than an empty no-op — matters too: `prosemirror-
 * inputrules` calls this handler *before* the just-typed closing character actually lands in
 * `state.doc` (that's the whole reason handlers work from `match`'s captured text rather than
 * reading the doc), so a genuinely empty transaction would silently drop that trailing character
 * instead of leaving the text untouched. Must be registered *before* `linkInputRule` in
 * `markdownInputRules` for the ordering fix to work at all.
 */
const imageInputRule = new InputRule(
  /!\[([^[\]]*)\]\(([^()\s]+)\)$/,
  (state: EditorState, match: RegExpMatchArray, start: number, end: number) => {
    const $start = plainParagraphContext(state, start);
    if (!$start) return null;
    const [, alt, src] = match;
    if (src === undefined) return null;
    if (!HTTP_URL.test(src)) return state.tr.insertText(match[0], start, end);
    const attrs: ImageAttrs = { src, alt: alt ?? "" };
    return state.tr.replaceWith(start, end, richTextSchema.nodes.image.create(attrs));
  },
);

const PIPE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR_ROW = /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/;

/** Splits a GFM pipe row ("| a | b |") into trimmed cell strings, dropping the leading/trailing
 *  empty segments the outer `|` characters produce. Column-alignment markers (`:---`/`---:`) in
 *  a separator row are parsed by `TABLE_SEPARATOR_ROW` matching at all, but not stored — see the
 *  project plan's "Deferred" list. */
function parseTableRowCells(rowText: string): string[] {
  const trimmed = rowText.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function tableCellNode(text: string) {
  const textNode = text.length > 0 ? richTextSchema.text(text) : undefined;
  return richTextSchema.nodes.table_cell.create(null, richTextSchema.nodes.paragraph.create(null, textNode));
}

/**
 * Both table keymap commands below are Enter bindings, not `InputRule`s, for the same structural
 * reason as `startCodeBlockOnFencedLine` (recognizing "this line is now a complete row" is a
 * block-level concern, not a text-insertion one) — but here it's also a *correctness* fix, not
 * just a style choice: `TABLE_SEPARATOR_ROW`'s `(?:...)+ ` and `PIPE_ROW`'s `\|.*\|` both match on
 * a row's very first completed column, not just its last. An `InputRule` version of this fired
 * the instant `|---|` (a *one*-column separator) appeared while the user was still mid-way through
 * typing `|---|---|` — replacing the paragraph with a table right then, which left the still-
 * in-flight remaining keystrokes (`--|`, from the original insertion loop) to land at the new
 * cursor position *inside the first table cell*, corrupting its text. Binding to Enter instead
 * means the regex only ever sees a line once the user has actually finished typing it.
 */
function docLevelParagraphAt($from: ResolvedPos) {
  return $from.parent.type === richTextSchema.nodes.paragraph && $from.depth === 1 ? $from : null;
}

/**
 * A header row ("| a | b |") typed as its own paragraph, followed immediately by a separator row
 * ("|---|---|") and Enter, becomes a single-row `table` node built from the header's cells, plus
 * a trailing empty paragraph so the user isn't trapped inside the table afterward. The header row
 * is this paragraph's doc-level predecessor (read via `state.doc.child(index - 1)`, not anything
 * a regex matches) — see `appendTableRow` below for how subsequent rows get added.
 *
 * The cursor lands in that trailing paragraph, not inside the table itself: this is what makes
 * typing further pipe rows immediately afterward (the exact workflow `appendTableRow` exists for)
 * work in one continuous flow, without the user needing to manually navigate out of a header cell
 * first — `appendTableRow` only recognizes a row typed into a doc-level paragraph sitting right
 * after the table, which is exactly where this leaves the selection.
 */
export function startTableOnSeparatorRow(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const $from = docLevelParagraphAt(state.selection.$from);
  if (!$from || !TABLE_SEPARATOR_ROW.test($from.parent.textContent)) return false;
  const index = $from.index(0);
  if (index === 0) return false;
  const headerNode = state.doc.child(index - 1);
  if (headerNode.type !== richTextSchema.nodes.paragraph) return false;
  const headerText = headerNode.textContent;
  if (!PIPE_ROW.test(headerText)) return false;

  if (dispatch) {
    const headerCells = parseTableRowCells(headerText);
    const row = richTextSchema.nodes.table_row.create(null, headerCells.map(tableCellNode));
    const table = richTextSchema.nodes.table.create({ headerRowCount: 1 }, row);
    const trailingParagraph = richTextSchema.nodes.paragraph.create();

    const separatorStart = $from.before($from.depth);
    const separatorEnd = $from.after($from.depth);
    const headerStart = separatorStart - headerNode.nodeSize;

    const tr = state.tr.replaceWith(headerStart, separatorEnd, [table, trailingParagraph]);
    // headerStart + table.nodeSize = the trailing paragraph's own open token; +1 past it is the
    // start of its (empty) text content.
    const trailingParagraphContentStart = headerStart + table.nodeSize + 1;
    dispatch(tr.setSelection(TextSelection.create(tr.doc, trailingParagraphContentStart)));
  }
  return true;
}

/**
 * A GFM pipe row typed directly below an existing `table` node (its doc-level predecessor, same
 * sibling-lookup shape `startTableOnSeparatorRow` uses), followed by Enter, appends it as a new
 * `table_row` — this is how a table grows past its initial header+separator, one row at a time.
 * Mismatched column counts (more/fewer cells than the table's other rows) aren't validated or
 * padded here — see the project plan's "not fatal" note; ProseMirror simply stores whatever row
 * shape was typed.
 *
 * The triggering paragraph's *text* is cleared, but the paragraph node itself is kept (not
 * deleted) as the new trailing paragraph, and the cursor stays in it — mirroring
 * `startTableOnSeparatorRow`'s own "leave the cursor in a doc-level paragraph after the table, not
 * inside it" reasoning. Deleting that paragraph outright (an earlier version of this function did)
 * left the *next* append with nowhere but the new row's own cell content to land the cursor in,
 * which put the second appended row's pipe text inside the first row's cell instead — verified as
 * a real bug via live manual testing (this exact case has no automated repro since it only shows
 * up across *two* consecutive appends), not caught by earlier single-append tests.
 */
export function appendTableRow(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const $from = docLevelParagraphAt(state.selection.$from);
  if (!$from || !PIPE_ROW.test($from.parent.textContent)) return false;
  const index = $from.index(0);
  if (index === 0) return false;
  const tableNode = state.doc.child(index - 1);
  if (tableNode.type !== richTextSchema.nodes.table) return false;

  if (dispatch) {
    const cells = parseTableRowCells($from.parent.textContent);
    const newRow = richTextSchema.nodes.table_row.create(null, cells.map(tableCellNode));

    const rowParagraphStart = $from.before($from.depth);
    const rowParagraphEnd = $from.after($from.depth);
    // rowParagraphStart - 1 is the position just inside the table's own closing token — i.e.
    // right after its last existing row, where the new row belongs.
    const insertPos = rowParagraphStart - 1;

    let tr = state.tr;
    if (rowParagraphEnd - 1 > rowParagraphStart + 1) {
      tr = tr.delete(rowParagraphStart + 1, rowParagraphEnd - 1);
    }
    const trailingContentStart = tr.mapping.map(rowParagraphStart) + 1;
    tr = tr.insert(insertPos, newRow);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(trailingContentStart))));
  }
  return true;
}

/**
 * Live "type markdown, get rich text" shortcuts. Covers every mark/attr the schema models: bold,
 * italic, strikethrough, links, and bulleted/numbered lists. See `markdown-reveal-plugin.ts` for
 * the complementary cursor-aware "show raw symbols while editing" layer that sits on top of the
 * marks these rules apply — that plugin never mutates content, it only decorates what's already
 * here, so the two are independent and don't need to be read together to understand either one.
 */
export const markdownInputRules: InputRule[] = [
  // Bold before italic so a fully-typed `**word**` is never partially consumed by the
  // single-delimiter italic rule first — though the `(?<!\*)`/`(?<!_)` negative-lookbehind
  // guards (zero-width: unlike a `[^*]` character class, they check the preceding character
  // without pulling it into `match[0]`, so `markInputRule` below never has a stray guard
  // character to accidentally delete alongside the real delimiter) already make that
  // structurally impossible regardless of order — an opening single star/underscore
  // immediately preceded by another one never satisfies the guard.
  markInputRule(/\*\*([^*]+)\*\*$/, richTextSchema.marks.bold),
  markInputRule(/(?<!_)__([^_]+)__$/, richTextSchema.marks.bold),
  markInputRule(/(?<!\*)\*([^*]+)\*$/, richTextSchema.marks.italic),
  markInputRule(/(?<!_)_([^_]+)_$/, richTextSchema.marks.italic),
  markInputRule(/~~([^~]+)~~$/, richTextSchema.marks.strikethrough),
  markInputRule(/`([^`]+)`$/, richTextSchema.marks.code, false),
  // Must precede linkInputRule — see imageInputRule's own doc comment for why.
  imageInputRule,
  linkInputRule,
  listMarkerInputRule(/^\s*[-*+]\s$/, "bulleted"),
  listMarkerInputRule(/^\s*\d+\.\s$/, "numbered"),
  headingInputRule(),
  blockquoteInputRule(),
];

/**
 * A keymap command (not an `InputRule` — `InputRule`s only fire on text insertion, and "Enter
 * after a fenced line" is a block-split concern), bound to Enter in `ProseMirrorRichTextField`'s
 * plugin list before `baseKeymap`'s own Enter. Typing ` ```lang ` then pressing Enter replaces
 * that paragraph with an empty `code_block` (fence markers consumed, never shown as literal
 * text — unlike inline markdown, a multi-line fence has no useful "collapsed" visual state to
 * preserve). Returns `false` (letting `baseKeymap`'s Enter run instead) whenever the current
 * paragraph's text doesn't match a fence line, so ordinary Enter behavior is untouched everywhere
 * else. See `ProseMirrorRichTextField.ts` for how `Mod-Enter`/plain-Enter are bound *inside* an
 * already-open code block (`exitCode`/`newlineInCode`, reused from `prosemirror-commands` rather
 * than reimplemented here).
 */
export function startCodeBlockOnFencedLine(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const $from = state.selection.$from;
  if ($from.parent.type !== richTextSchema.nodes.paragraph) return false;
  const match = /^```([a-zA-Z0-9]*)$/.exec($from.parent.textContent);
  if (!match) return false;
  if (dispatch) {
    const from = $from.before($from.depth);
    const to = $from.after($from.depth);
    const attrs: CodeBlockAttrs = { language: match[1] || null };
    const codeBlock = richTextSchema.nodes.code_block.create(attrs);
    const tr = state.tr.replaceWith(from, to, codeBlock);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 1)));
  }
  return true;
}
