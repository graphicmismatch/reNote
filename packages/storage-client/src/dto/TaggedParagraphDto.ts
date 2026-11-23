/**
 * One paragraph tagged with the requested tag, plus enough about its page to navigate there and
 * show a location — what a tag panel lists for e.g. a "to-do" tag. Mirrors
 * `renote_index::TaggedParagraphRow` field-for-field.
 */
export type TaggedParagraphDto = { pageId: string; pageTitle: string; objectId: string; text: string };
