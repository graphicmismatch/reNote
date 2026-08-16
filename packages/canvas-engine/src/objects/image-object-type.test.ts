import { describe, expect, it, vi } from "vitest";
import { Assets, Texture } from "pixi.js";
import type { Container, Graphics, Sprite } from "pixi.js";
import { identityTransform, newId, type PageObjectId } from "@renote/core";
import { applyCrop, imageObjectType, type ImageObject } from "./image-object-type.js";

function makeImage(overrides: Partial<ImageObject["data"]> = {}): ImageObject {
  return {
    id: newId<PageObjectId>(),
    type: "image",
    transform: identityTransform(),
    bounds: { x: 10, y: 10, width: 200, height: 100 },
    data: {
      assetPath: "assets/images/foo.png",
      naturalWidth: 400,
      naturalHeight: 200,
      cropRect: null,
      ...overrides,
    },
  };
}

/**
 * Stubs `Assets.load` to resolve `texture` for any URL, without touching the network/decoding
 * any real image bytes. `Assets.load` is overloaded (single-URL vs. array-of-URLs, each with a
 * different return shape), which makes `vi.spyOn(...).mockResolvedValue(...)` infer the wrong
 * overload's parameter type — routing the mock implementation through an `unknown` cast (rather
 * than `any`) sidesteps that inference issue without loosening type-checking anywhere else in
 * this file.
 */
function mockAssetsLoad(texture: Texture) {
  return vi
    .spyOn(Assets, "load")
    .mockImplementation((() => Promise.resolve(texture)) as unknown as typeof Assets.load);
}

describe("imageObjectType", () => {
  it("hits a point inside the bounds rect and misses one outside it", () => {
    const image = makeImage();
    expect(imageObjectType.hitTest(image, { x: 50, y: 50 })).toBe(true);
    expect(imageObjectType.hitTest(image, { x: 500, y: 500 })).toBe(false);
  });

  it("validates well-formed data and rejects malformed data", () => {
    const good = {
      assetPath: "a.png",
      naturalWidth: 100,
      naturalHeight: 50,
      cropRect: null,
    };
    expect(imageObjectType.validate(good)).toEqual(good);

    expect(() => imageObjectType.validate(null)).toThrow();
    expect(() => imageObjectType.validate({ ...good, naturalWidth: 0 })).toThrow();
    expect(() => imageObjectType.validate({ ...good, naturalWidth: -5 })).toThrow();
    expect(() => imageObjectType.validate({ ...good, naturalHeight: -1 })).toThrow();
  });

  it("validates a well-formed cropRect and rejects one exceeding natural dimensions", () => {
    const good = {
      assetPath: "a.png",
      naturalWidth: 100,
      naturalHeight: 50,
      cropRect: { x: 0, y: 0, width: 50, height: 25 },
    };
    expect(imageObjectType.validate(good)).toEqual(good);

    expect(() =>
      imageObjectType.validate({ ...good, cropRect: { x: -1, y: 0, width: 10, height: 10 } }),
    ).toThrow();
    expect(() =>
      imageObjectType.validate({ ...good, cropRect: { x: 0, y: 0, width: 1000, height: 10 } }),
    ).toThrow();
    expect(() =>
      imageObjectType.validate({ ...good, cropRect: { x: 0, y: 0, width: 10, height: 0 } }),
    ).toThrow();
  });

  it("createView/updateView run without throwing, with and without a cropRect", () => {
    const noCrop = makeImage();
    const view = imageObjectType.createView(noCrop, { x: 0, y: 0 });
    expect(() => imageObjectType.updateView(view, noCrop, { x: 0, y: 0 })).not.toThrow();

    const cropped = makeImage({ cropRect: { x: 10, y: 10, width: 100, height: 50 } });
    const croppedView = imageObjectType.createView(cropped, { x: 0, y: 0 });
    expect(() => imageObjectType.updateView(croppedView, cropped, { x: 0, y: 0 })).not.toThrow();
  });

  it("draws chunk-local geometry when given a non-zero origin, not raw world coordinates", () => {
    const image: ImageObject = {
      id: newId<PageObjectId>(),
      type: "image",
      transform: identityTransform(),
      bounds: { x: 1_000_000, y: 1_000_000, width: 200, height: 100 },
      data: {
        assetPath: "assets/images/foo.png",
        naturalWidth: 400,
        naturalHeight: 200,
        cropRect: null,
      },
    };
    const origin = { x: 999_000, y: 999_000 };
    const view = imageObjectType.createView(image, origin) as Container & { border: Graphics };
    const bounds = view.border.getLocalBounds();

    // Chunk-local: near (1000, 1000), not (1_000_000, 1_000_000).
    expect(bounds.x).toBeGreaterThan(900);
    expect(bounds.x).toBeLessThan(1100);
    expect(bounds.y).toBeGreaterThan(900);
    expect(bounds.y).toBeLessThan(1100);
  });

  it("applyCrop returns updated data with the new crop rect and validates it", () => {
    const image = makeImage();
    const updated = applyCrop(image.data, { x: 5, y: 5, width: 50, height: 50 });
    expect(updated.cropRect).toEqual({ x: 5, y: 5, width: 50, height: 50 });
    expect(updated.assetPath).toBe(image.data.assetPath);

    expect(() => applyCrop(image.data, { x: 0, y: 0, width: 9999, height: 10 })).toThrow();
  });

  it("supports rotation and resize", () => {
    expect(imageObjectType.supportsRotation).toBe(true);
    expect(imageObjectType.supportsResize).toBe(true);
  });

  describe("real texture loading (Phase 5.9, resolveAssetUrl-driven)", () => {
    it("stays placeholder-only forever when no resolveAssetUrl is given, exactly as before this phase", () => {
      const image = makeImage();
      const view = imageObjectType.createView(image, { x: 0, y: 0 }) as Container & {
        sprite: Sprite;
        glyph: Graphics;
      };
      expect(view.sprite.visible).toBe(false);
      expect(view.glyph.visible).toBe(true);

      imageObjectType.updateView(view, image, { x: 0, y: 0 });
      expect(view.sprite.visible).toBe(false);
    });

    it("shows the placeholder synchronously, then swaps to a real sprite once resolveAssetUrl resolves", async () => {
      const loadSpy = mockAssetsLoad(Texture.WHITE);
      const image = makeImage();
      const resolveAssetUrl = vi.fn().mockResolvedValue("https://example.test/swap.png");

      const view = imageObjectType.createView(image, { x: 0, y: 0 }, resolveAssetUrl) as Container & {
        sprite: Sprite;
        glyph: Graphics;
        glyphLabel: unknown;
        cropOutline: unknown;
      };

      // Synchronous: nothing has resolved yet, so the placeholder is what's showing.
      expect(view.sprite.visible).toBe(false);
      expect(view.glyph.visible).toBe(true);

      await vi.waitFor(() => expect(view.sprite.visible).toBe(true));

      expect(resolveAssetUrl).toHaveBeenCalledWith(image.data.assetPath);
      expect(view.glyph.visible).toBe(false);
      expect(view.sprite.width).toBe(image.bounds.width);
      expect(view.sprite.height).toBe(image.bounds.height);

      loadSpy.mockRestore();
    });

    it("passes an explicit format hint derived from assetPath, not left for Pixi to guess from the resolved URL", async () => {
      // Regression test: a Tauri asset-protocol URL (what the real resolveAssetUrl returns) is
      // an opaque, percent-encoded `http://asset.localhost/...` string, not a plain `foo.png` —
      // Pixi's default loader picks a parser by pattern-matching the URL itself, so passing a
      // bare URL string risks it not recognizing the format at all and mis-loading the asset
      // (this was a real reported bug: an inserted image rendered as garbage/static instead of
      // its actual pixels). The fix derives `format` from `assetPath` — the clean, app-controlled
      // relative path — and passes it explicitly so Pixi never has to guess from the URL shape.
      const loadSpy = mockAssetsLoad(Texture.WHITE);
      const image = makeImage({ assetPath: "assets/page-1/vacation-photo.JPG" });
      const resolveAssetUrl = vi.fn().mockResolvedValue("http://asset.localhost/some%2Fopaque%2Fpath");

      imageObjectType.createView(image, { x: 0, y: 0 }, resolveAssetUrl);
      await vi.waitFor(() => expect(loadSpy).toHaveBeenCalled());

      expect(loadSpy).toHaveBeenCalledWith({
        src: "http://asset.localhost/some%2Fopaque%2Fpath",
        format: "jpg",
      });

      loadSpy.mockRestore();
    });

    it("crops the loaded sprite's texture to data.cropRect, in natural-image-pixel space", async () => {
      const loadSpy = mockAssetsLoad(Texture.WHITE);
      const image = makeImage({ cropRect: { x: 10, y: 20, width: 100, height: 50 } });
      const resolveAssetUrl = vi.fn().mockResolvedValue("https://example.test/crop.png");

      const view = imageObjectType.createView(image, { x: 0, y: 0 }, resolveAssetUrl) as Container & {
        sprite: Sprite;
      };
      await vi.waitFor(() => expect(view.sprite.visible).toBe(true));

      expect(view.sprite.texture.frame.x).toBe(10);
      expect(view.sprite.texture.frame.y).toBe(20);
      expect(view.sprite.texture.frame.width).toBe(100);
      expect(view.sprite.texture.frame.height).toBe(50);
      // The sprite is always sized to fill `bounds`, regardless of the crop rect's own size —
      // cropping selects WHICH pixels show, not how large the object renders on the page.
      expect(view.sprite.width).toBe(image.bounds.width);
      expect(view.sprite.height).toBe(image.bounds.height);

      loadSpy.mockRestore();
    });

    it("does not re-resolve/re-load on repeated updateView calls for an unchanged assetPath", async () => {
      const loadSpy = mockAssetsLoad(Texture.WHITE);
      const image = makeImage();
      const resolveAssetUrl = vi.fn().mockResolvedValue("https://example.test/dedupe.png");

      const view = imageObjectType.createView(image, { x: 0, y: 0 }, resolveAssetUrl);
      await vi.waitFor(() => expect(resolveAssetUrl).toHaveBeenCalledTimes(1));

      imageObjectType.updateView(view, image, { x: 0, y: 0 }, resolveAssetUrl);
      imageObjectType.updateView(view, image, { x: 0, y: 0 }, resolveAssetUrl);
      imageObjectType.updateView(view, image, { x: 0, y: 0 }, resolveAssetUrl);

      expect(resolveAssetUrl).toHaveBeenCalledTimes(1);
      loadSpy.mockRestore();
    });

    it("re-resolves when assetPath actually changes to a different asset", async () => {
      const loadSpy = mockAssetsLoad(Texture.WHITE);
      const image = makeImage();
      const resolveAssetUrl = vi.fn().mockResolvedValue("https://example.test/first.png");

      const view = imageObjectType.createView(image, { x: 0, y: 0 }, resolveAssetUrl);
      await vi.waitFor(() => expect(resolveAssetUrl).toHaveBeenCalledTimes(1));

      const swapped: ImageObject = { ...image, data: { ...image.data, assetPath: "assets/images/bar.png" } };
      resolveAssetUrl.mockResolvedValue("https://example.test/second.png");
      imageObjectType.updateView(view, swapped, { x: 0, y: 0 }, resolveAssetUrl);

      await vi.waitFor(() => expect(resolveAssetUrl).toHaveBeenCalledTimes(2));
      expect(resolveAssetUrl).toHaveBeenNthCalledWith(2, "assets/images/bar.png");

      loadSpy.mockRestore();
    });

    it("stays in placeholder mode and never throws when resolveAssetUrl rejects", async () => {
      const resolveAssetUrl = vi.fn().mockRejectedValue(new Error("network error"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const image = makeImage();

      const view = imageObjectType.createView(image, { x: 0, y: 0 }, resolveAssetUrl) as Container & {
        sprite: Sprite;
      };

      await vi.waitFor(() => expect(consoleErrorSpy).toHaveBeenCalled());
      expect(view.sprite.visible).toBe(false);

      consoleErrorSpy.mockRestore();
    });

    it("onRendererDisposed drops the cached texture, forcing a fresh Assets.load for a later renderer even for the same URL", async () => {
      // Regression test for a real bug: `textureCache` is a module-level Map shared across
      // every `PixiRenderer` instance that ever mounts (by design, to dedupe reloads within one
      // renderer's lifetime) — but a `Texture`'s GPU-side data belongs to whichever renderer
      // uploaded it. Without this hook, a second renderer instance (e.g. from React StrictMode's
      // dev-mode mount->cleanup->remount double-invoke, which creates two overlapping
      // `PixiRenderer`s on the same container) could reuse a cached `Texture` promise whose GPU
      // data was invalidated when the FIRST renderer's `app.destroy()` tore down its WebGL
      // context — rendering a blank sprite despite every JS-level "already loaded" check passing.
      const loadSpy = mockAssetsLoad(Texture.WHITE);
      const image = makeImage();
      const resolveAssetUrl = vi.fn().mockResolvedValue("https://example.test/disposed.png");

      const firstView = imageObjectType.createView(image, { x: 0, y: 0 }, resolveAssetUrl);
      await vi.waitFor(() => expect(loadSpy).toHaveBeenCalledTimes(1));

      imageObjectType.onRendererDisposed?.();

      // A brand new view, same assetPath, same resolved URL — without the cache being cleared,
      // `Assets.load` would NOT be called again (the module-level cache would just replay the
      // already-resolved promise from the first, now-disposed renderer).
      imageObjectType.createView(image, { x: 0, y: 0 }, resolveAssetUrl);
      await vi.waitFor(() => expect(loadSpy).toHaveBeenCalledTimes(2));

      void firstView;
      loadSpy.mockRestore();
    });
  });
});
