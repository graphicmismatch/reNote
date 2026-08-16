import { newId, transformedBounds, type Bounds, type PageObject, type PageObjectId } from "@renote/core";
import type { RichTextDocument, RichTextParagraphBlock } from "@renote/text-editor";

/**
 * Copy/paste of canvas objects rides on the SYSTEM clipboard as plain text, not on an in-app
 * variable: that is what makes copying in one window and pasting in another (or into a text editor,
 * where it degrades to readable JSON rather than to nothing) work at all. `ClipboardItem` with a
 * custom MIME type would be tidier, but its support across the three target WebViews is exactly the
 * kind of thing that fails on WebKitGTK, and `writeText`/`readText` are the parts that work
 * everywhere.
 *
 * Everything here is pure — no engine, no scene, no Tauri — so the envelope round-trip and the
 * paste placement math are testable without a canvas.
 */

/** Marks text on the clipboard as ours. Versioned: a future object-shape change bumps it and old
 *  envelopes are then ignored rather than pasted as something half-understood. */
const ENVELOPE_KIND = "renote/objects@1";

/** Where a copied selection came from. Paste compares this against the destination page to decide
 *  whether asset-backed objects (image, file-attachment) need their underlying file copied — an
 *  `assetPath` is relative to its SECTION directory, so it only stays valid within that section. */
export interface ClipboardSource {
  notebookId: string;
  sectionId: string;
  pageId: string;
}

export interface ClipboardEnvelope {
  kind: typeof ENVELOPE_KIND;
  source: ClipboardSource;
  objects: PageObject[];
}

export function encodeObjects(objects: readonly PageObject[], source: ClipboardSource): string {
  const envelope: ClipboardEnvelope = { kind: ENVELOPE_KIND, source, objects: [...objects] };
  return JSON.stringify(envelope);
}

/** Parses clipboard text back into an envelope, or `null` for anything that isn't one of ours —
 *  ordinary copied text, another app's JSON, a truncated paste. Never throws. */
export function decodeObjects(text: string): ClipboardEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as Partial<ClipboardEnvelope>;
  if (candidate.kind !== ENVELOPE_KIND || !Array.isArray(candidate.objects)) return null;
  const source = candidate.source;
  if (
    typeof source !== "object" ||
    source === null ||
    typeof source.notebookId !== "string" ||
    typeof source.sectionId !== "string" ||
    typeof source.pageId !== "string"
  ) {
    return null;
  }
  const objects = candidate.objects.filter(isPageObjectShape);
  if (objects.length === 0) return null;
  return { kind: ENVELOPE_KIND, source, objects };
}

/** Duck-typing rather than per-type validation: each object type's own `validate` runs when the
 *  object reaches the scene, so this only has to reject things that aren't page objects at all. */
function isPageObjectShape(value: unknown): value is PageObject {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PageObject>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.type === "string" &&
    typeof candidate.bounds === "object" &&
    candidate.bounds !== null &&
    typeof candidate.transform === "object" &&
    candidate.transform !== null
  );
}

/** Deep copies with fresh ids, so pasting twice — or pasting back onto the page the objects were
 *  copied from — never collides with what's already in the scene. */
export function withFreshIds(objects: readonly PageObject[]): PageObject[] {
  return objects.map((object) => ({ ...structuredClone(object), id: newId<PageObjectId>() }));
}

/** World-space box containing every object, transforms included. */
export function groupBounds(objects: readonly PageObject[]): Bounds | null {
  if (objects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const object of objects) {
    const bounds = transformedBounds(object.bounds, object.transform);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Shifts every object by the same delta, in place on the passed (already-cloned) objects. Moves
 * `transform.x/y` rather than `bounds.x/y` — the same thing `SelectTool`'s drag does, so a pasted
 * object's intrinsic bounds keep meaning what they meant on the page it came from.
 */
export function translateObjects(objects: PageObject[], dx: number, dy: number): PageObject[] {
  for (const object of objects) {
    object.transform = { ...object.transform, x: object.transform.x + dx, y: object.transform.y + dy };
  }
  return objects;
}

/** Moves a group so its center lands on `center` — where a paste goes, since the copied
 *  coordinates mean nothing on a different page (and, on the same page, would hide the paste
 *  exactly behind the original). */
export function centerObjectsOn(objects: PageObject[], center: { x: number; y: number }): PageObject[] {
  const bounds = groupBounds(objects);
  if (!bounds) return objects;
  return translateObjects(
    objects,
    center.x - (bounds.x + bounds.width / 2),
    center.y - (bounds.y + bounds.height / 2),
  );
}

/**
 * Text pasted from outside the app, as text-box content: one paragraph per line, matching what
 * `renote-import`'s plain-text importer produces for an imported `.txt` file (see that crate's
 * `import_plain_text`) — so text arriving by paste and text arriving by import land as the same
 * shape rather than as two subtly different documents.
 */
export function plainTextContent(text: string): RichTextDocument {
  return {
    paragraphs: text.split(/\r?\n/).map((line): RichTextParagraphBlock => ({
      runs: line === "" ? [] : [{ text: line, marks: [] }],
      listKind: "none",
      indentLevel: 0,
      tagId: null,
      headingLevel: 0,
      blockquoteDepth: 0,
    })),
  };
}

/** Every distinct `data.assetPath` among these objects — image and file-attachment today, audio
 *  later. Read duck-typed for the same reason `page-anchors.ts` duck-types page-object data: it is
 *  untyped JSON as far as this layer is concerned. */
export function assetPathsOf(objects: readonly PageObject[]): string[] {
  const paths: string[] = [];
  for (const object of objects) {
    const assetPath = (object.data as { assetPath?: unknown })?.assetPath;
    if (typeof assetPath === "string" && assetPath !== "" && !paths.includes(assetPath)) {
      paths.push(assetPath);
    }
  }
  return paths;
}

/** Rewrites `data.assetPath` in place from a source→destination map, for objects whose asset was
 *  copied into the destination section. Objects with no asset, or no entry in the map, are left
 *  exactly as they are. */
export function remapAssetPaths(objects: PageObject[], remapped: ReadonlyMap<string, string>): PageObject[] {
  for (const object of objects) {
    const assetPath = (object.data as { assetPath?: unknown })?.assetPath;
    if (typeof assetPath !== "string") continue;
    const next = remapped.get(assetPath);
    if (next) object.data = { ...(object.data as object), assetPath: next };
  }
  return objects;
}
