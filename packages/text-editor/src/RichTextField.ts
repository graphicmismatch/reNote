import type { RichTextDocument } from "./schema/marks.js";

/**
 * Contract for the DOM rich-text overlay. A concrete implementation backed by
 * ProseMirror or Lexical (decision pending the Phase 2 spike named in the
 * project plan) will implement this; intentionally left as an interface only
 * until that spike picks a library, rather than shipping a placeholder class
 * that would need to be rewritten wholesale once the choice is made.
 */
export interface RichTextField {
  mount(container: HTMLElement): void;
  setContent(document: RichTextDocument): void;
  getContent(): RichTextDocument;
  focus(): void;
  /**
   * Sets (or clears, with `null`) the `tagId` attribute on the paragraph
   * containing the current selection. A no-op if the field isn't mounted
   * (mirrors `getContent`/`destroy`'s "safe without a mounted view"
   * discipline) — there is no notion of "current selection" pre-mount.
   */
  setParagraphTag(tagId: string | null): void;
  destroy(): void;
}
