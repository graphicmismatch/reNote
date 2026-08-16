import type { TagDto } from "@renote/storage-client";
import type { RichTextDocument } from "@renote/text-editor";

/**
 * The rich-text content of a spawned "tag" object (see `AppShell`'s "Insert Tag" toolbar
 * button): a single paragraph carrying the tag's own `tagId`, reading the tag's label, colored
 * with the tag's color.
 *
 * `tagId` on the paragraph is the part that makes this a REAL tag assignment rather than
 * decoration — it's the exact field `renote-index`'s `extract_tag_assignments` walk (and the fake
 * client's `"tagId":"<id>"` check) reads back out, so a spawned tag box counts toward the Tags
 * panel's per-tag note count and is findable by a tag-filtered search, same as a tag applied by
 * hand from the tag picker while editing.
 *
 * The `textColor` mark is what makes it *look* like a tag once the box is deselected: the cold
 * Pixi preview renders `textColor` (see `text-box-object-type.ts`'s `extractRunHtml`) but has no
 * rendering for a paragraph's `tagId` at all, so without this a spawned tag box would be
 * indistinguishable from plain typed text on the canvas.
 */
export function tagBoxContent(tag: TagDto): RichTextDocument {
  return {
    paragraphs: [
      {
        runs: [{ text: tag.label, marks: [{ kind: "textColor", attr: tag.color }] }],
        listKind: "none",
        indentLevel: 0,
        tagId: tag.id,
        headingLevel: 0,
        blockquoteDepth: 0,
      },
    ],
  };
}
