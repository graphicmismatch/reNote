import { Assets, Container, Graphics, loadTextures, Rectangle, Sprite, Text, Texture } from "pixi.js";
import type { ImageData, ImageObject } from "@renote/core";
import type { ChunkOrigin, ObjectTypeDefinition, ResolveAssetUrl } from "./object-type-definition.js";

// Re-exported so callers can `import { ImageObject } from "@renote/canvas-engine"` without also
// reaching into "@renote/core" — same pattern as text-box-object-type.ts's re-export, since
// ImageObject/ImageData carry no engine-only fields.
export type { ImageObject, ImageData };

// Real, reported bug (not a hypothetical): on WebKitGTK's software-GL backend (the environment
// this app's Tauri build runs in when there's no real GPU passthrough — e.g. a VM/container),
// `gl.texImage2D` silently produces a BLANK texture when given an `ImageBitmap` as its pixel
// source, even though the `ImageBitmap` itself decodes correctly (verified independently via a
// plain 2D canvas `drawImage`+`getImageData` sample, which read back exact expected pixel
// values). `HTMLImageElement` sources upload fine on the same backend. Pixi's default
// `loadTextures` parser prefers `createImageBitmap` (`config.preferCreateImageBitmap = true`,
// `preferWorkers = true`), which is exactly the path that trips this — forcing it off makes
// `loadTextures.load()` fall through to its `<img>`-element branch instead, sidestepping the
// bug entirely. This is a one-time global config flip (Pixi shares one `loadTextures` parser
// instance app-wide), so it belongs at module load, not per-call.
if (loadTextures.config) {
  loadTextures.config.preferCreateImageBitmap = false;
  loadTextures.config.preferWorkers = false;
}

const BORDER_COLOR = 0xb0b0b0;
const CROP_INDICATOR_COLOR = 0x707070;
const GLYPH_COLOR = 0x9a9a9a;

function validateImageData(data: unknown): ImageData {
  if (typeof data !== "object" || data === null) {
    throw new Error("image data must be an object.");
  }
  const candidate = data as Record<string, unknown>;
  if (typeof candidate.assetPath !== "string") {
    throw new Error("image data.assetPath must be a string.");
  }
  if (typeof candidate.naturalWidth !== "number" || candidate.naturalWidth <= 0) {
    throw new Error("image data.naturalWidth must be a positive number.");
  }
  if (typeof candidate.naturalHeight !== "number" || candidate.naturalHeight <= 0) {
    throw new Error("image data.naturalHeight must be a positive number.");
  }
  const cropRect = validateCropRect(candidate.cropRect, candidate.naturalWidth, candidate.naturalHeight);
  return {
    assetPath: candidate.assetPath,
    naturalWidth: candidate.naturalWidth,
    naturalHeight: candidate.naturalHeight,
    cropRect,
  };
}

function validateCropRect(
  cropRect: unknown,
  naturalWidth: number,
  naturalHeight: number,
): ImageData["cropRect"] {
  if (cropRect === null || cropRect === undefined) {
    return null;
  }
  if (typeof cropRect !== "object") {
    throw new Error("image data.cropRect must be an object or null.");
  }
  const candidate = cropRect as Record<string, unknown>;
  if (typeof candidate.x !== "number" || candidate.x < 0) {
    throw new Error("image data.cropRect.x must be a non-negative number.");
  }
  if (typeof candidate.y !== "number" || candidate.y < 0) {
    throw new Error("image data.cropRect.y must be a non-negative number.");
  }
  if (typeof candidate.width !== "number" || candidate.width <= 0 || candidate.width > naturalWidth) {
    throw new Error("image data.cropRect.width must be a positive number not exceeding naturalWidth.");
  }
  if (typeof candidate.height !== "number" || candidate.height <= 0 || candidate.height > naturalHeight) {
    throw new Error("image data.cropRect.height must be a positive number not exceeding naturalHeight.");
  }
  return { x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height };
}

/**
 * Pure helper giving a future crop-tool a clean seam to call instead of hand-constructing the
 * `ImageData` shape itself. Re-validates the result so a bad crop rect throws here rather than
 * silently producing invalid persisted data.
 */
export function applyCrop(data: ImageData, cropRect: ImageData["cropRect"]): ImageData {
  return validateImageData({ ...data, cropRect });
}

interface ImageView extends Container {
  border: Graphics;
  glyph: Graphics;
  cropOutline: Graphics;
  glyphLabel: Text;
  /** The real image content, hidden until a texture actually loads — see `drawImageView`. */
  sprite: Sprite;
  /**
   * The `assetPath` currently loaded (or in flight) for `sprite`/`baseTexture` below, or
   * `null` before the first load attempt. Guards against kicking off a redundant reload on
   * every `updateView` call when `assetPath` hasn't actually changed.
   */
  loadingAssetPath: string | null;
  /** The successfully loaded, uncropped base texture for `loadingAssetPath`, or `null` while
   *  still loading, not yet attempted, or the last attempt failed. */
  baseTexture: Texture | null;
  /**
   * The most recent `object`/`origin` this view was drawn with — kept up to date on every
   * `drawImageView` call (sync, before anything async happens) so that when an in-flight
   * texture load resolves later, it applies sprite geometry from the FRESHEST known
   * bounds/cropRect/origin rather than whatever was current at the moment the load started
   * (which may be stale by the time a slow load finishes, e.g. if the object was resized or
   * moved to a different chunk in the meantime).
   */
  latestObject: ImageObject;
  latestOrigin: ChunkOrigin;
}

function isImageView(view: Container): view is ImageView {
  return (
    "border" in view && "glyph" in view && "cropOutline" in view && "glyphLabel" in view && "sprite" in view
  );
}

/**
 * Module-level cache of in-flight/loaded base (uncropped) textures, keyed by the resolved,
 * directly-loadable URL a `ResolveAssetUrl` callback returns (NOT by `assetPath` — the same
 * relative `assetPath` string is meaningless across different notebooks/sections, but the
 * resolved URL is already unique per section, and the fake client's `data:` URLs are unique per
 * asset's actual bytes). `Assets.load` itself already dedupes concurrent loads of the same URL
 * internally, so this wrapper mainly avoids re-issuing a fresh `Assets.load` call (and its
 * associated promise-then chain) on every `updateView` for an already-resolved image, and
 * evicts a rejected load so a later retry (e.g. after a transient failure) isn't permanently
 * stuck replaying the same rejection.
 */
const textureCache = new Map<string, Promise<Texture>>();

/**
 * Drops every cached (in-flight or resolved) `Texture` promise — called from
 * `imageObjectType.onRendererDisposed` (see that hook's doc comment on `ObjectTypeDefinition`
 * for why this is necessary: a `Texture`'s GPU-side data is bound to whichever renderer
 * uploaded it, and this cache is otherwise shared across every `PixiRenderer` instance that
 * ever mounts, including ones from an unrelated earlier/later mount). Only clears the JS-level
 * cache so a subsequent load re-fetches/re-decodes fresh — it deliberately does NOT call
 * `.destroy()` on any cached `Texture`, since a texture still in use by a live (not-yet-disposed)
 * renderer's sprites must keep working until THAT renderer is itself disposed.
 */
function clearImageTextureCache(): void {
  textureCache.clear();
}

/**
 * Pixi's `Assets.load(url)` (given a bare URL string, no explicit `format`) decides which parser
 * handles it by pattern-matching the URL string itself against a handful of known extensions —
 * see `loadTextures.test()`/`checkExtension` in Pixi's own source. A Tauri asset-protocol URL
 * (what `resolveAssetUrl` returns for the real client — see that type's doc comment) is a
 * percent-encoded `http://asset.localhost/<path>`-shaped string, not the plain relative path
 * this app actually controls; nothing here guarantees Pixi's pattern still matches it the way it
 * matches a plain `"foo.png"`. Deriving the format from `assetPath` instead — the clean, un-
 * encoded, always-correct relative path this object's own data carries — and passing it as an
 * explicit `format` hint removes that guesswork entirely, regardless of what the resolved URL
 * ends up looking like.
 */
function extensionOf(path: string): string | undefined {
  const match = /\.([a-zA-Z0-9]+)$/.exec(path);
  return match?.[1]?.toLowerCase();
}

function loadBaseTexture(url: string, format: string | undefined): Promise<Texture> {
  let cached = textureCache.get(url);
  if (!cached) {
    cached = Assets.load<Texture>(format ? { src: url, format } : url);
    textureCache.set(url, cached);
    cached.catch(() => {
      textureCache.delete(url);
    });
  }
  return cached;
}

/**
 * Kicks off (fire-and-forget) resolving+loading the real texture for `assetPath` and, once it
 * resolves, applies it to `view.sprite` — using `view.latestObject`/`view.latestOrigin` (NOT
 * whatever was captured in this closure at kickoff time) so a slow load that outlives further
 * edits to the same object still ends up showing the CURRENT bounds/cropRect, not a stale one.
 * Never throws; a failed load just leaves the placeholder showing and logs to the console, same
 * as any other best-effort background fetch in this codebase.
 */
function beginTextureLoad(view: ImageView, assetPath: string, resolveAssetUrl: ResolveAssetUrl): void {
  const format = extensionOf(assetPath);
  resolveAssetUrl(assetPath)
    .then((url) => loadBaseTexture(url, format))
    .then((texture) => {
      // Stale (torn down, or a newer assetPath has since superseded this one) — drop it.
      if (view.destroyed || view.loadingAssetPath !== assetPath) return;
      view.baseTexture = texture;
      applyLoadedSprite(view);
    })
    .catch((error: unknown) => {
      console.error(`Failed to load image asset "${assetPath}".`, error);
      if (view.loadingAssetPath === assetPath) {
        // Allow a future retry: if assetPath changes and later changes back to this same
        // value, the "already loading/loaded this path" guard in drawImageView must not
        // suppress a fresh attempt.
        view.loadingAssetPath = null;
      }
    });
}

/**
 * Sizes/crops `view.sprite` from `view.baseTexture` (must already be loaded) against
 * `view.latestObject`/`view.latestOrigin`, and swaps placeholder-vs-real-content visibility.
 * Safe to call any number of times (e.g. once right after a load resolves, and again on every
 * subsequent `updateView` while `baseTexture` stays loaded) — always reflects current state.
 */
function applyLoadedSprite(view: ImageView): void {
  const texture = view.baseTexture;
  if (!texture) return;

  const object = view.latestObject;
  const origin = view.latestOrigin;
  const { cropRect, naturalWidth, naturalHeight } = object.data;
  const { width, height } = object.bounds;
  const x = object.bounds.x - origin.x;
  const y = object.bounds.y - origin.y;

  // Cropping: a fresh sub-`Texture` sharing the same GPU source but a narrower `frame`, in
  // NATURAL image-pixel space (matching how `cropRect` is validated/stored — see
  // `validateCropRect`). Cheap: no re-upload, just a new view over the already-loaded source.
  view.sprite.texture =
    cropRect && cropRect.width <= naturalWidth && cropRect.height <= naturalHeight
      ? new Texture({
          source: texture.source,
          frame: new Rectangle(cropRect.x, cropRect.y, cropRect.width, cropRect.height),
        })
      : texture;
  view.sprite.position.set(x, y);
  view.sprite.width = width;
  view.sprite.height = height;

  view.sprite.visible = true;
  // The placeholder's "image" glyph/label/dashed crop-indicator have nothing left to prove —
  // real pixel content is now on screen. `border` stays visible regardless (a lightweight
  // bounds indicator, same role it plays for every other object type).
  view.glyph.visible = false;
  view.glyphLabel.visible = false;
  view.cropOutline.visible = false;
}

export const imageObjectType: ObjectTypeDefinition<"image", ImageData> = {
  type: "image",

  validate: validateImageData,

  createView(object, origin, resolveAssetUrl): Container {
    const container = new Container() as ImageView;
    const sprite = new Sprite(Texture.EMPTY);
    sprite.visible = false;
    const border = new Graphics();
    const glyph = new Graphics();
    const cropOutline = new Graphics();
    const glyphLabel = new Text({
      text: "image",
      style: { fontSize: 11, fill: GLYPH_COLOR },
    });
    // sprite first (bottom) so the placeholder pieces stay legible on top of it while loading
    // and, for a cropped image, the (now-hidden) cosmetic crop indicator would otherwise sit
    // beneath a fully opaque sprite anyway.
    container.addChild(sprite);
    container.addChild(border);
    container.addChild(glyph);
    container.addChild(cropOutline);
    container.addChild(glyphLabel);
    container.sprite = sprite;
    container.border = border;
    container.glyph = glyph;
    container.cropOutline = cropOutline;
    container.glyphLabel = glyphLabel;
    container.loadingAssetPath = null;
    container.baseTexture = null;
    container.latestObject = object;
    container.latestOrigin = origin;
    drawImageView(container, object, origin, resolveAssetUrl);
    return container;
  },

  updateView(view, object, origin, resolveAssetUrl): void {
    if (isImageView(view)) {
      drawImageView(view, object, origin, resolveAssetUrl);
    }
  },

  hitTest(object, point): boolean {
    const { x, y, width, height } = object.bounds;
    return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
  },

  supportsRotation: true,
  supportsResize: true,

  onRendererDisposed: clearImageTextureCache,
};

/**
 * Geometry is baked in chunk-local space: `object.bounds` (world space) minus `origin` (the
 * containing chunk's world-space offset — see PixiRenderer's chunk-container doc comment) —
 * `PixiRenderer` applies `transform.x/y/rotation/scale` on top generically, this function never
 * touches those.
 *
 * Real texture loading is layered on top of the always-synchronous placeholder draw below:
 * `resolveAssetUrl` (see its doc comment on `ObjectTypeDefinition`) is the seam `canvas-engine`
 * exposes for resolving `data.assetPath` to something a `Texture` can actually load from,
 * without this package ever importing Tauri/storage-client APIs directly — `apps/desktop`
 * supplies the real implementation at `PixiRenderer` construction time. When absent (headless
 * tests, `NullRenderer`), this function only ever draws the placeholder, exactly as before this
 * phase — every existing placeholder-shaped test keeps passing unmodified.
 */
function drawImageView(
  view: ImageView,
  object: ImageObject,
  origin: ChunkOrigin,
  resolveAssetUrl?: ResolveAssetUrl,
): void {
  view.latestObject = object;
  view.latestOrigin = origin;

  const x = object.bounds.x - origin.x;
  const y = object.bounds.y - origin.y;
  const { width, height } = object.bounds;

  view.border.clear();
  view.border.rect(x, y, width, height).stroke({ width: 1, color: BORDER_COLOR });

  // Diagonal-cross placeholder pattern, standing in for real pixel content until a texture
  // actually loads (or forever, if no `resolveAssetUrl` was supplied at all).
  view.glyph.clear();
  view.glyph
    .moveTo(x, y)
    .lineTo(x + width, y + height)
    .moveTo(x + width, y)
    .lineTo(x, y + height)
    .stroke({ width: 1, color: GLYPH_COLOR, alpha: 0.6 });

  view.glyphLabel.position.set(x + 4, y + 4);

  // Cosmetic crop indicator: an inset dashed-looking outline (Pixi has no native dash primitive,
  // approximated with short segments) showing where `data.cropRect` maps within the placeholder,
  // scaled from natural-image space into `bounds` space. Only meaningful while the placeholder
  // itself is what's showing — hidden once a real (already-cropped) sprite takes over, see
  // `applyLoadedSprite`.
  view.cropOutline.clear();
  const { cropRect, naturalWidth, naturalHeight } = object.data;
  if (cropRect) {
    const scaleX = width / naturalWidth;
    const scaleY = height / naturalHeight;
    const insetX = x + cropRect.x * scaleX;
    const insetY = y + cropRect.y * scaleY;
    const insetWidth = cropRect.width * scaleX;
    const insetHeight = cropRect.height * scaleY;
    drawDashedRect(view.cropOutline, insetX, insetY, insetWidth, insetHeight, CROP_INDICATOR_COLOR);
  }

  if (!resolveAssetUrl) {
    // No resolver at all (NullRenderer, most unit tests) — nothing can ever be loaded here;
    // stay in placeholder mode permanently, matching this function's pre-Phase-5.9 behavior.
    return;
  }

  if (view.loadingAssetPath !== object.data.assetPath) {
    // assetPath changed (first draw, or the object's image was swapped) — (re)start loading,
    // and go back to placeholder-visible until the new texture actually resolves.
    view.loadingAssetPath = object.data.assetPath;
    view.baseTexture = null;
    view.sprite.visible = false;
    view.glyph.visible = true;
    view.glyphLabel.visible = true;
    view.cropOutline.visible = cropRect !== null;
    beginTextureLoad(view, object.data.assetPath, resolveAssetUrl);
  } else if (view.baseTexture) {
    // Already loaded for the current assetPath — bounds/cropRect may still have changed
    // (resize/crop), so reapply geometry against the now-current object/origin every call.
    applyLoadedSprite(view);
  }
}

/** Approximates a dashed rectangle outline out of short stroked segments (Pixi has no dash primitive). */
function drawDashedRect(
  graphics: Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
): void {
  const dash = 4;
  const gap = 3;
  const stroke = { width: 1, color };

  const drawDashedLine = (x1: number, y1: number, x2: number, y2: number): void => {
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length === 0) return;
    const unitX = (x2 - x1) / length;
    const unitY = (y2 - y1) / length;
    for (let traveled = 0; traveled < length; traveled += dash + gap) {
      const segmentEnd = Math.min(traveled + dash, length);
      graphics
        .moveTo(x1 + unitX * traveled, y1 + unitY * traveled)
        .lineTo(x1 + unitX * segmentEnd, y1 + unitY * segmentEnd)
        .stroke(stroke);
    }
  };

  drawDashedLine(x, y, x + width, y);
  drawDashedLine(x + width, y, x + width, y + height);
  drawDashedLine(x + width, y + height, x, y + height);
  drawDashedLine(x, y + height, x, y);
}
