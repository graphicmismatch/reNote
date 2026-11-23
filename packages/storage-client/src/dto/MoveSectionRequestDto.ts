/**
 * Request for `move_section` / `move_section_group`: moves the whole folder
 * under a different parent within the SAME notebook — the notebook root when
 * `target_parent_group_id` is `null`, otherwise that section-group.
 *
 * Cross-notebook moves are deliberately not offered: only one notebook is
 * expanded in the tree at a time, so there is no gesture that would ask for
 * one, and it would mean moving every page's index rows between two
 * databases rather than rebuilding one.
 */
export type MoveSectionRequestDto = {
  notebookId: string;
  /**
   * The section's or section-group's id, depending on which command this
   * is sent to.
   */
  id: string;
  targetParentGroupId: string | null;
};
