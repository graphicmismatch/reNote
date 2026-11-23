/**
 * Request for `create_section_group`.
 */
export type CreateSectionGroupRequestDto = {
  notebookId: string;
  parentGroupId: string | null;
  name: string;
  orderKey: string;
};
