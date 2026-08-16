import { describe, expect, it } from "vitest";
import type { Container, Graphics } from "pixi.js";
import { identityTransform, newId, type PageObjectId } from "@renote/core";
import {
  fileAttachmentObjectType,
  formatFileSize,
  type FileAttachmentObject,
} from "./file-attachment-object-type.js";

function makeFileAttachment(overrides: Partial<FileAttachmentObject["data"]> = {}): FileAttachmentObject {
  return {
    id: newId<PageObjectId>(),
    type: "file-attachment",
    transform: identityTransform(),
    bounds: { x: 0, y: 0, width: 160, height: 32 },
    data: {
      assetPath: "assets/files/report.pdf",
      fileName: "report.pdf",
      fileSizeBytes: 123456,
      mimeType: "application/pdf",
      ...overrides,
    },
  };
}

describe("fileAttachmentObjectType", () => {
  it("hits a point inside the bounds rect and misses one outside it", () => {
    const attachment = makeFileAttachment();
    expect(fileAttachmentObjectType.hitTest(attachment, { x: 50, y: 16 })).toBe(true);
    expect(fileAttachmentObjectType.hitTest(attachment, { x: 500, y: 500 })).toBe(false);
  });

  it("validates well-formed data and rejects malformed data", () => {
    const good = {
      assetPath: "a.pdf",
      fileName: "a.pdf",
      fileSizeBytes: 100,
      mimeType: "application/pdf",
    };
    expect(fileAttachmentObjectType.validate(good)).toEqual(good);

    expect(() => fileAttachmentObjectType.validate(null)).toThrow();
    expect(() => fileAttachmentObjectType.validate({ ...good, fileSizeBytes: -1 })).toThrow();
    expect(() => fileAttachmentObjectType.validate({ ...good, fileName: 5 })).toThrow();
    expect(() => fileAttachmentObjectType.validate({ ...good, mimeType: undefined })).toThrow();
  });

  it("createView/updateView run without throwing", () => {
    const attachment = makeFileAttachment();
    const view = fileAttachmentObjectType.createView(attachment, { x: 0, y: 0 });
    expect(() => fileAttachmentObjectType.updateView(view, attachment, { x: 0, y: 0 })).not.toThrow();
  });

  it("draws chunk-local geometry when given a non-zero origin, not raw world coordinates", () => {
    const attachment = makeFileAttachment();
    const farAttachment: FileAttachmentObject = {
      ...attachment,
      bounds: { x: 1_000_000, y: 1_000_000, width: 160, height: 32 },
    };
    const origin = { x: 999_000, y: 999_000 };
    const view = fileAttachmentObjectType.createView(farAttachment, origin) as Container & {
      border: Graphics;
    };
    const bounds = view.border.getLocalBounds();

    // Chunk-local: near (1000, 1000), not (1_000_000, 1_000_000).
    expect(bounds.x).toBeGreaterThan(900);
    expect(bounds.x).toBeLessThan(1100);
    expect(bounds.y).toBeGreaterThan(900);
    expect(bounds.y).toBeLessThan(1100);
  });

  it("does not support rotation or resize", () => {
    expect(fileAttachmentObjectType.supportsRotation).toBe(false);
    expect(fileAttachmentObjectType.supportsResize).toBe(false);
  });
});

describe("formatFileSize", () => {
  it("formats 0 bytes", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it("formats sub-KB byte counts without decimals", () => {
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("formats exactly 1024 bytes as 1.0 KB", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
  });

  it("formats larger KB values with one decimal", () => {
    expect(formatFileSize(12_600)).toBe("12.3 KB");
  });

  it("rolls a rounded value over to the next unit instead of printing an out-of-range number", () => {
    // 1023.6 B rounds to 1024 B, which must roll over to "1.0 KB", not print "1024 B".
    expect(formatFileSize(1023.6)).toBe("1.0 KB");
    // 1 MB minus 1 byte rounds to "1024.0 KB" before rollover; must roll over to "1.0 MB".
    expect(formatFileSize(1024 * 1024 - 1)).toBe("1.0 MB");
  });

  it("formats MB and GB values", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(4.1 * 1024 * 1024)).toBe("4.1 MB");
    expect(formatFileSize(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  it("rejects negative input", () => {
    expect(() => formatFileSize(-1)).toThrow();
  });
});
