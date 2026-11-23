/**
 * Mirrors `renote_storage::AutosaveMeta`: cheap status metadata for a
 * page's single autosave slot (no page object data included).
 */
export type AutosaveMetaDto = {
  timestamp: string;
  /**
   * `f64`, not `u64`: ts-rs maps `u64` to TS `bigint`, which doesn't
   * round-trip through Tauri's JSON `invoke` bridge cleanly (the actual
   * runtime value arrives as a plain `number`, not a `bigint`). `f64`
   * matches how every other byte-count-shaped field on the wire here
   * (e.g. `SearchHitDto.score`) is represented, and safely covers file
   * sizes far beyond anything an autosave folder will ever reach.
   */
  sizeBytes: number;
  objectCount: number;
};
