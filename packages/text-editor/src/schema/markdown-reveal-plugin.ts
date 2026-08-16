import type { MarkType, Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { richTextSchema, type LinkAttrs } from "./prosemirror-schema.js";

/**
 * Cursor-aware "live preview" reveal, the Obsidian-style editing UX the user asked for: bold/
 * italic/strikethrough/inline-code/link marks render fully styled (delimiters hidden) everywhere
 * *except* where the selection currently touches that mark's span, where synthetic delimiter
 * widgets appear around it so the user can see (and, by extension, trust) what they typed.
 *
 * This plugin never mutates document content — `markdown-input-rules.ts`'s rules already strip
 * the real `**`/`*`/`` ` ``/`[...](...)` characters and apply the mark the moment the shortcut
 * completes (Phase 1's shipped, tested behavior, unchanged). What's revealed here are purely
 * presentational `Decoration.widget`s: non-editable DOM nodes ProseMirror renders inline but that
 * aren't part of the document, don't round-trip through `getContent()`, and can't be edited as
 * text themselves (the standard trade-off in decoration-based live-preview editors — you edit the
 * styled content, not "just the closing `**`" as an independent character). Because nothing here
 * touches persisted content, this plugin is entirely independent of everything downstream that
 * reads a `RichTextDocument` (cold Pixi preview, export, search) — none of it needs to learn
 * about these widgets, since they never exist outside the live `EditorView`.
 *
 * Decorations are recomputed from scratch on every state read (`props.decorations`), the simplest
 * correct approach — no incremental `state.apply` tracking — which is fine at the scale of a
 * single text box's content.
 *
 * Wikilinks are deliberately excluded: they already have dedicated `[[` autocomplete UX (see
 * `ProseMirrorRichTextField`'s `onWikilinkTrigger`), so a reveal treatment would be redundant.
 * List markers are also excluded — see the project plan's "Deferred" list for why list markers
 * keep Phase 1's immediate-consume behavior rather than getting reveal treatment.
 */

export const markdownRevealKey = new PluginKey<DecorationSet>("renote-markdown-reveal");

interface RevealableMark {
  markType: (schema: typeof richTextSchema) => MarkType;
  open: string;
  close: string;
}

const REVEALABLE_MARKS: RevealableMark[] = [
  { markType: (schema) => schema.marks.bold, open: "**", close: "**" },
  { markType: (schema) => schema.marks.italic, open: "*", close: "*" },
  { markType: (schema) => schema.marks.strikethrough, open: "~~", close: "~~" },
  { markType: (schema) => schema.marks.code, open: "`", close: "`" },
];

/**
 * Walks `doc` for maximal `[from, to)` spans of text carrying `markType`, merging adjacent text
 * nodes that share it (e.g. two text runs split only by a mark-attr difference elsewhere) into a
 * single span rather than one widget pair per underlying text node. Resets whenever a text node
 * lacks the mark, and — because paragraph boundaries always advance the position by more than a
 * merge-eligible text node's own `nodeSize` (the block open/close tokens each consume a position)
 * — this naturally never merges across a block boundary without needing an explicit check for it.
 */
function findMarkRanges(doc: ProseMirrorNode, markType: MarkType): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  let current: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (!node.isText) {
      current = null;
      return;
    }
    if (markType.isInSet(node.marks)) {
      if (current !== null && current.to === pos) {
        current.to = pos + node.nodeSize;
      } else {
        current = { from: pos, to: pos + node.nodeSize };
        ranges.push(current);
      }
    } else {
      current = null;
    }
  });
  return ranges;
}

function selectionTouches(state: EditorState, from: number, to: number): boolean {
  const { from: selFrom, to: selTo } = state.selection;
  return selFrom <= to && selTo >= from;
}

/** A non-editable inline widget rendering `text` as a delimiter — `contentEditable="false"` stops
 *  the browser's own caret handling from treating it as editable text, matching how ProseMirror
 *  widgets are meant to be used. */
function delimiterWidget(pos: number, text: string, side: -1 | 1): Decoration {
  return Decoration.widget(
    pos,
    () => {
      const span = document.createElement("span");
      span.className = "renote-md-delim";
      span.contentEditable = "false";
      span.textContent = text;
      return span;
    },
    { side },
  );
}

function computeDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = [];

  for (const { markType, open, close } of REVEALABLE_MARKS) {
    for (const range of findMarkRanges(state.doc, markType(richTextSchema))) {
      if (!selectionTouches(state, range.from, range.to)) continue;
      decorations.push(delimiterWidget(range.from, open, -1));
      decorations.push(delimiterWidget(range.to, close, 1));
    }
  }

  const linkType = richTextSchema.marks.link;
  for (const range of findMarkRanges(state.doc, linkType)) {
    if (!selectionTouches(state, range.from, range.to)) continue;
    const textNode = state.doc.nodeAt(range.from);
    const mark = textNode ? linkType.isInSet(textNode.marks) : undefined;
    const href = mark ? (mark.attrs as LinkAttrs).href : "";
    decorations.push(delimiterWidget(range.from, "[", -1));
    decorations.push(delimiterWidget(range.to, `](${href})`, 1));
  }

  return DecorationSet.create(state.doc, decorations);
}

export const markdownRevealPlugin = new Plugin({
  key: markdownRevealKey,
  props: {
    decorations(state) {
      return computeDecorations(state);
    },
  },
});
