/**
 * Response for `save_image_asset`: the relative `assetPath` to store on the
 * object's `data.assetPath` field (see `renote_storage::asset::write_asset`),
 * plus the probed pixel dimensions of the source image.
 */
export type AssetRefDto = { assetPath: string; naturalWidth: number; naturalHeight: number };
