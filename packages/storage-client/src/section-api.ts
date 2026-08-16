import { invoke } from "@tauri-apps/api/core";
import type {
  CreateSectionGroupRequestDto,
  CreateSectionRequestDto,
  ListSectionsRequestDto,
  MoveSectionRequestDto,
  RenameSectionGroupRequestDto,
  RenameSectionRequestDto,
  SectionDto,
  SectionGroupDto,
} from "./types.js";

export function listSections(request: ListSectionsRequestDto): Promise<SectionDto[]> {
  return invoke("list_sections", { request });
}

export function listSectionGroups(request: ListSectionsRequestDto): Promise<SectionGroupDto[]> {
  return invoke("list_section_groups", { request });
}

export function createSection(request: CreateSectionRequestDto): Promise<SectionDto> {
  return invoke("create_section", { request });
}

export function createSectionGroup(request: CreateSectionGroupRequestDto): Promise<SectionGroupDto> {
  return invoke("create_section_group", { request });
}

export function renameSection(request: RenameSectionRequestDto): Promise<SectionDto> {
  return invoke("rename_section", { request });
}

export function renameSectionGroup(request: RenameSectionGroupRequestDto): Promise<SectionGroupDto> {
  return invoke("rename_section_group", { request });
}

/** Moves a section under a different parent (the notebook root when `targetParentGroupId` is
 *  null) within the same notebook. */
export function moveSection(request: MoveSectionRequestDto): Promise<SectionDto> {
  return invoke("move_section", { request });
}

/** Moves a section group — and everything inside it — under a different parent. */
export function moveSectionGroup(request: MoveSectionRequestDto): Promise<SectionGroupDto> {
  return invoke("move_section_group", { request });
}
