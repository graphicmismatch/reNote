import { baseKeymap, chainCommands, exitCode, newlineInCode } from "prosemirror-commands";
import { inputRules, undoInputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import { EditorState, Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { RichTextField } from "./RichTextField.js";
import {
  proseMirrorDocToRichTextDocument,
  richTextDocumentToProseMirrorDoc,
} from "./schema/document-conversion.js";
import { emptyRichTextDocument, type RichTextDocument } from "./schema/marks.js";
import {
  appendTableRow,
  markdownInputRules,
  startCodeBlockOnFencedLine,
  startTableOnSeparatorRow,
} from "./schema/markdown-input-rules.js";
import { markdownRevealPlugin } from "./schema/markdown-reveal-plugin.js";
import { richTextSchema } from "./schema/prosemirror-schema.js";

/** A ProseMirror document position range: `[from, to)`. */
export interface WikilinkTriggerRange {
  from: number;
  to: number;
}

interface WikilinkTriggerState {
  active: boolean;
  /** Position of the first "[" of the triggering "[[" — meaningful only when `active`. */
  from: number;
  /** Current cursor position (the end of the typed query) — meaningful only when `active`. */
  to: number;
}

const INACTIVE_TRIGGER_STATE: WikilinkTriggerState = { active: false, from: 0, to: 0 };

const wikilinkTriggerKey = new PluginKey<WikilinkTriggerState>("renote-wikilink-trigger");

/**
 * Detects the user typing (or pasting) `[[` and tracks the query text typed immediately after
 * it, calling `onTrigger` with the live query plus its ProseMirror position range on every
 * keystroke while tracking is active, and `onCancel` once tracking stops without the caller
 * ever having confirmed a target (one of the two `[` characters got deleted, the selection moved
 * away, etc.). This is the state-tracking half of the wikilink-autocomplete design described on
 * `ProseMirrorRichTextField`'s class doc comment; `insertWikilink`/`cancelWikilinkTrigger` below
 * are the other half — the calls a caller makes once the user has picked (or dismissed) a
 * candidate from whatever UI it built on top of `onTrigger`.
 *
 * Implemented purely through this plugin's own `state.apply` (inspecting every transaction,
 * regardless of origin) plus a `view.update` hook that diffs the resulting plugin state against
 * what was last reported — no `handleTextInput`/`handleKeyDown` interception needed, so normal
 * typing, IME composition, and paste all flow through unmodified and still get detected
 * correctly (each just shows up as a doc-changing transaction like any other).
 */
function wikilinkTriggerPlugin(
  onTrigger?: (query: string, range: WikilinkTriggerRange) => void,
  onCancel?: () => void,
): Plugin {
  return new Plugin<WikilinkTriggerState>({
    key: wikilinkTriggerKey,
    state: {
      init: () => INACTIVE_TRIGGER_STATE,
      apply(tr, prev): WikilinkTriggerState {
        if (tr.getMeta(wikilinkTriggerKey) === "cancel") {
          return INACTIVE_TRIGGER_STATE;
        }
        if (!tr.docChanged && !tr.selectionSet) {
          return prev;
        }

        const { selection } = tr;
        if (!(selection instanceof TextSelection) || !selection.empty) {
          return prev.active ? INACTIVE_TRIGGER_STATE : prev;
        }
        const cursor = selection.from;

        if (!prev.active) {
          if (tr.docChanged && cursor >= 2) {
            const preceding = tr.doc.textBetween(cursor - 2, cursor, "\0", "\0");
            if (preceding === "[[") {
              return { active: true, from: cursor - 2, to: cursor };
            }
          }
          return prev;
        }

        // Active: re-map the tracked bracket position through this transaction's changes, then
        // confirm the two "[" characters are still immediately there and the cursor hasn't
        // moved to before them — either failing means the trigger no longer applies.
        const mappedFrom = tr.mapping.map(prev.from);
        if (cursor < mappedFrom + 2) {
          return INACTIVE_TRIGGER_STATE;
        }
        const stillBracketed = tr.doc.textBetween(mappedFrom, mappedFrom + 2, "\0", "\0") === "[[";
        if (!stillBracketed) {
          return INACTIVE_TRIGGER_STATE;
        }
        return { active: true, from: mappedFrom, to: cursor };
      },
    },
    view(editorView) {
      let lastReported = wikilinkTriggerKey.getState(editorView.state) ?? INACTIVE_TRIGGER_STATE;
      return {
        update(view) {
          const next = wikilinkTriggerKey.getState(view.state) ?? INACTIVE_TRIGGER_STATE;
          if (next.active && (next.from !== lastReported.from || next.to !== lastReported.to)) {
            const query = view.state.doc.textBetween(next.from + 2, next.to, "\0", "\0");
            onTrigger?.(query, { from: next.from, to: next.to });
          } else if (!next.active && lastReported.active) {
            onCancel?.();
          }
          lastReported = next;
        },
      };
    },
  });
}

export interface ProseMirrorRichTextFieldOptions {
  /**
   * Fired on every keystroke while the user is mid-way through typing a `[[wikilink` — `query`
   * is the text typed so far after the `[[`, `range` is its current ProseMirror position span
   * (from the first `[` through the cursor). `packages/text-editor` has zero dependency on
   * storage/Tauri by design (the boundary rule — see the package README), so it cannot itself
   * look up candidate pages; this callback is the seam `apps/desktop` hooks to drive a live
   * autocomplete popover backed by `StorageClient.search(...)`, mirroring the existing
   * `beginTextEdit`/tag-picker "small floating popover over the DOM overlay" pattern in
   * `PageEditorView.tsx`.
   */
  onWikilinkTrigger?: (query: string, range: WikilinkTriggerRange) => void;
  /**
   * Fired once wikilink-trigger tracking stops without the caller ever calling
   * `insertWikilink` — e.g. the user deleted one of the two `[` characters, or moved the
   * selection elsewhere. The caller uses this to close its popover.
   */
  onWikilinkCancel?: () => void;
}

/**
 * `RichTextField` backed by ProseMirror. See the Phase 2 spike note in the
 * package README/task report for why ProseMirror was picked over Lexical:
 * in short, its flat node-attribute model maps 1:1 onto `RichTextParagraph`'s
 * `listKind`/`indentLevel`/`tagId` fields, and its conversion functions
 * (`src/schema/document-conversion.ts`) run against plain `prosemirror-model`
 * data with no DOM/view dependency, keeping this class itself limited to
 * lifecycle (mount/setContent/getContent/focus/destroy) plus the small
 * wikilink-autocomplete injection surface below (`onWikilinkTrigger`/
 * `onWikilinkCancel` in, `insertWikilink`/`cancelWikilinkTrigger` out).
 *
 * Lifecycle notes:
 * - `setContent` works whether or not the field is mounted: pre-mount it
 *   just updates the pending document that `mount` will construct the
 *   initial state from; post-mount it replaces the live `EditorState`.
 * - `getContent` reads live state when mounted, otherwise the last
 *   `setContent` document (or an empty document if none was ever set).
 * - `destroy` is safe to call multiple times and safe to call without a
 *   prior `mount()` — both are explicit no-ops, not null-derefs.
 */
export class ProseMirrorRichTextField implements RichTextField {
  private view: EditorView | null = null;
  private pendingDocument: RichTextDocument = emptyRichTextDocument();
  private readonly plugins: Plugin[];

  constructor(options: ProseMirrorRichTextFieldOptions = {}) {
    this.plugins = [
      // Backspace-to-undo an input rule must be tried before baseKeymap's own plain-delete
      // Backspace — a separate, earlier `keymap` plugin so it wins that race (ProseMirror tries
      // plugins in order, first handler that returns true stops the search) — standard
      // `prosemirror-example-setup` composition: `undoInputRule` itself only acts right after a
      // rule fired and defers (returns false) otherwise, so ordinary Backspace is untouched the
      // rest of the time.
      keymap({ Backspace: undoInputRule }),
      // Fence-line Enter ("```lang" -> an empty code_block), separator-row Enter (a completed
      // "|---|---|" row -> a table), and pipe-row Enter (a row typed below an existing table ->
      // an appended row) must all be tried before baseKeymap's own Enter (plain paragraph split),
      // for the same "earlier plugin wins" reason as the Backspace binding above — each one
      // recognizes "this line just got finished" as a block-level concern, only actually firing
      // when the current paragraph's full text (not a mid-typing prefix — see
      // `startTableOnSeparatorRow`'s doc comment for why an `InputRule` version of this was
      // actually broken, not just differently structured) matches. `Mod-Enter`/plain-Enter
      // *inside* an already-open code_block are separate bindings (`exitCode`/`newlineInCode`,
      // both from `prosemirror-commands`) — they only apply once a code_block exists to be inside
      // of, so they don't conflict with any of the paragraph-only bindings above them.
      keymap({ Enter: startCodeBlockOnFencedLine }),
      keymap({ Enter: startTableOnSeparatorRow }),
      keymap({ Enter: appendTableRow }),
      keymap({ "Mod-Enter": exitCode }),
      keymap({ Enter: chainCommands(newlineInCode, baseKeymap["Enter"]!) }),
      keymap(baseKeymap),
      inputRules({ rules: markdownInputRules }),
      markdownRevealPlugin,
      wikilinkTriggerPlugin(options.onWikilinkTrigger, options.onWikilinkCancel),
    ];
  }

  mount(container: HTMLElement): void {
    const state = EditorState.create({
      schema: richTextSchema,
      doc: richTextDocumentToProseMirrorDoc(this.pendingDocument),
      plugins: this.plugins,
    });
    this.view = new EditorView(container, { state });
  }

  setContent(document: RichTextDocument): void {
    this.pendingDocument = document;
    if (this.view !== null) {
      const state = EditorState.create({
        schema: richTextSchema,
        doc: richTextDocumentToProseMirrorDoc(document),
        plugins: this.plugins,
      });
      this.view.updateState(state);
    }
  }

  getContent(): RichTextDocument {
    if (this.view !== null) {
      return proseMirrorDocToRichTextDocument(this.view.state.doc);
    }
    return this.pendingDocument;
  }

  focus(): void {
    this.view?.focus();
  }

  /**
   * Sets the `tagId` attr (see `ParagraphAttrs` in `./schema/prosemirror-schema.ts`) on the
   * paragraph node containing the current selection's anchor (`state.selection.$from`), via a
   * ProseMirror transaction. No-op if the field isn't mounted, matching `getContent`/`destroy`'s
   * existing "safe without a mounted view" discipline — there's no live selection to read from
   * pre-mount.
   */
  setParagraphTag(tagId: string | null): void {
    if (this.view === null) {
      return;
    }
    const { state } = this.view;
    const { $from } = state.selection;
    // `$from.before($from.depth)` is the position immediately before $from's own immediate
    // parent — the paragraph itself. Most paragraphs sit directly under `doc` (depth 1), but a
    // table cell's paragraph sits deeper; resolving the depth from `$from` itself (rather than
    // the old hardcoded `before(1)`) is what makes this correct in both cases, exactly where
    // `state.doc.nodeAt(...)` finds the paragraph node whose attrs this call updates.
    const paragraphPos = $from.before($from.depth);
    const paragraphNode = state.doc.nodeAt(paragraphPos);
    if (!paragraphNode) {
      return;
    }
    const tr = state.tr.setNodeAttribute(paragraphPos, "tagId", tagId);
    this.view.dispatch(tr);
  }

  /**
   * Applies (or, with `color: null`, clears) the `textColor` mark over the current selection —
   * the floating toolbar's color swatches call this directly on `mousedown` while a range is
   * selected. Unlike `setParagraphTag` (which acts on "the paragraph containing the cursor," so a
   * collapsed selection is perfectly meaningful), a color mark needs actual text to color: a
   * collapsed selection is a no-op here, matching how this class's other selection-driven
   * behavior (e.g. `insertWikilink`'s `range`) always operates on a real span. `removeMark` first,
   * regardless of `color`, so re-picking a different color doesn't stack a second mark instance
   * alongside the first with a stale attr.
   */
  setTextColor(color: string | null): void {
    if (this.view === null) {
      return;
    }
    const { state } = this.view;
    const { from, to, empty } = state.selection;
    if (empty) {
      return;
    }
    let tr = state.tr.removeMark(from, to, richTextSchema.marks.textColor);
    if (color !== null) {
      tr = tr.addMark(from, to, richTextSchema.marks.textColor.create({ color }));
    }
    this.view.dispatch(tr);
    this.view.focus();
  }

  /**
   * Resolves an in-progress `[[query` trigger (see `onWikilinkTrigger`) into an actual link:
   * replaces `range` (the full `[[query` span, exactly as last reported by `onWikilinkTrigger`)
   * with a single text run reading `displayText`, marked with a `wikilink` mark pointing at
   * `pageId`. `pageId` may be the id of the page currently being edited — a page linking to
   * itself is a legitimate self-reference (it will show up in its own Backlinks panel, matching
   * Logseq's own treatment of self-links), so this method never special-cases or rejects that.
   * Called by the frontend once the user picks a candidate (or confirms auto-creation) from its
   * popover. No-op if the field isn't mounted, matching this class's existing "safe without a
   * mounted view" discipline.
   *
   * `anchor` (default `null`) points the link at one heading WITHIN the target page rather than
   * its top — see `marks.ts`'s `TextMark.attr3`. It changes nothing about the mark's page
   * targeting: an anchored link is still an ordinary `page_link` to `pageId` as far as
   * backlinks/the graph are concerned.
   */
  insertWikilink(
    pageId: string,
    displayText: string,
    range: WikilinkTriggerRange,
    anchor: string | null = null,
  ): void {
    if (this.view === null) {
      return;
    }
    const { state } = this.view;
    const mark = richTextSchema.marks.wikilink.create({ pageId, displayText, anchor });
    const textNode = richTextSchema.text(displayText, [mark]);
    const cursorPos = range.from + displayText.length;
    // Chained on a single `tr` throughout (not `state.tr` re-evaluated per call) so
    // `setSelection` resolves `cursorPos` against the doc as it stands AFTER `replaceWith`,
    // not the original pre-replacement doc.
    let tr = state.tr.replaceWith(range.from, range.to, textNode);
    tr = tr.setSelection(TextSelection.create(tr.doc, cursorPos));
    tr = tr.removeStoredMark(richTextSchema.marks.wikilink);
    this.view.dispatch(tr);
    this.view.focus();
  }

  /**
   * Explicitly cancels an in-progress `[[query` trigger (see `onWikilinkTrigger`) without
   * inserting anything — the typed `[[query` text is left exactly as-is, as plain text. Used by
   * the frontend when the user dismisses the autocomplete popover (e.g. pressing Escape) without
   * picking a target. No-op if the field isn't mounted.
   */
  cancelWikilinkTrigger(): void {
    if (this.view === null) {
      return;
    }
    this.view.dispatch(this.view.state.tr.setMeta(wikilinkTriggerKey, "cancel"));
  }

  destroy(): void {
    if (this.view === null) {
      return;
    }
    this.view.destroy();
    this.view = null;
  }
}
