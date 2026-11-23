/**
 * Request for `resolve_asset_path`. `asset_path` is the relative path
 * previously returned by `save_image_asset` (`AssetRefDto.asset_path`).
 */
export type ResolveAssetPathRequestDto = { notebookId: string; sectionId: string; assetPath: string };
