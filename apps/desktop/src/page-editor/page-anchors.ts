import type { PageEngine } from "@renote/canvas-engine";
import { transformedBounds, type Bounds, type PageObject } from "@renote/core";

/**
 * Where a wikilink points: its target page, plus (optionally) a heading WITHIN that page — see
 * `packages/text-editor`'s `TextMark.attr3`. `displayText` is carried along because it is the
 * target page's title as of when the link was made, which is what the cross-notebook page lookup
 * in `AppShell`'s `handleFollowLink` searches on.
 */
export interface WikilinkTarget {
  pageId: string;
  displayText: string;
  anchor: string | null;
}

/** Plain text of one paragraph-shaped block's runs. Duck-typed against `unknown` for the same
 *  reason `text-box-object-type.ts` duck-types the same shape: this file reads page objects whose
 *  `data` is untyped JSON off the wire. Exported for `browser-storage-client.ts`'s
 *  `listTaggedParagraphs`, which needs the same "read a tagged paragraph's own text" extraction
 *  the real backend's `renote_index::paragraph_text` does. */
export function blockText(block: unknown): string {
  if (typeof block !== "object" || block === null) return "";
  const runs = (block as { runs?: unknown }).runs;
  if (!Array.isArray(runs)) return "";
  return runs
    .map((run) => {
      if (typeof run !== "object" || run === null) return "";
      const text = (run as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

/** Every paragraph-shaped block of a text box's `data.content`, in document order. Exported for
 *  the same reason as `blockText` above. */
export function contentBlocks(object: PageObject): unknown[] {
  if (object.type !== "text-box") return [];
  const content = (object.data as { content?: unknown }).content;
  if (typeof content !== "object" || content === null) return [];
  const paragraphs = (content as { paragraphs?: unknown }).paragraphs;
  return Array.isArray(paragraphs) ? paragraphs : [];
}

/**
 * Every heading on the page, in scene order — the anchor list the wikilink popover offers when
 * the user types `[[#`. A heading is any paragraph with a nonzero `headingLevel`, i.e. anything
 * typed as `# Heading` (see `markdown-input-rules.ts`); duplicates are dropped, since an anchor
 * can only ever resolve to the first match anyway (see `findAnchorObject`).
 */
export function listPageAnchors(objects: Iterable<PageObject>): string[] {
  const anchors: string[] = [];
  for (const object of objects) {
    for (const block of contentBlocks(object)) {
      const headingLevel = (block as { headingLevel?: unknown }).headingLevel;
      if (typeof headingLevel !== "number" || headingLevel <= 0) continue;
      const text = blockText(block).trim();
      if (text !== "" && !anchors.includes(text)) anchors.push(text);
    }
  }
  return anchors;
}

/** The text box holding the heading `anchor`, or `undefined` when the page has no such heading
 *  (e.g. the heading was renamed or deleted after the link was made — the link then still
 *  navigates to the page, just not to a specific spot). Matching is on trimmed heading text. */
export function findAnchorObject(objects: Iterable<PageObject>, anchor: string): PageObject | undefined {
  const wanted = anchor.trim();
  for (const object of objects) {
    for (const block of contentBlocks(object)) {
      const headingLevel = (block as { headingLevel?: unknown }).headingLevel;
      if (typeof headingLevel !== "number" || headingLevel <= 0) continue;
      if (blockText(block).trim() === wanted) return object;
    }
  }
  return undefined;
}

/**
 * The first wikilink mark inside a text box, or `null` for an object carrying none. Reads the
 * same `{kind: "wikilink", attr, attr2, attr3}` JSON the Rust-side index walk reads (see
 * `TextMark`'s doc comments) rather than any live editor state, so it works on a "cold" object
 * straight out of the scene graph.
 */
export function firstWikilinkOf(object: PageObject): WikilinkTarget | null {
  for (const block of contentBlocks(object)) {
    const runs = (block as { runs?: unknown }).runs;
    if (!Array.isArray(runs)) continue;
    for (const run of runs) {
      const marks = (run as { marks?: unknown })?.marks;
      if (!Array.isArray(marks)) continue;
      for (const mark of marks) {
        if (typeof mark !== "object" || mark === null) continue;
        const record = mark as { kind?: unknown; attr?: unknown; attr2?: unknown; attr3?: unknown };
        if (record.kind !== "wikilink" || typeof record.attr !== "string" || record.attr === "") continue;
        return {
          pageId: record.attr,
          displayText: typeof record.attr2 === "string" ? record.attr2 : "",
          anchor: typeof record.attr3 === "string" && record.attr3 !== "" ? record.attr3 : null,
        };
      }
    }
  }
  return null;
}

/**
 * Where a `link-button` object points, or `null` for a button whose target has not been picked
 * yet (and for every other object type). The button stores its target in the same field shape a
 * wikilink mark uses — see `LinkButtonTarget` in `@renote/core` for why — so this is a rename of
 * those fields, not a parse.
 */
export function linkButtonTarget(object: PageObject): WikilinkTarget | null {
  if (object.type !== "link-button") return null;
  const target = (object.data as { target?: unknown }).target;
  if (typeof target !== "object" || target === null) return null;
  const record = target as { attr?: unknown; attr2?: unknown; attr3?: unknown };
  if (typeof record.attr !== "string" || record.attr === "") return null;
  return {
    pageId: record.attr,
    displayText: typeof record.attr2 === "string" ? record.attr2 : "",
    anchor: typeof record.attr3 === "string" && record.attr3 !== "" ? record.attr3 : null,
  };
}

/**
 * The link a text box carries when the box is nothing BUT that link — one paragraph, one run,
 * wikilink-marked, which is exactly what the "Insert Link" button spawns. `null` for anything
 * else, including a prose box with a link somewhere inside it.
 *
 * That restriction is what makes a plain canvas click safe to treat as "follow this link" (see
 * `PageEditorView`'s `handleCanvasClick`): a link chip is a link and nothing else, so clicking it
 * can only have meant "go there", while a paragraph of prose containing a link is still an
 * ordinary object the user clicks to select and drag. Links inside prose are followed from the
 * editor instead — double-click the box, then click the link.
 */
export function linkChipTarget(object: PageObject): WikilinkTarget | null {
  const blocks = contentBlocks(object);
  if (blocks.length !== 1) return null;
  const runs = (blocks[0] as { runs?: unknown }).runs;
  if (!Array.isArray(runs) || runs.length !== 1) return null;
  return firstWikilinkOf(object);
}

/** Every object whose text content contains `query` (case-insensitive, trimmed), in scene order —
 *  the match list a find-in-page bar (Phase 11.6) steps through. Text boxes only, same
 *  content-reading scope every other helper in this file uses; an empty/whitespace-only query
 *  matches nothing rather than everything. */
export function findMatchingObjects(objects: Iterable<PageObject>, query: string): PageObject[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const matches: PageObject[] = [];
  for (const object of objects) {
    const text = contentBlocks(object).map(blockText).join(" ").toLowerCase();
    if (text.includes(needle)) matches.push(object);
  }
  return matches;
}

/** Pans the camera (zoom untouched) so `bounds` sits in the middle of the viewport — how a
 *  followed link "arrives" at its destination, for both an in-page anchor and a link that just
 *  navigated to another page. */
export function centerCameraOn(engine: PageEngine, bounds: Bounds): void {
  const camera = engine.getCamera();
  const viewport = engine.getViewport();
  engine.setCamera(
    bounds.x + bounds.width / 2 - viewport.width / (2 * camera.zoom),
    bounds.y + bounds.height / 2 - viewport.height / (2 * camera.zoom),
    camera.zoom,
  );
}

/** Centers the camera on the heading `anchor` if the page has one. Returns whether it did, so a
 *  caller can tell "arrived at the anchor" from "landed on the page, anchor gone". */
export function centerCameraOnAnchor(engine: PageEngine, anchor: string): boolean {
  const object = findAnchorObject(engine.scene.all, anchor);
  if (!object) return false;
  centerCameraOn(engine, transformedBounds(object.bounds, object.transform));
  return true;
}
