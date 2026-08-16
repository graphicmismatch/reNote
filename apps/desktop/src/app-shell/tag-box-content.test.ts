import type { TagDto } from "@renote/storage-client";
import { proseMirrorDocToRichTextDocument, richTextDocumentToProseMirrorDoc } from "@renote/text-editor";
import { describe, expect, it } from "vitest";
import { tagBoxContent } from "./tag-box-content.js";

const tag: TagDto = {
  id: "tag-1",
  notebookId: "notebook-1",
  kind: "important",
  label: "Important",
  color: "#f4c430",
};

describe("tagBoxContent", () => {
  it("carries the tag id in the exact JSON shape the tag index reads back", () => {
    expect(JSON.stringify(tagBoxContent(tag))).toContain('"tagId":"tag-1"');
  });

  it("colors the label with the tag's own color", () => {
    const [paragraph] = tagBoxContent(tag).paragraphs;
    expect(paragraph).toMatchObject({
      runs: [{ text: "Important", marks: [{ kind: "textColor", attr: "#f4c430" }] }],
    });
  });

  it("survives a round trip through the ProseMirror schema unchanged", () => {
    const content = tagBoxContent(tag);
    expect(proseMirrorDocToRichTextDocument(richTextDocumentToProseMirrorDoc(content))).toEqual(content);
  });
});
