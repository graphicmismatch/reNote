/**
 * Request for `create_section`.
 */
export type CreateSectionRequestDto = {
  notebookId: string;
  parentGroupId: string | null;
  name: string;
  color: string | null;
  orderKey: string;
};
