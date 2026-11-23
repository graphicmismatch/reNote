/**
 * Request for `list_sections`/`list_section_groups`: both take the same
 * shape — a notebook, and an optional parent section-group to scope to
 * (omitted means "top-level, directly under the notebook root").
 */
export type ListSectionsRequestDto = { notebookId: string; parentGroupId: string | null };
