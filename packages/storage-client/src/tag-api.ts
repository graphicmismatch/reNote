import { invoke } from "@tauri-apps/api/core";
import type {
  CreateTagRequestDto,
  DeleteTagRequestDto,
  ListTaggedParagraphsRequestDto,
  ListTagsRequestDto,
  TagDto,
  TaggedParagraphDto,
  UpdateTagRequestDto,
} from "./types.js";

export function listTags(request: ListTagsRequestDto): Promise<TagDto[]> {
  return invoke("list_tags", { request });
}

export function createTag(request: CreateTagRequestDto): Promise<TagDto> {
  return invoke("create_tag", { request });
}

export function updateTag(request: UpdateTagRequestDto): Promise<TagDto> {
  return invoke("update_tag", { request });
}

export function deleteTag(request: DeleteTagRequestDto): Promise<void> {
  return invoke("delete_tag", { request });
}

/** Every paragraph across the notebook currently carrying the given tag (Phase 11.3 to-do
 *  rollup), most-recently-modified page first. */
export function listTaggedParagraphs(request: ListTaggedParagraphsRequestDto): Promise<TaggedParagraphDto[]> {
  return invoke("list_tagged_paragraphs", { request });
}
