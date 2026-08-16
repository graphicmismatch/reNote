import { describe, expect, it } from "vitest";
import { identityTransform, newId, type PageObjectId } from "@renote/core";
import { audioClipObjectType, formatDuration, type AudioClipObject } from "./audio-clip-object-type.js";

function makeAudioClip(overrides: Partial<AudioClipObject["data"]> = {}): AudioClipObject {
  return {
    id: newId<PageObjectId>(),
    type: "audio-clip",
    transform: identityTransform(),
    bounds: { x: 0, y: 0, width: 240, height: 36 },
    data: {
      assetPath: "assets/page-1/recording.webm",
      durationSeconds: 65,
      ...overrides,
    },
  };
}

describe("audioClipObjectType", () => {
  it("hits a point inside the bounds rect and misses one outside it", () => {
    const clip = makeAudioClip();
    expect(audioClipObjectType.hitTest(clip, { x: 50, y: 16 })).toBe(true);
    expect(audioClipObjectType.hitTest(clip, { x: 500, y: 500 })).toBe(false);
  });

  it("validates well-formed data and rejects malformed data", () => {
    const good = { assetPath: "a.webm", durationSeconds: 12 };
    expect(audioClipObjectType.validate(good)).toEqual(good);

    expect(() => audioClipObjectType.validate(null)).toThrow();
    expect(() => audioClipObjectType.validate({ ...good, assetPath: 5 })).toThrow();
    expect(() => audioClipObjectType.validate({ ...good, durationSeconds: -1 })).toThrow();
  });

  it("createView/updateView run without throwing", () => {
    const clip = makeAudioClip();
    const view = audioClipObjectType.createView(clip, { x: 0, y: 0 });
    expect(() => audioClipObjectType.updateView(view, clip, { x: 0, y: 0 })).not.toThrow();
  });

  it("does not support rotation or resize", () => {
    expect(audioClipObjectType.supportsRotation).toBe(false);
    expect(audioClipObjectType.supportsResize).toBe(false);
  });
});

describe("formatDuration", () => {
  it("formats sub-minute durations", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9)).toBe("0:09");
  });

  it("formats minutes and seconds with zero-padded seconds", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("rejects negative or non-finite input", () => {
    expect(() => formatDuration(-1)).toThrow();
    expect(() => formatDuration(Number.NaN)).toThrow();
  });
});
