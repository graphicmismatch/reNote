import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { PixelButton } from "@renote/ui";
import {
  InkSettingsRegistry,
  NullRenderer,
  PageEngine,
  PixiRenderer,
  UpdateObjectCommand,
  computeSelectionGeometry,
  linkButtonLabel,
  linkButtonWidthFor,
  registerBuiltInObjectTypes,
  registerBuiltInTools,
  type CameraChangedPayload,
  type HandleId,
  type LinkEditBeginPayload,
  type PointerSourceOverrides,
  type TextEditBeginPayload,
  type TextEditEndPayload,
} from "@renote/canvas-engine";
import {
  boundsCenter,
  transformedBounds,
  type Bounds,
  type LinkButtonData,
  type LinkButtonTarget,
  type PageObject,
  type PageObjectId,
  type TextBoxData,
} from "@renote/core";
import {
  ProseMirrorRichTextField,
  cameraToCssTransform,
  emptyRichTextDocument,
  type RichTextDocument,
  type WikilinkTriggerRange,
} from "@renote/text-editor";
import type { PageLocationDto, TagDto } from "@renote/storage-client";
import { applyAutoInkColorForBackground } from "../app-shell/auto-ink-switch.js";
import { useStorageClient } from "../providers/StorageProvider.js";
import { locationLabel, matchLinkPath, parseLinkPath } from "./link-path.js";
import {
  centerCameraOnAnchor,
  linkButtonTarget,
  linkChipTarget,
  listPageAnchors,
  type WikilinkTarget,
} from "./page-anchors.js";

/** How long to wait after the last scene-affecting command before persisting. */
const SAVE_DEBOUNCE_MS = 800;

/**
 * Text boxes autosize to fit their content while being edited, in both width and height — see
 * the "Autosize" section of `beginTextEdit` below. These are the floor/ceiling that keeps an
 * empty box from collapsing to nothing and a single very long unbroken line from stretching
 * across the whole canvas: width grows up to `AUTOSIZE_MAX_WIDTH`, at which point text wraps
 * and height grows instead. The minimums intentionally match `TextBoxTool`'s own
 * `DEFAULT_WIDTH`/`DEFAULT_HEIGHT` placement size, so a freshly placed, not-yet-typed-into box
 * looks identical the moment it drops into editing as it did a frame earlier as a cold
 * placeholder.
 */
const AUTOSIZE_MIN_WIDTH = 220;
const AUTOSIZE_MIN_HEIGHT = 32;
const AUTOSIZE_MAX_WIDTH = 480;

/** How far the pointer may travel between down and up for the gesture to still count as a click
 *  on a link chip rather than a drag of it (screen pixels). */
const CLICK_SLOP_PX = 4;

/** Two clicks on the same link button within this window re-open its target picker. Matches
 *  `SelectTool`'s own `DOUBLE_CLICK_WINDOW_MS`, so "double-click" means one thing app-wide. */
const LINK_DOUBLE_CLICK_WINDOW_MS = 400;

/**
 * A `TextBoxData.content` value only counts as an existing `RichTextDocument`
 * if it already has the shape one produces (a fresh text box's content is
 * `""`, not a document) — otherwise this is where we drop into editing a
 * brand-new, empty document.
 */
function isRichTextDocument(content: unknown): content is RichTextDocument {
  return (
    typeof content === "object" &&
    content !== null &&
    Array.isArray((content as { paragraphs?: unknown }).paragraphs)
  );
}

/**
 * `TextBoxData.backgroundColor`/`backgroundOpacity` are stored as separate fields (a plain hex
 * color plus an independent 0-1 opacity — see that field's own doc comment for why: a single
 * `background-color` CSS value can't be driven by two independently-changing controls, a color
 * swatch and an opacity slider, without one clobbering the other's format), so applying them as
 * a single CSS `background` needs them combined into one `rgba(...)` string here.
 */
function hexToRgba(hex: string, opacity: number): string {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => char + char)
          .join("")
      : normalized;
  const r = Number.parseInt(full.slice(0, 2), 16) || 0;
  const g = Number.parseInt(full.slice(2, 4), 16) || 0;
  const b = Number.parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/** Small, reasonably-saturated set of colors for the text-color/default-text-color toolbar
 *  rows — mirrors `ToolSettingsPanel.tsx`'s own `PRESET_COLORS` (this file can't import that
 *  React component, since the floating toolbar is built with raw DOM calls, not React, but the
 *  palette itself is worth keeping visually consistent with the rest of the app's color pickers). */
const TEXT_COLOR_PRESETS = ["#000000", "#8b0000", "#1e5fd9", "#1b7a3d", "#e07b00", "#6b2fa8"];
/** Light tints for the background-color row — mirrors `PageBackgroundPanel.tsx`'s own
 *  `PRESET_PAPER_COLORS` palette for the same "a text box's fill is usually a paper-like tint,
 *  not a saturated ink color" reasoning. */
const BACKGROUND_COLOR_PRESETS = ["#ffffff", "#fdf6e3", "#e6f2ff", "#e6ffe6", "#ffe6e6", "#f0e6ff"];

/**
 * Builds one row of the floating text-toolbar: a label, a swatch button per preset color, and a
 * custom-color `<input type="color">` — the same shape `ToolSettingsPanel.tsx`/
 * `PageBackgroundPanel.tsx` use, reimplemented with raw DOM calls since this toolbar (like the
 * tag picker before it) is imperative, not React (see `beginTextEdit`'s own doc comment on why).
 * `onPick` fires with the chosen hex color for both a swatch click and a custom-color change —
 * callers don't need to distinguish which.
 */
function buildSwatchRow(
  labelText: string,
  presets: string[],
  customInputValue: string,
  onPick: (color: string) => void,
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "renote-text-toolbar-row";

  const label = document.createElement("span");
  label.className = "renote-text-toolbar-label";
  label.textContent = labelText;
  row.appendChild(label);

  for (const preset of presets) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "renote-text-toolbar-swatch";
    swatch.style.backgroundColor = preset;
    swatch.setAttribute("aria-label", `${labelText}: ${preset}`);
    // mousedown + preventDefault, not click — matches the wikilink popover's own existing
    // pattern (see `renderWikilinkCandidates`) so a swatch click never disturbs whatever text
    // selection/cursor position the field currently has before `onPick` runs.
    swatch.addEventListener("mousedown", (event) => {
      event.preventDefault();
      onPick(preset);
    });
    row.appendChild(swatch);
  }

  const custom = document.createElement("input");
  custom.type = "color";
  custom.className = "renote-text-toolbar-custom-color";
  custom.value = customInputValue;
  custom.setAttribute("aria-label", `Custom ${labelText.toLowerCase()} color`);
  custom.addEventListener("input", () => onPick(custom.value));
  row.appendChild(custom);

  return row;
}

/** A small text button ("Default"/"None") appended to a swatch row to clear back to the unset
 *  state — same `mousedown` + `preventDefault` reasoning as each swatch button above. */
function buildClearButton(labelText: string, onClear: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "renote-text-toolbar-clear-button";
  button.textContent = labelText;
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    onClear();
  });
  return button;
}

/**
 * One row in the wikilink popover: an existing page to link to, or — when `anchor` is set — a
 * heading on the current page to jump to (`id` is then the current page's own id, since an
 * in-page anchor is a link to this page that lands somewhere specific). `title` is the link's
 * display text either way.
 */
interface WikilinkCandidate {
  id: string;
  title: string;
  anchor?: string;
  /** `Notebook > Section` — where this page lives, shown as a second line under `title` so two
   *  same-titled pages in different sections are told apart at a glance. Absent for a heading on
   *  the page already open, which has no elsewhere to point at. */
  location?: string;
}

/** One suggestion row, shared by the `[[` popover and the link-button picker: the page title (or
 *  `# Heading` for an in-page anchor) with its location underneath, all inside one button so the
 *  whole row is the click target. `mousedown` with `preventDefault`, never `click`, so the
 *  editor's/input's selection and focus never move before `onPick` reads them. */
function buildCandidateButton(candidate: WikilinkCandidate, onPick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "renote-wikilink-picker-item";
  const label =
    candidate.location === undefined && candidate.anchor
      ? `# ${candidate.anchor}`
      : candidate.anchor
        ? `${candidate.title} # ${candidate.anchor}`
        : candidate.title;
  button.appendChild(document.createTextNode(label));
  if (candidate.location !== undefined) {
    const where = document.createElement("span");
    where.className = "renote-wikilink-picker-location";
    where.textContent = candidate.location;
    button.appendChild(where);
  }
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    onPick();
  });
  return button;
}

export interface PageEditorViewProps {
  /** Owning notebook/section, required alongside `pageId` for load/save to run. */
  notebookId?: string;
  sectionId?: string;
  /** When provided, identifies which page to load on mount and save to on edits. */
  pageId?: string;
  /** The open page's own title. Used only to label a link button pointed at a heading on THIS
   *  page (see the link-target picker) — every other target's label comes from the search hit. */
  pageTitle?: string;
  onEngineReady?: (engine: PageEngine) => void;
  onEngineDispose?: () => void;
  /**
   * Fired after each debounced `savePageObjects` call resolves successfully. `AppShell` uses
   * this to bump its backlinks refresh token — a save is exactly what can add/remove a
   * wikilink, entirely outside this component's knowledge, so without this callback the
   * Backlinks panel would never learn about it until some unrelated state change happened to
   * re-run its fetch effect.
   */
  onSaved?: () => void;
  /**
   * Fired right after the wikilink-autocomplete "no existing page with this title" path
   * (see the "Wikilink autocomplete" section below) auto-creates a brand-new page via
   * `StorageClient.createLinkedPage`. `AppShell` owns the `pages`/tree-node lists this
   * component never touches directly, so without this callback a page created this way
   * would be invisible in the sidebar/tree until some unrelated state change happened to
   * re-run those fetch effects — mirrors `onSaved`'s exact "tell the owner something
   * changed outside its own state" reasoning above.
   */
  onLinkedPageCreated?: () => void;
  /**
   * Passed straight into `new PageEngine(renderer, inkSettings)`. Owning this at the
   * `AppShell` level (rather than letting each mount create its own) is what lets a
   * user-chosen pen color survive navigating to a different page, since this component's
   * main effect recreates the `PageEngine` itself on every `pageId` change — see
   * `PageEngine.inkSettings`'s doc comment. Defaults to a fresh instance if omitted (e.g.
   * in tests that don't care about cross-page persistence).
   */
  inkSettings?: InkSettingsRegistry;
  /**
   * Passed straight into `new PageEngine(renderer, inkSettings, pointerSourceOverrides)`.
   * Same cross-remount-persistence reasoning as `inkSettings` above: owned at the `AppShell`
   * level (via `useSettings()`'s stable ref) so a device-treatment override set in the
   * Settings dialog survives navigating to a different page. Defaults to `{}` (no overrides)
   * if omitted.
   */
  pointerSourceOverrides?: PointerSourceOverrides;
  /**
   * Passed straight into `registerBuiltInTools(engine, { recognizeShapesRef })`. Same live-ref
   * idiom as `pointerSourceOverrides` above (owned at `AppShell` via `useSettings()`), so
   * toggling "Recognize shapes while drawing" in the Settings dialog applies to the very next
   * stroke without remounting the engine. Defaults to a fixed `false` ref if omitted.
   */
  recognizeShapesRef?: MutableRefObject<boolean>;
  /** Current tool id, used only to show/hide the eraser-radius cursor ring — see the second
   *  effect below. Not required for the engine/tool system itself, which already tracks its
   *  own active tool independently via `engine.tools`. */
  activeToolId?: string;
  /**
   * The open notebook's tags, offered by the tag-picker shown alongside the text-edit overlay
   * (see the "Text-box DOM-overlay seam" section below). Read via a ref inside the mount
   * effect rather than being a dependency of it, so a tag being created/renamed/deleted
   * elsewhere in the app never remounts the engine mid-edit.
   */
  availableTags?: TagDto[];
  /**
   * Fired when the user clicks a wikilink — either on the `<a>` inside the text-edit overlay, or
   * on a "cold" text box on the canvas holding one (see the "Following a link" section below).
   * This component owns neither notebook/section navigation nor the page lookup a cross-notebook
   * link needs, so it only reports WHICH link was clicked; `AppShell` decides where that goes.
   * An in-page anchor on the CURRENT page is the one case handled here directly (a camera pan,
   * no navigation at all) — see `handleLinkClick`.
   */
  onFollowLink?: (target: WikilinkTarget) => void;
  /**
   * A heading to center the camera on once this page finishes loading — set by `AppShell` when
   * the link it is following points at an anchor on a DIFFERENT page, since the anchor's object
   * doesn't exist in any scene until that page's own load resolves. Read through a ref inside
   * the mount effect (same reasoning as `availableTags`) and consumed once.
   */
  pendingAnchor?: string | null;
  /**
   * Bump this (e.g. a counter) to force the mount effect below to re-run
   * for the SAME `pageId` — used after restoring the autosave (see
   * `AppShell`'s "Autosave" wiring), where the page's on-disk
   * content changed but its id didn't, so nothing else in this effect's
   * dependency list would otherwise notice. Remounting the whole engine
   * (rather than surgically diffing the scene) is deliberate: it gives a
   * restore the exact same "fresh load" semantics as switching pages —
   * a clean scene AND a reset undo/redo history, so no stale command
   * references an object as it existed before the restore.
   */
  reloadToken?: number;
  /**
   * The open page's `modifiedAt` as of the last write `AppShell` itself made to it (a rename or
   * a background change — both leave the object list alone). Without this, the next debounced
   * save would compare a stale timestamp and report a conflict against the app's own write. The
   * `pageId` travels with it so a value left over from the previous page is ignored rather than
   * adopted after a page switch.
   */
  pageRevision?: { pageId: string; modifiedAt: string };
}

/**
 * The thin React wrapper the project plan calls for: it owns nothing about
 * scene graph, tools, or rendering — it just mounts a PageEngine into a
 * container element and tears it down on unmount. All canvas behavior lives
 * in packages/canvas-engine, which never imports React.
 *
 * The one exception is the text-box DOM-overlay seam: canvas-engine cannot
 * depend on @renote/text-editor (boundary-lint forbids sibling-package
 * imports), so this is the one place — the only place allowed to depend on
 * both packages — that listens for "text-edit:begin"/"text-edit:end" and
 * mounts/unmounts a real RichTextField over the "cold" Pixi placeholder.
 *
 * When `pageId` (plus its owning `notebookId`/`sectionId`) is given, this view
 * also owns that page's persistence: it loads the page's objects into the
 * scene right after mount, and debounces a save on every command-stack change
 * afterwards. The effect remounts the engine whenever `pageId` changes so a
 * page switch never leaks scene state or undo history from the previous page.
 */
export function PageEditorView({
  notebookId,
  sectionId,
  pageId,
  pageTitle,
  onEngineReady,
  onEngineDispose,
  onSaved,
  onLinkedPageCreated,
  inkSettings,
  pointerSourceOverrides,
  recognizeShapesRef,
  activeToolId,
  availableTags,
  onFollowLink,
  pendingAnchor,
  reloadToken,
  pageRevision,
}: PageEditorViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PageEngine | null>(null);
  const storageClient = useStorageClient();
  const availableTagsRef = useRef<TagDto[]>(availableTags ?? []);
  useEffect(() => {
    availableTagsRef.current = availableTags ?? [];
  }, [availableTags]);
  // Same "read it fresh without remounting the engine" reasoning as `availableTagsRef`: a link
  // click, a tool switch, or a pending anchor must never be a dependency of the mount effect.
  const onFollowLinkRef = useRef(onFollowLink);
  useEffect(() => {
    onFollowLinkRef.current = onFollowLink;
  }, [onFollowLink]);
  const pendingAnchorRef = useRef(pendingAnchor ?? null);
  useEffect(() => {
    pendingAnchorRef.current = pendingAnchor ?? null;
  }, [pendingAnchor]);
  const activeToolIdRef = useRef(activeToolId);
  useEffect(() => {
    activeToolIdRef.current = activeToolId;
  }, [activeToolId]);
  const pageTitleRef = useRef(pageTitle ?? "This page");
  useEffect(() => {
    pageTitleRef.current = pageTitle ?? "This page";
  }, [pageTitle]);

  // --- External-change conflict state --------------------------------------
  // The page's `modifiedAt` as this mount last saw it (from the load, then from each save's
  // returned `PageDto`). Sent as `expectedModifiedAt` on every save so the backend can refuse to
  // clobber a page something else rewrote meanwhile — see `save_page_objects`'s guard.
  const loadedModifiedAtRef = useRef<string | null>(null);
  /** Their `modifiedAt` when a save was refused, which is also what shows the conflict bar. */
  const [conflict, setConflict] = useState<string | null>(null);
  /** Mirrors `conflict` for the save closure, which can't see the state value. */
  const conflictedRef = useRef(false);
  /** Set by "Keep mine" to make the next save skip the guard once. */
  const forceSaveRef = useRef(false);
  /** The live mount's `flushSave`, so "Keep mine" can re-fire the refused save. */
  const flushSaveRef = useRef<(() => void) | null>(null);
  /** Bumped by "Reload from disk" — added to the `reloadToken` prop so a conflict reload is the
   *  same full remount-and-reload an autosave restore already triggers. */
  const [conflictReloadToken, setConflictReloadToken] = useState(0);
  const effectiveReloadToken = (reloadToken ?? 0) + conflictReloadToken;

  // A rename or a background change writes the SAME page file from `AppShell`, stamping a fresh
  // `modifiedAt` — which would otherwise look exactly like an external change to the next save
  // and raise a false conflict. Those writes leave the object list untouched, so adopting their
  // timestamp is correct: this mount's scene is still in sync with what's on disk.
  useEffect(() => {
    if (pageRevision === undefined || pageRevision.pageId !== pageId) return;
    loadedModifiedAtRef.current = pageRevision.modifiedAt;
  }, [pageRevision, pageId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Real image rendering (Phase 5.9): `PixiRenderer` needs a way to turn a persisted,
    // relative `data.assetPath` into a URL a `Texture` can actually load from — see
    // `ResolveAssetUrl`'s doc comment on `object-type-definition.ts` for why that resolution
    // can't happen inside canvas-engine itself. `StorageClient.resolveAssetPath` already
    // returns a directly-loadable URL either way (a Tauri asset-protocol URL for the real
    // client, a `data:` URL for the fake one — see each implementation's own doc comment), so
    // this closure is just "which notebook/section this mount belongs to" plus a pass-through.
    // Undefined when there's no notebook/section context yet (e.g. no page open) — canvas-engine
    // treats that exactly like `NullRenderer`: images stay in their placeholder-drawn state.
    const resolveAssetUrl =
      notebookId && sectionId
        ? (assetPath: string) => storageClient.resolveAssetPath({ notebookId, sectionId, assetPath })
        : undefined;

    const renderer =
      typeof window !== "undefined" && "WebGL2RenderingContext" in window
        ? new PixiRenderer(resolveAssetUrl)
        : new NullRenderer();
    const engine = new PageEngine(
      renderer,
      inkSettings ?? new InkSettingsRegistry(),
      pointerSourceOverrides ?? {},
    );
    engineRef.current = engine;
    registerBuiltInObjectTypes(engine);
    registerBuiltInTools(engine, { recognizeShapesRef });
    engine.tools.activate("select");
    engine.mount(container);
    onEngineReady?.(engine);

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      engine.resize(width, height);
    });
    resizeObserver.observe(container);

    // --- Page load/save ----------------------------------------------------
    let loadCancelled = false;
    let saveTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let unsubscribeCommandsChanged: (() => void) | undefined;

    let pendingSave = false;
    const flushSave = () => {
      if (saveTimeoutId !== undefined) clearTimeout(saveTimeoutId);
      saveTimeoutId = undefined;
      if (!pendingSave || !notebookId || !sectionId || !pageId) return;
      // Once a save has been refused, every later edit would be refused the same way — so stop
      // until the user picks "Keep mine" (which sets `forceSaveRef`) or "Reload from disk"
      // (which remounts). `pendingSave` deliberately stays true, so whichever they pick still
      // has the accumulated edits to write.
      if (conflictedRef.current && !forceSaveRef.current) return;
      const force = forceSaveRef.current;
      forceSaveRef.current = false;
      pendingSave = false;
      storageClient
        .savePageObjects({
          notebookId,
          sectionId,
          pageId,
          objects: [...engine.scene.all],
          expectedModifiedAt: force ? null : loadedModifiedAtRef.current,
        })
        .then((page) => {
          loadedModifiedAtRef.current = page.modifiedAt;
          conflictedRef.current = false;
          setConflict(null);
          onSaved?.();
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (message.startsWith("conflict:")) {
            conflictedRef.current = true;
            pendingSave = true;
            setConflict(message.slice("conflict:".length));
            return;
          }
          console.error("Failed to save page objects.", error);
        });
    };
    flushSaveRef.current = flushSave;

    if (pageId && notebookId && sectionId) {
      storageClient
        .loadPageDocument({ notebookId, sectionId, pageId })
        .then((document) => {
          if (loadCancelled) return;
          // What every save from this mount on is checked against (see `flushSave`). Freshly
          // loaded content is by definition in sync, so any conflict from a previous mount of
          // this component — or a previous page — is cleared here.
          loadedModifiedAtRef.current = document.modifiedAt;
          conflictedRef.current = false;
          setConflict(null);
          engine.setPageBackground(document.background);
          // Auto black/white ink-switch (Phase 5.10), automatic-on-load path: flips each
          // black/white-defaulted tool's *default* color to match this page's own paper color —
          // see `applyAutoInkColorForBackground`'s doc comment. `AppShell`'s background-panel
          // change handler calls the exact same helper for the immediate-feedback-on-edit path,
          // so the two never drift out of sync.
          applyAutoInkColorForBackground(engine, document.background);
          for (const object of document.objects) {
            engine.scene.add(object as unknown as PageObject);
          }
          // Arrived here by following a link to an anchor on THIS page (see `pendingAnchor`) —
          // now that the objects exist, the heading can actually be found and centered. Consumed
          // unconditionally, whether or not the heading still exists: a link whose target heading
          // was since renamed lands at the top of the page rather than silently re-centering on
          // some later, unrelated load.
          const anchor = pendingAnchorRef.current;
          if (anchor !== null) {
            pendingAnchorRef.current = null;
            centerCameraOnAnchor(engine, anchor);
          }
        })
        .catch((error: unknown) => {
          console.error("Failed to load page document.", error);
        });

      unsubscribeCommandsChanged = engine.commands.events.on("changed", () => {
        pendingSave = true;
        if (saveTimeoutId !== undefined) clearTimeout(saveTimeoutId);
        saveTimeoutId = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
      });
    }

    // --- Text-box DOM-overlay seam ---------------------------------------
    let activeField: ProseMirrorRichTextField | null = null;
    let activeOverlay: HTMLDivElement | null = null;
    let activeObjectId: PageObjectId | null = null;
    let activeWorldBounds: Bounds | null = null;
    /** The object's rotation as of when editing began — fixed for the whole edit session (you
     *  can't rotate an object while it's being edited: `SelectTool.beginHandleGesture` ends any
     *  in-progress edit before a rotate/scale gesture can start), so unlike `activeWorldBounds`
     *  (which autosize can make stale — see `onCameraChanged`'s fresh re-derivation) this never
     *  needs re-reading from the scene. */
    let activeRotation = 0;
    let activeToolbar: HTMLDivElement | null = null;
    let activeAutosizeObserver: ResizeObserver | null = null;

    // --- Wikilink autocomplete (Phase 7) ----------------------------------
    // `ProseMirrorRichTextField` has zero storage/Tauri dependency (the boundary rule — see
    // that class's own doc comment), so it only tells this component WHEN the user is mid-way
    // through typing `[[query` (via `onWikilinkTrigger`) and exposes `insertWikilink`/
    // `cancelWikilinkTrigger` for this component to call once the user picks (or dismisses) a
    // target. Everything storage-aware — the live candidate list, resolving a confirmed title to
    // an existing/ambiguous/missing page, and auto-creating a missing one — lives here, mirroring
    // the tag-picker's exact "small floating popover positioned over the DOM overlay" pattern
    // just above.
    let activeWikilinkPopover: HTMLDivElement | null = null;
    let wikilinkQuery = "";
    let wikilinkRange: WikilinkTriggerRange | null = null;
    let wikilinkSearchTimeoutId: ReturnType<typeof setTimeout> | undefined;
    /** The candidates currently listed in the popover, kept so `confirmWikilink` can settle an
     *  exactly-matching title against them before falling back to `resolveWikilinkTarget` — which
     *  only ever looks inside the OPEN notebook (see its Rust doc comment) and would otherwise
     *  auto-create a duplicate page rather than linking to the other notebook's existing one. */
    let wikilinkCandidates: WikilinkCandidate[] = [];
    /** Every page in the workspace with its `Notebook > Section` address (see
     *  `StorageClient.listPageLocations`). Two things read it: the location line under each
     *  suggestion, and the `[[!Notebook@Section$Page#Heading` explicit-location syntax, which
     *  resolves entirely against this list rather than a search. Re-fetched each time a popover
     *  opens — not per keystroke — so pages added since the last one show up without making
     *  typing pay for a round trip. */
    let wikilinkLocations: PageLocationDto[] = [];
    const locationEntry = (id: string | undefined): PageLocationDto | undefined =>
      id === undefined ? undefined : wikilinkLocations.find((candidate) => candidate.pageId === id);
    const locationOf = (id: string): string | undefined => {
      const location = locationEntry(id);
      return location && locationLabel(location);
    };
    /** Where the page being edited lives — what a `!path` level left empty falls back to (see
     *  `parseLinkPath`'s `here`). `undefined` before the location list has loaded, or for a page
     *  too new to be in it, which just leaves those levels matching everything. */
    const here = () => locationEntry(pageId);

    /** Refreshes `wikilinkLocations`, then re-runs `onLoaded` — the list arrives asynchronously
     *  while the user may already be typing, so whatever query is on screen has to be answered
     *  again once it does. */
    const loadPageLocations = (onLoaded: () => void) => {
      storageClient
        .listPageLocations()
        .then((locations) => {
          wikilinkLocations = locations;
          onLoaded();
        })
        .catch((error: unknown) => {
          console.error("Failed to list page locations.", error);
        });
    };

    const removeWikilinkPopover = () => {
      if (wikilinkSearchTimeoutId !== undefined) clearTimeout(wikilinkSearchTimeoutId);
      wikilinkSearchTimeoutId = undefined;
      activeWikilinkPopover?.remove();
      activeWikilinkPopover = null;
      wikilinkRange = null;
      wikilinkQuery = "";
      wikilinkCandidates = [];
    };

    /** (Re)renders the popover's candidate list: existing pages matching the live search, the
     *  current page's own headings when the query is an `#anchor` one, an optional "Create page
     *  ..." action, or — when `resolveWikilinkTarget` reported more than one existing page sharing
     *  the confirmed title — the small disambiguation list the plan calls for, replacing the
     *  live-search candidates with exactly those matches. */
    const renderWikilinkCandidates = (
      field: ProseMirrorRichTextField,
      range: WikilinkTriggerRange,
      candidates: WikilinkCandidate[],
      mode: "search" | "disambiguation" | "anchor" | "path",
    ) => {
      if (!activeWikilinkPopover) return;
      activeWikilinkPopover.innerHTML = "";
      wikilinkCandidates = candidates;

      if (mode !== "search") {
        const label = document.createElement("div");
        label.className = "renote-wikilink-picker-label";
        label.textContent =
          mode === "anchor"
            ? "Headings on this page:"
            : mode === "path"
              ? "!Notebook@Section$Page#Heading — empty = this one"
              : "Multiple pages share this title — pick one:";
        activeWikilinkPopover.appendChild(label);
      }

      for (const candidate of candidates) {
        activeWikilinkPopover.appendChild(
          buildCandidateButton(candidate, () => {
            field.insertWikilink(candidate.id, candidate.title, range, candidate.anchor ?? null);
            removeWikilinkPopover();
          }),
        );
      }

      if (candidates.length === 0 && (mode === "anchor" || mode === "path")) {
        const empty = document.createElement("div");
        empty.className = "renote-wikilink-picker-empty";
        empty.textContent =
          mode === "anchor"
            ? "No headings yet — type one as “# Heading” in a text box."
            : "No page at that location.";
        activeWikilinkPopover.appendChild(empty);
      }

      if (mode === "search" && wikilinkQuery.trim() !== "") {
        const createButton = document.createElement("button");
        createButton.type = "button";
        createButton.className = "renote-wikilink-picker-item renote-wikilink-picker-create";
        createButton.textContent = `Create page "${wikilinkQuery.trim()}"`;
        createButton.addEventListener("mousedown", (event) => {
          event.preventDefault();
          confirmWikilink(field);
        });
        activeWikilinkPopover.appendChild(createButton);
      }

      if (candidates.length === 0 && (mode === "disambiguation" || wikilinkQuery.trim() === "")) {
        const empty = document.createElement("div");
        empty.className = "renote-wikilink-picker-empty";
        empty.textContent =
          mode === "disambiguation" ? "No pages found." : "Type a page title, or ! for an exact location…";
        activeWikilinkPopover.appendChild(empty);
      }
    };

    /** Confirms the current `wikilinkQuery` as a target (Enter, or clicking "Create page ..."):
     *  resolves it via `resolveWikilinkTarget` — an exact single match inserts a link to that
     *  page (this covers linking to the page CURRENTLY being edited too: its own title is a
     *  perfectly valid exact match, and is never excluded from resolution here or on the Rust
     *  side), more than one match shows the disambiguation list above, and no match at all
     *  auto-creates a new page in the same section before linking to it (Logseq-style
     *  auto-create-on-first-reference).
     *
     *  A candidate already on screen whose title matches exactly wins before any of that runs —
     *  the live candidate list spans EVERY notebook (see `onWikilinkTrigger`'s search), while
     *  `resolveWikilinkTarget` only ever looks inside the open one, so without this check
     *  confirming the title of a page in another notebook would auto-create a same-titled
     *  duplicate here instead of linking to the page the user was looking straight at. */
    const confirmWikilink = (field: ProseMirrorRichTextField) => {
      const range = wikilinkRange;
      const title = wikilinkQuery.trim();
      if (!range) return;

      // An explicit `!Notebook@Section$Page` path names one specific existing page, so Enter
      // confirms it only when it currently narrows to exactly one — never auto-creating, since a
      // path that matches nothing is a typo somewhere in the address, not a new page.
      const path = parseLinkPath(wikilinkQuery, here());
      if (path) {
        const matches = matchLinkPath(path, wikilinkLocations);
        const only = matches.length === 1 ? matches[0] : undefined;
        if (only) {
          field.insertWikilink(only.pageId, only.pageTitle, range, path.anchor);
          removeWikilinkPopover();
        }
        return;
      }
      if (!notebookId || title === "") return;

      const exactCandidate = wikilinkCandidates.find((candidate) => candidate.title === title);
      if (exactCandidate) {
        field.insertWikilink(exactCandidate.id, title, range, exactCandidate.anchor ?? null);
        removeWikilinkPopover();
        return;
      }

      storageClient
        .resolveWikilinkTarget({ notebookId, title })
        .then((resolution) => {
          if (resolution.kind === "found") {
            field.insertWikilink(resolution.page.id, title, range);
            removeWikilinkPopover();
          } else if (resolution.kind === "ambiguous") {
            renderWikilinkCandidates(
              field,
              range,
              resolution.pages.map((page) => ({ id: page.id, title: page.title })),
              "disambiguation",
            );
          } else if (sectionId) {
            storageClient
              .createLinkedPage({ notebookId, sectionId, title })
              .then((page) => {
                field.insertWikilink(page.id, title, range);
                removeWikilinkPopover();
                onLinkedPageCreated?.();
              })
              .catch((error: unknown) => {
                console.error("Failed to auto-create linked page.", error);
              });
          }
        })
        .catch((error: unknown) => {
          console.error("Failed to resolve wikilink target.", error);
        });
    };

    // The overlay's own width is CSS `fit-content` (see index.css) — driven by its content, not
    // set here. `min-width`/`max-width`/`min-height` (world units, matching this function's own
    // convention — see below) are set once, in `beginTextEdit`, from the object's actual resized
    // dimensions — NOT here, and NOT on every call: this function also runs on every
    // "camera-changed" event, and `worldBounds` passed in then may already reflect autosize
    // growth from typing (see `syncAutosizeBounds`), so recomputing a min-size from it on every
    // pan/zoom would ratchet the floor up and prevent the box from ever shrinking back down as
    // text is deleted.
    //
    // Rotated objects (`rotation !== 0`) can't reuse the plain unrotated case's top-left-anchored
    // `translate(...) scale(...)`: `cameraToCssTransform`'s positioning treats `worldBounds` as a
    // fixed top-left corner with the box growing right/down from it, which has no single sensible
    // meaning once the box is rotated (there's no consistent "right" or "down" any more). Instead
    // this centers the overlay at the object's true rotation pivot — `boundsCenter(worldBounds)`
    // is mathematically that same point regardless of rotation/scale (rotating a rectangle around
    // its own center always yields an axis-aligned bounding box centered at that same point) — and
    // rotates/scales around it via the standard "translate to pivot, rotate, scale, then
    // recenter via translate(-50%,-50%)" idiom (`-50%,-50%` is resolved against the element's own
    // layout size regardless of the earlier transform functions in this same list, so it works
    // correctly however big the box's fit-content layout ends up being) — the same pattern this
    // file's own selection-outline code below already uses for the same reason. For `rotation ===
    // 0` (the overwhelmingly common case) this is skipped entirely in favor of the exact existing
    // top-left-anchored behavior, unchanged, so autosize's "grows right/down as you type" feel
    // isn't disturbed for the vast majority of text boxes that are never rotated.
    const positionOverlay = (
      overlay: HTMLElement,
      worldBounds: Bounds,
      camera: CameraChangedPayload,
      rotation: number,
    ) => {
      if (rotation === 0) {
        overlay.style.transform = cameraToCssTransform(camera, worldBounds.x, worldBounds.y);
        return;
      }
      const pivot = boundsCenter(worldBounds);
      const screenX = (pivot.x - camera.x) * camera.zoom;
      const screenY = (pivot.y - camera.y) * camera.zoom;
      overlay.style.transform = `translate(${screenX}px, ${screenY}px) rotate(${rotation}rad) scale(${camera.zoom}) translate(-50%, -50%)`;
    };

    // Positioned separately from the overlay itself (translate only, no `scale(camera.zoom)`)
    // so the picker's own text/controls stay a constant on-screen size regardless of zoom,
    // rather than shrinking/growing along with the edited text box.
    const positionTagPicker = (picker: HTMLDivElement, worldBounds: Bounds, camera: CameraChangedPayload) => {
      const screenX = (worldBounds.x - camera.x) * camera.zoom;
      const screenY = (worldBounds.y - camera.y) * camera.zoom;
      picker.style.transform = `translate(${screenX}px, ${screenY}px)`;
    };

    const beginTextEdit = ({ objectId, worldBounds, rotation }: TextEditBeginPayload) => {
      const object = engine.scene.get(objectId);
      if (!object) return;

      // Starting a new edit while a different text box is still being edited (e.g. placing a
      // new one with the Text Box tool without first clicking away from the previous one) must
      // commit/close that previous edit first via the same path a normal click-elsewhere or
      // Escape would use — otherwise its live, uncommitted keystrokes are silently discarded
      // the moment the code below overwrites the shared activeField/activeOverlay/... closure
      // variables out from under it. Emitted through `engine.events` (not called directly)
      // so `SelectTool`'s own `editingObjectId` — which may still be tracking this same object
      // if editing began via its double-click path — hears about it and stays in sync; see
      // that class's constructor for why a direct call here would leave it stale.
      if (activeObjectId && activeObjectId !== objectId) {
        engine.events.emit("text-edit:end", { objectId: activeObjectId });
      }

      const overlay = document.createElement("div");
      overlay.className = "renote-text-edit-overlay";
      positionOverlay(overlay, worldBounds, engine.getCamera(), rotation);
      // Clicking a wikilink while editing follows it (see `handleOverlayLinkClick`) — the one
      // way to follow a link that sits inside a paragraph of prose rather than in a link chip of
      // its own. Removed with the overlay itself in `endTextEdit`.
      overlay.addEventListener("click", handleOverlayLinkClick);
      container.appendChild(overlay);

      // The overlay must start at LEAST as big as whatever the user actually resized this box
      // to (via the select-tool's resize handles). That resized size is `object.bounds` (local,
      // pre-rotation space) scaled by `transform.scaleX/scaleY` — NOT `worldBounds.width/height`:
      // for a rotated object, `worldBounds` (see `TextEditBeginPayload`'s doc comment) is the
      // rotated AABB from `transformedBounds`, which is strictly wider/taller than the box's true
      // local size whenever rotation isn't a multiple of 90°. Using the AABB here would set a
      // floor bigger than the box actually is; `syncAutosizeBounds` below only ever divides back
      // out `transform.scaleX/scaleY` (never un-rotates), so that inflated floor gets written
      // straight into local `bounds.width/height` on the very first `ResizeObserver` firing —
      // permanently enlarging the box the instant editing starts, even with no typing at all.
      // Set once here, as a floor, not a fixed size: `min-width`/`min-height` (not `width`/
      // `height`) is what lets `fit-content` autosize still grow the box further while typing,
      // exactly as before — it just can no longer start out SMALLER than the resize the user
      // already made. `max-width` is raised the same way so a box resized wider than the default
      // cap isn't immediately clamped back down the moment editing starts.
      const resizedWidth = object.bounds.width * (object.transform.scaleX || 1);
      const resizedHeight = object.bounds.height * (object.transform.scaleY || 1);
      overlay.style.minWidth = `${Math.max(AUTOSIZE_MIN_WIDTH, resizedWidth)}px`;
      overlay.style.maxWidth = `${Math.max(AUTOSIZE_MAX_WIDTH, resizedWidth)}px`;
      overlay.style.minHeight = `${Math.max(AUTOSIZE_MIN_HEIGHT, resizedHeight)}px`;

      // Applies the text box's own background/default-text-color, if set — an inline style,
      // which (see index.css's `.renote-text-edit-overlay`/`.ProseMirror` comments) takes
      // precedence over the CSS-variable-driven defaults those rules fall back to. Re-applied by
      // the background/default-color toolbar rows below on every live change, and again by
      // `beginTextEdit` itself each time editing (re-)starts.
      const applyTextBoxStyle = (boxData: TextBoxData) => {
        overlay.style.color = boxData.defaultTextColor ?? "";
        overlay.style.background = boxData.backgroundColor
          ? hexToRgba(boxData.backgroundColor, boxData.backgroundOpacity)
          : "";
      };
      applyTextBoxStyle(object.data as TextBoxData);

      // Writes a partial `TextBoxData` patch onto the object's *current* data (re-fetched fresh,
      // not the `object`/`data` captured at the top of `beginTextEdit` — a background change and
      // a default-color change in the same edit session must not clobber each other) and mutates
      // the scene directly via `scene.update`, the same "live preview, one real command only at
      // edit-end" pattern the autosize `ResizeObserver` below already uses for `bounds` — every
      // slider drag/swatch click isn't its own undo step. `endTextEdit`'s own merge (see its doc
      // comment) is what turns whatever this left in the scene into the actual committed change.
      const updateTextBoxData = (patch: Partial<TextBoxData>) => {
        const current = engine.scene.get(objectId);
        if (!current) return;
        const nextData: TextBoxData = { ...(current.data as TextBoxData), ...patch };
        engine.scene.update({ ...current, data: nextData });
        applyTextBoxStyle(nextData);
      };

      /** Answers the live `[[query` with a candidate list. Named (not inlined into
       *  `onWikilinkTrigger`) so it can be re-run unchanged once `listPageLocations` resolves —
       *  see `loadPageLocations`. */
      const runWikilinkQuery = (query: string, range: WikilinkTriggerRange) => {
        if (wikilinkSearchTimeoutId !== undefined) clearTimeout(wikilinkSearchTimeoutId);
        // `[[!` is the explicit-location syntax (see `link-path.ts`): the whole workspace,
        // narrowed level by level as the address is typed. Answered off the already-fetched
        // location list, so it needs no round trip per keystroke and — unlike the title search
        // below — can point at a page in any notebook without ambiguity.
        const path = parseLinkPath(query, here());
        if (path) {
          renderWikilinkCandidates(
            field,
            range,
            matchLinkPath(path, wikilinkLocations).map((location) => ({
              id: location.pageId,
              title: location.pageTitle,
              ...(path.anchor ? { anchor: path.anchor } : {}),
              location: locationLabel(location),
            })),
            "path",
          );
          return;
        }
        // `[[#` switches the popover from pages to this page's own headings — an in-page
        // anchor link (`marks.ts`'s `TextMark.attr3`). Answered straight off the live scene
        // graph, with no search round trip: the headings that matter are the ones on screen
        // right now, including any typed seconds ago and not yet saved.
        if (query.startsWith("#") && pageId) {
          const wanted = query.slice(1).trim().toLowerCase();
          const anchors = listPageAnchors(engine.scene.all).filter(
            (anchor) => wanted === "" || anchor.toLowerCase().includes(wanted),
          );
          renderWikilinkCandidates(
            field,
            range,
            anchors.map((anchor) => ({ id: pageId, title: `#${anchor}`, anchor })),
            "anchor",
          );
          return;
        }
        // An empty query (right after typing `[[`, before narrowing it) offers this page's own
        // nearest neighbours by embedding similarity (Phase 13's local semantic layer) instead of
        // an empty list — no new command, `find_related_pages` already exists for the Related
        // Notes panel. Falls back to a plain empty popover when there's no page context yet (or
        // the model budget missed and every stored vector is empty) to link suggestions off of.
        if (query.trim() === "") {
          if (notebookId && sectionId && pageId) {
            storageClient
              .findRelatedPages({ notebookId, sectionId, pageId, limit: 5 })
              .then((hits) => {
                if (!activeWikilinkPopover) return; // trigger was cancelled/confirmed meanwhile
                renderWikilinkCandidates(
                  field,
                  range,
                  hits.map((hit) => ({ id: hit.pageId, title: hit.title, location: locationOf(hit.pageId) })),
                  "search",
                );
              })
              .catch((error: unknown) => {
                console.error("Failed to find related pages for the wikilink picker.", error);
              });
          } else {
            renderWikilinkCandidates(field, range, [], "search");
          }
          return;
        }
        // Debounced, same 250ms-ish shape as AppShell's own search-as-you-type — reuses the
        // EXISTING `search` command (no new backend infrastructure). Deliberately unscoped
        // (`notebookIds: null`): a wikilink stores nothing but its target's page id, so a link
        // into another notebook works exactly like one within this one — the only thing that
        // ever limited it to the open notebook was this list not offering those pages.
        wikilinkSearchTimeoutId = setTimeout(() => {
          if (!notebookId) return;
          storageClient
            .search({
              text: query,
              notebookIds: null,
              sectionIds: null,
              tagIds: null,
              modifiedAfter: null,
              modifiedBefore: null,
            })
            .then((result) => {
              if (!activeWikilinkPopover) return; // trigger was cancelled/confirmed meanwhile
              renderWikilinkCandidates(
                field,
                range,
                result.hits.map((hit) => ({
                  id: hit.pageId,
                  title: hit.title,
                  location: locationOf(hit.pageId),
                })),
                "search",
              );
            })
            .catch((error: unknown) => {
              console.error("Failed to search for wikilink candidates.", error);
            });
        }, 200);
      };

      const field = new ProseMirrorRichTextField({
        onWikilinkTrigger: (query, range) => {
          wikilinkQuery = query;
          wikilinkRange = range;
          if (!activeWikilinkPopover) {
            const popover = document.createElement("div");
            popover.className = "renote-wikilink-picker";
            positionTagPicker(popover, worldBounds, engine.getCamera());
            container.appendChild(popover);
            activeWikilinkPopover = popover;
            // Refreshed once per popover, then re-answered when it lands — the query on screen
            // by then may already be a `!path` one that needs it.
            loadPageLocations(() => {
              if (activeWikilinkPopover && wikilinkRange) {
                runWikilinkQuery(wikilinkQuery, wikilinkRange);
              }
            });
          }
          runWikilinkQuery(query, range);
        },
        onWikilinkCancel: () => {
          removeWikilinkPopover();
        },
      });
      const data = object.data as TextBoxData;
      field.setContent(isRichTextDocument(data.content) ? data.content : emptyRichTextDocument());
      field.mount(overlay);
      field.focus();

      // --- Autosize --------------------------------------------------------
      // The overlay's CSS (`width: fit-content`, `min-width`/`max-width` set by
      // `positionOverlay` above, `height: auto`) already does the actual fitting — a
      // `ResizeObserver` on the overlay just reports the result back into the data model, in
      // both directions, as the user types: `object.bounds` must reflect the box's live
      // rendered size so the scene stays consistent the moment editing ends (the "cold" Pixi
      // view redraws from `bounds`, and both hit-testing and the selection outline read it
      // too), not just at commit time. This mutates the scene directly via `scene.update`
      // rather than an `UpdateObjectCommand` — the same "live preview, one command at the very
      // end" pattern `SelectTool`'s own move/rotate/scale gestures and `PenTool`'s in-progress
      // stroke already use — since every keystroke is not its own undo step.
      const syncAutosizeBounds = () => {
        if (!activeOverlay || !activeObjectId) return;
        const current = engine.scene.get(objectId);
        if (!current) return;
        // `offsetWidth`/`offsetHeight` (the overlay's own LAYOUT size), not
        // `getBoundingClientRect()` (its post-transform, screen-space size) — the overlay may now
        // be rotated (see `positionOverlay`), and a rotated element's bounding-client-rect is the
        // axis-aligned box of the ROTATED shape, not its own true footprint; `offsetWidth`/
        // `offsetHeight` are unaffected by `transform` (rotate/scale) entirely, giving the box's
        // real size directly. They're also already in world units with no zoom division needed —
        // this overlay's own unscaled CSS px === world units by convention (see `positionOverlay`
        // /`AUTOSIZE_MIN_WIDTH`'s doc comments); `scale(camera.zoom)` in the transform is what
        // converts that to actual screen pixels, and `offsetWidth`/`offsetHeight` read the
        // pre-transform value.
        const domWidthWorld = activeOverlay.offsetWidth;
        const domHeightWorld = activeOverlay.offsetHeight;
        // `bounds` is local (pre-transform) space (see Transform2D's own doc comment) — a manual
        // resize via the select-tool's handles (`applyScale`) lives entirely in
        // `transform.scaleX/scaleY`, never touching `bounds`, so the object's actual rendered
        // size is `bounds.width * transform.scaleX`. The DOM overlay's own CSS has no idea that
        // scale exists (only `camera.zoom` factors into its `scale(...)`), so a size measured off
        // it must be divided back down by the object's current scale before being written into
        // `bounds` — otherwise a manually-resized box would silently double its scale the moment
        // the user typed a single character.
        const nextWidth = domWidthWorld / (current.transform.scaleX || 1);
        const nextHeight = domHeightWorld / (current.transform.scaleY || 1);
        if (
          Math.abs(nextWidth - current.bounds.width) < 0.01 &&
          Math.abs(nextHeight - current.bounds.height) < 0.01
        ) {
          return;
        }
        // Only `width`/`height` change here — `bounds.x`/`bounds.y` (local space) are left
        // exactly as they are. They must NOT be derived from `worldBounds` (world space): a text
        // box that's been dragged since it was placed has a nonzero `transform.x/y` on top of an
        // unchanged local `bounds.x/y` (see `applyMove`), so writing world-space coordinates into
        // local-space `bounds` here would double-apply that offset the moment autosize fired,
        // silently walking the box away from its actual position on every keystroke.
        engine.scene.update({
          ...current,
          bounds: { ...current.bounds, width: nextWidth, height: nextHeight },
        });
      };
      const autosizeObserver = new ResizeObserver(syncAutosizeBounds);
      autosizeObserver.observe(overlay);
      activeAutosizeObserver = autosizeObserver;

      // Intercepts Enter/Escape in the capture phase — i.e. before ProseMirror's own keymap
      // handles them (ProseMirror's baseKeymap has no Escape binding at all, and Enter is
      // otherwise "insert a new paragraph"). Enter only does anything special here while a
      // wikilink popover is open. Escape always ends the edit — emitted through `engine.events`
      // the same way `beginTextEdit`'s and `handleOutsideInteraction`'s own end-editing paths
      // do (see those comments for why a direct `endTextEdit` call isn't enough — it would
      // leave `SelectTool`'s `editingObjectId` stale) — but dismisses the wikilink popover
      // first if one is open, matching "Escape closes the nearest thing first" elsewhere in the
      // app, and needs a *second* Escape to actually stop editing. This has to live here rather
      // than on `AppShell`'s document-level keydown handler: that handler explicitly ignores
      // events whose target `isContentEditable` (so typing "e" inside a text box doesn't fire
      // the eraser-tool shortcut), which also swallows Escape before it ever reaches app-level
      // keybindings — text-edit-events.ts's own doc comment describes Escape ending an edit via
      // `SelectTool.onCancel`, but that only fires for a *canvas-level* Escape (a keyboard
      // shortcut with no contenteditable focused), never one typed while actually inside the
      // DOM overlay.
      const handleOverlayKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Enter" && activeWikilinkPopover) {
          event.preventDefault();
          event.stopPropagation();
          confirmWikilink(field);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (activeWikilinkPopover) {
            field.cancelWikilinkTrigger();
            removeWikilinkPopover();
          } else {
            engine.events.emit("text-edit:end", { objectId });
          }
        }
      };
      overlay.addEventListener("keydown", handleOverlayKeyDown, true);

      activeField = field;
      activeOverlay = overlay;
      activeObjectId = objectId;
      activeWorldBounds = worldBounds;
      activeRotation = rotation;

      // Floating toolbar sitting just above the overlay: the paragraph-tag picker (unchanged,
      // still only shown when the notebook actually has tags — see its own comment below) plus
      // three always-shown rows for the text-color mark, textbox background+opacity, and default
      // text color. Built with raw DOM calls rather than React for the same reason the overlay
      // itself is: this whole seam is imperative canvas-engine/text-editor glue, not a React tree.
      const toolbar = document.createElement("div");
      toolbar.className = "renote-text-toolbar";

      const startingData = object.data as TextBoxData;

      // Text color: applies (or, via the "Default" button, clears) the `textColor` mark over
      // whatever's currently selected — see `setTextColor`'s own doc comment for why a swatch
      // click with nothing selected is a harmless no-op rather than an error.
      const textColorRow = buildSwatchRow("Text", TEXT_COLOR_PRESETS, TEXT_COLOR_PRESETS[0]!, (color) => {
        field.setTextColor(color);
      });
      textColorRow.appendChild(buildClearButton("Default", () => field.setTextColor(null)));
      toolbar.appendChild(textColorRow);

      // Background + opacity: two independently-changing controls (a color swatch/picker, an
      // opacity slider) writing the same `TextBoxData` fields — `backgroundColorState` is the
      // local "what color is currently chosen" state the opacity slider itself needs to read,
      // since dragging the slider alone (with no color ever picked) must stay a no-op rather than
      // switching a still-`null` `backgroundColor` on with whatever the swatch row's own default
      // custom-color value happens to be.
      let backgroundColorState = startingData.backgroundColor;
      let backgroundOpacityState = startingData.backgroundOpacity;
      const backgroundRow = buildSwatchRow(
        "Background",
        BACKGROUND_COLOR_PRESETS,
        startingData.backgroundColor ?? BACKGROUND_COLOR_PRESETS[0]!,
        (color) => {
          backgroundColorState = color;
          updateTextBoxData({ backgroundColor: color, backgroundOpacity: backgroundOpacityState });
        },
      );
      backgroundRow.appendChild(
        buildClearButton("None", () => {
          backgroundColorState = null;
          updateTextBoxData({ backgroundColor: null, backgroundOpacity: backgroundOpacityState });
        }),
      );
      toolbar.appendChild(backgroundRow);

      const opacityRow = document.createElement("div");
      opacityRow.className = "renote-text-toolbar-row";
      const opacityLabel = document.createElement("span");
      opacityLabel.className = "renote-text-toolbar-label";
      opacityLabel.textContent = "Opacity";
      opacityRow.appendChild(opacityLabel);
      const opacitySlider = document.createElement("input");
      opacitySlider.type = "range";
      opacitySlider.min = "0";
      opacitySlider.max = "100";
      opacitySlider.value = String(Math.round(backgroundOpacityState * 100));
      opacitySlider.className = "renote-text-toolbar-opacity-slider";
      opacitySlider.setAttribute("aria-label", "Background opacity");
      opacitySlider.addEventListener("input", () => {
        backgroundOpacityState = Number(opacitySlider.value) / 100;
        // No `backgroundColor` chosen yet — dragging opacity alone must not turn a background on.
        if (backgroundColorState !== null) {
          updateTextBoxData({
            backgroundColor: backgroundColorState,
            backgroundOpacity: backgroundOpacityState,
          });
        }
      });
      opacityRow.appendChild(opacitySlider);
      toolbar.appendChild(opacityRow);

      // Default text color: the base color for any run with no explicit `textColor` mark —
      // writes `TextBoxData.defaultTextColor` directly, unlike the text-color row above (which
      // applies a per-run mark over a selection).
      const defaultColorRow = buildSwatchRow(
        "Default Text",
        TEXT_COLOR_PRESETS,
        startingData.defaultTextColor ?? TEXT_COLOR_PRESETS[0]!,
        (color) => updateTextBoxData({ defaultTextColor: color }),
      );
      defaultColorRow.appendChild(
        buildClearButton("Default", () => updateTextBoxData({ defaultTextColor: null })),
      );
      toolbar.appendChild(defaultColorRow);

      // Tag picker: offers the notebook's tags. Picking one calls `field.setParagraphTag`, which
      // sets `tagId` on whichever paragraph currently contains the text cursor (see that method's
      // doc comment) — it is deliberately a plain "apply this tag" action, not a control that
      // reflects the current paragraph's existing tag back into its own displayed value, since
      // `RichTextField` exposes no "read the tag at the selection" query today. Still only shown
      // when the notebook actually has tags, unlike the three rows above.
      const tags = availableTagsRef.current;
      if (tags.length > 0) {
        const select = document.createElement("select");
        select.className = "renote-tag-picker-select";
        select.setAttribute("aria-label", "Paragraph tag");

        const noneOption = document.createElement("option");
        noneOption.value = "";
        noneOption.textContent = "No tag";
        select.appendChild(noneOption);

        for (const tag of tags) {
          const option = document.createElement("option");
          option.value = tag.id;
          option.textContent = tag.label;
          select.appendChild(option);
        }

        select.addEventListener("change", () => {
          field.setParagraphTag(select.value === "" ? null : select.value);
          field.focus();
        });

        toolbar.appendChild(select);
      }

      positionTagPicker(toolbar, worldBounds, engine.getCamera());
      container.appendChild(toolbar);
      activeToolbar = toolbar;
    };

    const endTextEdit = ({ objectId }: TextEditEndPayload) => {
      if (!activeField || !activeOverlay || activeObjectId !== objectId) return;

      const object = engine.scene.get(objectId);
      if (object) {
        // Merges onto the freshly-refetched object's current data (not a bare `{ content }`
        // literal) so background/opacity/defaultTextColor — kept live-current by the toolbar's
        // own `scene.update` calls during editing (see the background/text-color rows below) —
        // survive the commit rather than being silently reset to their defaults.
        const nextData: TextBoxData = { ...(object.data as TextBoxData), content: activeField.getContent() };
        const nextObject: PageObject = { ...object, data: nextData };
        engine.commands.execute(new UpdateObjectCommand(engine.scene, objectId, nextObject));
      }

      activeField.destroy();
      activeOverlay.remove();
      activeToolbar?.remove();
      removeWikilinkPopover();
      activeAutosizeObserver?.disconnect();
      activeAutosizeObserver = null;
      activeField = null;
      activeOverlay = null;
      activeObjectId = null;
      activeWorldBounds = null;
      activeRotation = 0;
      activeToolbar = null;
    };

    // Panning or zooming while a text box is being edited must keep the DOM overlay locked to
    // its "cold" Pixi placeholder underneath — see "camera-changed"'s doc comment.
    const onCameraChanged = (camera: CameraChangedPayload) => {
      if (!activeOverlay || !activeObjectId || !activeWorldBounds) return;
      // Recomputed fresh from the scene, not the `activeWorldBounds` snapshot `beginTextEdit`
      // captured — that snapshot never changes after `syncAutosizeBounds`'s own fix (see its doc
      // comment: only `object.bounds.width/height` change as the user types, `activeWorldBounds`
      // itself is left alone), so re-deriving it here is what keeps the OVERLAY's own on-screen
      // position/size correctly tracking any growth from typing across a pan/zoom mid-edit,
      // without needing a second piece of mutable state to keep in sync with the first.
      const current = engine.scene.get(activeObjectId);
      const liveWorldBounds = current
        ? transformedBounds(current.bounds, current.transform)
        : activeWorldBounds;
      positionOverlay(activeOverlay, liveWorldBounds, camera, activeRotation);
      // The toolbar/wikilink popover intentionally keep using the ORIGINAL (edit-start)
      // `activeWorldBounds`, not the live-recomputed one above — they're floating helper UI
      // anchored "near" the box, not overlaid exactly on it, and don't need to track its content
      // growth the way the overlay itself does.
      if (activeToolbar) positionTagPicker(activeToolbar, activeWorldBounds, camera);
      if (activeWikilinkPopover) positionTagPicker(activeWikilinkPopover, activeWorldBounds, camera);
    };

    // The link picker is anchored to its own button, not to any text edit, so it re-positions on
    // its own rather than inside `onCameraChanged`'s text-overlay branch above (which returns
    // early whenever nothing is being edited).
    const onCameraChangedForLinkPicker = (camera: CameraChangedPayload) => {
      if (activeLinkPicker && linkPickerWorldBounds) {
        positionTagPicker(activeLinkPicker, linkPickerWorldBounds, camera);
      }
    };

    // --- Audio clip playback (Phase 12) --------------------------------------
    // A real `<audio controls>` overlay, mounted only while playing — the same cold-Pixi/
    // hot-DOM-overlay split text boxes use, positioned with `positionOverlay` above and
    // re-positioned from the same "camera-changed" event. One overlay at a time; torn down on
    // pause/end/page-switch — deliberately NOT on click-away, since scrubbing/pausing the native
    // controls must not itself close the very element being interacted with (see the plan's
    // Appendix B: "the view stores no playback state" — a paused clip just goes cold again).
    let activeAudioOverlay: HTMLAudioElement | null = null;
    let activeAudioObjectId: PageObjectId | null = null;
    /** The `Blob` URL behind `activeAudioOverlay.src`, revoked on close — `resolveAssetUrl`'s
     *  `asset://` URL isn't used here (see below); a `Blob` URL is memory the page owns and must
     *  release itself. */
    let activeAudioObjectUrl: string | null = null;

    const closeAudioOverlay = () => {
      activeAudioOverlay?.remove();
      activeAudioOverlay = null;
      activeAudioObjectId = null;
      if (activeAudioObjectUrl) {
        URL.revokeObjectURL(activeAudioObjectUrl);
        activeAudioObjectUrl = null;
      }
    };

    const openAudioOverlay = (object: PageObject) => {
      const data = object.data as { assetPath?: unknown };
      if (object.type !== "audio-clip" || typeof data.assetPath !== "string" || !notebookId || !sectionId) {
        return;
      }
      closeAudioOverlay();

      const worldBounds = transformedBounds(object.bounds, object.transform);
      const audio = document.createElement("audio");
      audio.className = "renote-audio-clip-overlay";
      audio.controls = true;
      audio.autoplay = true;
      audio.style.width = `${worldBounds.width}px`;
      audio.style.height = `${worldBounds.height}px`;
      positionOverlay(audio, worldBounds, engine.getCamera(), 0);
      audio.addEventListener("pause", closeAudioOverlay);
      audio.addEventListener("ended", closeAudioOverlay);
      container.appendChild(audio);
      activeAudioOverlay = audio;
      activeAudioObjectId = object.id;

      // Bytes + a `Blob` URL, NOT `resolveAssetUrl`'s `asset://` URL: WebKitGTK's GStreamer
      // `<audio>` backend can't load media through Tauri's custom URI scheme on Linux (confirmed
      // live — see `readAudioAsset`'s doc comment), even though that same `asset://` URL works
      // fine for Pixi's image loading just above.
      storageClient
        .readAudioAsset({ notebookId, sectionId, assetPath: data.assetPath })
        .then((bytes) => {
          const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
          if (activeAudioOverlay !== audio) {
            URL.revokeObjectURL(url); // superseded/closed meanwhile
            return;
          }
          activeAudioObjectUrl = url;
          audio.src = url;
        })
        .catch((error: unknown) => {
          console.error("Failed to resolve the audio clip's asset.", error);
          if (activeAudioOverlay === audio) closeAudioOverlay();
        });
    };

    const onCameraChangedForAudioOverlay = (camera: CameraChangedPayload) => {
      if (!activeAudioOverlay || !activeAudioObjectId) return;
      const object = engine.scene.get(activeAudioObjectId);
      if (!object) return;
      positionOverlay(activeAudioOverlay, transformedBounds(object.bounds, object.transform), camera, 0);
    };

    // --- Following a link ---------------------------------------------------
    // Two entry points, one destination: the `<a data-wikilink>` inside the text-edit overlay
    // (an ordinary DOM click), and a "cold" link chip sitting on the canvas (a click hit-tested
    // against the scene). Both end up here.
    const followLinkTarget = (target: WikilinkTarget) => {
      // Editing must end first either way: a link click inside a box is also the last edit that
      // box is going to get before the view changes, and `endTextEdit` is what writes the live
      // ProseMirror content back into the scene.
      if (activeObjectId) {
        engine.events.emit("text-edit:end", { objectId: activeObjectId });
      }
      // A link into THIS page never navigates — it's a camera move, which needs the live scene
      // this component already owns, so it never reaches `AppShell` at all. Anchorless self-links
      // (a page linking to itself, which the wikilink flow explicitly allows) have nowhere to go.
      if (target.pageId === pageId) {
        if (target.anchor) centerCameraOnAnchor(engine, target.anchor);
        return;
      }
      onFollowLinkRef.current?.(target);
    };

    // --- Link-button target picker ------------------------------------------
    // A `link-button` object holds a navigation target and nothing else — there is no text to
    // type into, so it gets this small popover instead of the ProseMirror overlay: an input, the
    // same live page search the `[[` autocomplete uses, this page's headings when the query
    // starts with `#`, and the same "no such page — create it" fallback. Opened by the
    // "link-edit:begin" engine event, which fires when a button is spawned and again when the
    // user opens an existing one to re-point it.
    let activeLinkPicker: HTMLDivElement | null = null;
    let linkPickerObjectId: PageObjectId | null = null;
    let linkPickerWorldBounds: Bounds | null = null;
    let linkPickerSearchTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let linkPickerCandidates: WikilinkCandidate[] = [];

    const closeLinkPicker = () => {
      if (linkPickerSearchTimeoutId !== undefined) clearTimeout(linkPickerSearchTimeoutId);
      linkPickerSearchTimeoutId = undefined;
      activeLinkPicker?.remove();
      activeLinkPicker = null;
      linkPickerObjectId = null;
      linkPickerWorldBounds = null;
      linkPickerCandidates = [];
    };

    /** Points a link button at `candidate` and closes the picker. Committed through
     *  `UpdateObjectCommand` so re-pointing a button is undoable like any other edit, and the
     *  button is resized to its new label, since it has no text cursor to autosize from. */
    const applyLinkTarget = (candidate: WikilinkCandidate) => {
      const objectId = linkPickerObjectId;
      const object = objectId ? engine.scene.get(objectId) : undefined;
      if (!objectId || !object) return;
      const target: LinkButtonTarget = candidate.anchor
        ? { kind: "wikilink", attr: candidate.id, attr2: candidate.title, attr3: candidate.anchor }
        : { kind: "wikilink", attr: candidate.id, attr2: candidate.title };
      const data: LinkButtonData = { target };
      engine.commands.execute(
        new UpdateObjectCommand(engine.scene, objectId, {
          ...object,
          bounds: { ...object.bounds, width: linkButtonWidthFor(linkButtonLabel(data)) },
          data,
        }),
      );
      closeLinkPicker();
    };

    const renderLinkPickerCandidates = (
      list: HTMLDivElement,
      candidates: WikilinkCandidate[],
      emptyMessage: string,
    ) => {
      list.innerHTML = "";
      linkPickerCandidates = candidates;
      for (const candidate of candidates) {
        list.appendChild(buildCandidateButton(candidate, () => applyLinkTarget(candidate)));
      }
      if (candidates.length === 0) {
        const empty = document.createElement("div");
        empty.className = "renote-wikilink-picker-empty";
        empty.textContent = emptyMessage;
        list.appendChild(empty);
      }
    };

    /** Creates a page titled `title` in the open section and points the button at it — the
     *  picker's version of the wikilink flow's auto-create-on-first-reference. */
    const createPageForLinkPicker = (title: string) => {
      if (!notebookId || !sectionId) return;
      storageClient
        .createLinkedPage({ notebookId, sectionId, title })
        .then((page) => {
          applyLinkTarget({ id: page.id, title });
          onLinkedPageCreated?.();
        })
        .catch((error: unknown) => {
          console.error("Failed to create a page for this link.", error);
        });
    };

    const runLinkPickerQuery = (list: HTMLDivElement, rawQuery: string) => {
      if (linkPickerSearchTimeoutId !== undefined) clearTimeout(linkPickerSearchTimeoutId);
      const query = rawQuery.trim();

      // `!Notebook@Section$Page#Heading` addresses one exact page anywhere in the workspace,
      // resolved off the location list with no round trip — same syntax the `[[` autocomplete
      // takes (see `link-path.ts`).
      const path = parseLinkPath(rawQuery, here());
      if (path) {
        renderLinkPickerCandidates(
          list,
          matchLinkPath(path, wikilinkLocations).map((location) => ({
            id: location.pageId,
            title: location.pageTitle,
            ...(path.anchor ? { anchor: path.anchor } : {}),
            location: locationLabel(location),
          })),
          "No page at that location.",
        );
        return;
      }

      // `#` lists this page's own headings — the in-page anchor case, answered off the live scene
      // with no round trip, exactly as the `[[#` autocomplete does.
      if (rawQuery.startsWith("#") && pageId) {
        const wanted = query.slice(1).toLowerCase();
        const anchors = listPageAnchors(engine.scene.all).filter(
          (anchor) => wanted === "" || anchor.toLowerCase().includes(wanted),
        );
        renderLinkPickerCandidates(
          list,
          anchors.map((anchor) => ({ id: pageId, title: pageTitleRef.current, anchor })),
          "No headings yet — type one as “# Heading” in a text box.",
        );
        return;
      }
      if (query === "") {
        renderLinkPickerCandidates(
          list,
          [],
          "Type a page title, # for a heading on this page, or ! for an exact location.",
        );
        return;
      }
      linkPickerSearchTimeoutId = setTimeout(() => {
        storageClient
          .search({
            text: query,
            notebookIds: null,
            sectionIds: null,
            tagIds: null,
            modifiedAfter: null,
            modifiedBefore: null,
          })
          .then((result) => {
            if (!activeLinkPicker) return; // picker was closed meanwhile
            renderLinkPickerCandidates(
              list,
              result.hits.map((hit) => ({
                id: hit.pageId,
                title: hit.title,
                location: locationOf(hit.pageId),
              })),
              `No page found. Press Enter to create “${query}”.`,
            );
          })
          .catch((error: unknown) => {
            console.error("Failed to search for link targets.", error);
          });
      }, 200);
    };

    const openLinkPicker = ({ objectId, worldBounds }: LinkEditBeginPayload) => {
      closeLinkPicker();
      const popover = document.createElement("div");
      popover.className = "renote-wikilink-picker renote-link-picker";
      positionTagPicker(popover, worldBounds, engine.getCamera());

      const input = document.createElement("input");
      input.type = "text";
      input.className = "renote-link-picker-input";
      input.placeholder = "Page title, # heading, or !Notebook@Section$Page";
      input.setAttribute("aria-label", "Link target");

      const list = document.createElement("div");
      list.className = "renote-link-picker-list";

      popover.appendChild(input);
      popover.appendChild(list);
      container.appendChild(popover);
      activeLinkPicker = popover;
      linkPickerObjectId = objectId;
      linkPickerWorldBounds = worldBounds;

      input.addEventListener("input", () => runLinkPickerQuery(list, input.value));
      input.addEventListener("keydown", (event) => {
        // Both keys are handled here and stopped: Escape must not reach `AppShell`'s
        // document-level keymap, and Enter must not do anything else on the page.
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeLinkPicker();
          return;
        }
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        const query = input.value.trim();
        if (query === "") return;
        // An explicit `!path` names an existing page — confirm it only when it narrows to one,
        // and never fall through to auto-creation (see `confirmWikilink`'s same reasoning).
        if (parseLinkPath(input.value, here())) {
          const only = linkPickerCandidates.length === 1 ? linkPickerCandidates[0] : undefined;
          if (only) applyLinkTarget(only);
          return;
        }
        const exact = linkPickerCandidates.find((candidate) => candidate.title === query);
        if (exact) {
          applyLinkTarget(exact);
          return;
        }
        // An `#anchor` query with no matching heading has nothing to create — only a page-title
        // query falls through to auto-creation.
        if (!input.value.startsWith("#")) createPageForLinkPicker(query);
      });

      runLinkPickerQuery(list, "");
      // Same once-per-open refresh the `[[` popover does, re-answering the query on screen when
      // it lands (see `loadPageLocations`).
      loadPageLocations(() => {
        if (activeLinkPicker) runLinkPickerQuery(list, input.value);
      });
      input.focus();
    };

    const handleOverlayLinkClick = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target.closest("a[data-wikilink]") : null;
      const linkedPageId = element?.getAttribute("data-page-id");
      if (!element || !linkedPageId) return;
      event.preventDefault();
      followLinkTarget({
        pageId: linkedPageId,
        displayText: element.textContent ?? "",
        anchor: element.getAttribute("data-anchor"),
      });
    };

    /** The topmost object under a screen-space point, or `undefined` for empty canvas. */
    const objectAtClientPoint = (clientX: number, clientY: number): PageObject | undefined => {
      const rect = container.getBoundingClientRect();
      const camera = engine.getCamera();
      const hits = engine.scene.hitTestPoint(
        camera.x + (clientX - rect.left) / camera.zoom,
        camera.y + (clientY - rect.top) / camera.zoom,
        engine.objectTypes,
      );
      const topHitId = hits[hits.length - 1];
      return topHitId ? engine.scene.get(topHitId) : undefined;
    };

    /** Where the pointer went down, so a drag that happens to end over a link chip (moving it)
     *  isn't mistaken for a click on it. */
    let canvasPointerDownAt: { x: number; y: number } | null = null;
    /** Whether the object under the pointer was ALREADY selected when the gesture started. A
     *  click on an unselected link chip follows it; once it IS selected (shift-click, or the
     *  click that just followed a same-page anchor) clicks stop following, which is what leaves
     *  double-click free to open the chip for editing like any other text box. Captured in the
     *  capture phase, since `PointerInputDispatcher`'s own listener on the canvas underneath runs
     *  before this one bubbles and has already updated the selection by then. */
    let canvasPointerDownSelected = false;
    /** Own double-click tracking for link buttons, by object id and timestamp — the same shape
     *  (and window) `SelectTool.maybeHandleDoubleClick` uses. Deliberately not `MouseEvent.detail`:
     *  that counts clicks the browser's way, which synthetic input and some platforms report as 1
     *  every time, and this app already has one definition of a double-click. */
    let lastLinkClickObjectId: PageObjectId | null = null;
    let lastLinkClickTime = 0;
    const handleCanvasPointerDown = (event: PointerEvent) => {
      canvasPointerDownAt = { x: event.clientX, y: event.clientY };
      const object = objectAtClientPoint(event.clientX, event.clientY);
      canvasPointerDownSelected = object ? engine.selection.isSelected(object.id) : false;
    };

    const handleCanvasClick = (event: MouseEvent) => {
      const start = canvasPointerDownAt;
      canvasPointerDownAt = null;
      // Only the select tool follows links: with a pen/eraser/shape tool active a click on the
      // canvas is a drawing gesture, and navigating away mid-stroke would be nonsense.
      if (activeToolIdRef.current !== "select") return;
      // Shift-click is `SelectTool`'s add-to-selection gesture — and the way a link chip still
      // gets selected (to move, delete, or restyle it) now that a plain click follows it.
      if (event.shiftKey) return;
      if (!(event.target instanceof Node)) return;
      // Clicks on the editor's own DOM (overlay, toolbar, wikilink popover, link picker) are not
      // canvas clicks, even though those elements live inside `container`.
      if (
        activeOverlay?.contains(event.target) ||
        activeToolbar?.contains(event.target) ||
        activeWikilinkPopover?.contains(event.target) ||
        activeLinkPicker?.contains(event.target) ||
        activeAudioOverlay?.contains(event.target)
      ) {
        return;
      }
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP_PX) return;

      const object = objectAtClientPoint(event.clientX, event.clientY);
      // A click anywhere else on the canvas dismisses an open picker, the same way clicking away
      // from a text box ends editing it.
      if (activeLinkPicker && object?.id !== linkPickerObjectId) closeLinkPicker();

      if (object?.type === "link-button") {
        const target = linkButtonTarget(object);
        const worldBounds = transformedBounds(object.bounds, object.transform);
        const now = Date.now();
        const isDoubleClick =
          lastLinkClickObjectId === object.id && now - lastLinkClickTime <= LINK_DOUBLE_CLICK_WINDOW_MS;
        lastLinkClickObjectId = object.id;
        lastLinkClickTime = now;
        // Already selected: clicks stop navigating, which is what leaves double-click free to
        // re-point the button (and single clicks free to just keep it selected for moving).
        if (canvasPointerDownSelected) {
          if (isDoubleClick) engine.events.emit("link-edit:begin", { objectId: object.id, worldBounds });
          return;
        }
        // A button with no target yet cannot navigate — clicking it asks for one instead.
        if (target) followLinkTarget(target);
        else engine.events.emit("link-edit:begin", { objectId: object.id, worldBounds });
        return;
      }

      if (object?.type === "audio-clip") {
        if (activeAudioObjectId !== object.id) openAudioOverlay(object);
        return;
      }

      if (canvasPointerDownSelected) return;
      const target = object ? linkChipTarget(object) : null;
      if (target) followLinkTarget(target);
    };

    container.addEventListener("pointerdown", handleCanvasPointerDown, true);
    container.addEventListener("click", handleCanvasClick);

    // Any UI interaction outside this page's own canvas container — a different tool button, a
    // sidebar action, Settings, Page Background, switching pages/notebooks, etc. — must end an
    // in-progress text edit exactly like clicking elsewhere ON the canvas already does (see
    // SelectTool's own click-elsewhere handling in select-tool.ts), or the edit's live content
    // either gets lost or keeps silently overwriting whatever the object looked like before,
    // right up until something else finally ends it. `mousedown` (not `click`), captured at the
    // document root, so this commits BEFORE the click's own handler — a tool switch, a page
    // navigation — runs, the same "commit before the thing that triggered it takes effect"
    // reasoning the wikilink popover's own mousedown listener above already relies on. Clicks
    // inside `container` (the canvas, the DOM overlay, the tag picker, the wikilink popover —
    // all appended as its own children) are deliberately excluded: those already have their own
    // more precise end-editing logic, or are meant to interact with the tag picker/wikilink
    // popover without ending the edit at all (e.g. picking a paragraph tag). Emitted through
    // `engine.events` rather than calling `endTextEdit` directly — see `beginTextEdit`'s own
    // matching comment above for why that matters (keeping `SelectTool`'s `editingObjectId` in
    // sync when editing began via its double-click path rather than the Text Box tool).
    const handleOutsideInteraction = (event: MouseEvent) => {
      const outside = !(event.target instanceof Node) || !container.contains(event.target);
      // An open link picker is dismissed by the same interactions, for the same reason: it is
      // attached to one object on this page, and anything happening elsewhere in the app has
      // moved on from it.
      if (outside && activeLinkPicker) closeLinkPicker();
      if (!activeObjectId || !outside) return;
      engine.events.emit("text-edit:end", { objectId: activeObjectId });
    };
    document.addEventListener("mousedown", handleOutsideInteraction, true);

    const unsubscribeBegin = engine.events.on("text-edit:begin", beginTextEdit);
    const unsubscribeEnd = engine.events.on("text-edit:end", endTextEdit);
    const unsubscribeCamera = engine.events.on("camera-changed", onCameraChanged);
    const unsubscribeLinkEdit = engine.events.on("link-edit:begin", openLinkPicker);
    const unsubscribeCameraForLinkPicker = engine.events.on("camera-changed", onCameraChangedForLinkPicker);
    const unsubscribeCameraForAudioOverlay = engine.events.on(
      "camera-changed",
      onCameraChangedForAudioOverlay,
    );

    return () => {
      onEngineDispose?.();
      loadCancelled = true;
      document.removeEventListener("mousedown", handleOutsideInteraction, true);
      container.removeEventListener("pointerdown", handleCanvasPointerDown, true);
      container.removeEventListener("click", handleCanvasClick);
      // A page switch mid-edit (e.g. clicking a different page in the sidebar) never routes
      // through the canvas's own "click elsewhere" detection that normally fires
      // "text-edit:end" (see text-edit-events.ts's doc comment — that path only sees clicks ON
      // the canvas) — without this, the ProseMirror view's live, uncommitted keystrokes would
      // just be discarded by activeField.destroy() below instead of written back to the scene
      // via endTextEdit's own UpdateObjectCommand, and flushSave would then persist the page
      // with the text box's stale pre-edit content.
      if (activeObjectId) {
        endTextEdit({ objectId: activeObjectId });
      }
      closeLinkPicker();
      closeAudioOverlay();
      flushSave();
      unsubscribeCommandsChanged?.();
      unsubscribeBegin();
      unsubscribeEnd();
      unsubscribeCamera();
      unsubscribeLinkEdit();
      unsubscribeCameraForLinkPicker();
      unsubscribeCameraForAudioOverlay();
      resizeObserver.disconnect();
      engine.dispose();
      engineRef.current = null;
    };
  }, [
    notebookId,
    sectionId,
    pageId,
    onEngineReady,
    onEngineDispose,
    onSaved,
    onLinkedPageCreated,
    storageClient,
    inkSettings,
    pointerSourceOverrides,
    recognizeShapesRef,
    effectiveReloadToken,
  ]);

  // --- Eraser-radius cursor ring ------------------------------------------
  // A separate effect (not folded into the mount effect above) so switching tools doesn't
  // remount the whole engine and lose undo history — but it still needs to re-bind whenever
  // the engine above actually gets recreated (a page switch), hence mirroring that effect's
  // own notebookId/sectionId/pageId deps here even though this effect doesn't read them
  // directly; it only reads engineRef.current, which those changes indirectly replace.
  useEffect(() => {
    const container = containerRef.current;
    const engine = engineRef.current;
    const isEraserTool = activeToolId === "pixel-eraser" || activeToolId === "stroke-eraser";
    if (!container || !engine || !activeToolId || !isEraserTool) return;

    const cursor = document.createElement("div");
    cursor.className = "renote-eraser-cursor";
    cursor.style.display = "none";
    container.appendChild(cursor);

    let lastClientX = 0;
    let lastClientY = 0;

    const redraw = () => {
      const rect = container.getBoundingClientRect();
      const radiusWorld = engine.inkSettings.get(activeToolId)?.width ?? 0;
      const radiusPx = radiusWorld * engine.getCamera().zoom;
      cursor.style.width = `${radiusPx * 2}px`;
      cursor.style.height = `${radiusPx * 2}px`;
      cursor.style.left = `${lastClientX - rect.left - radiusPx}px`;
      cursor.style.top = `${lastClientY - rect.top - radiusPx}px`;
    };

    const handleMouseMove = (event: MouseEvent) => {
      lastClientX = event.clientX;
      lastClientY = event.clientY;
      cursor.style.display = "block";
      redraw();
    };
    const handleMouseLeave = () => {
      cursor.style.display = "none";
    };

    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mouseleave", handleMouseLeave);
    const unsubscribeCameraForCursor = engine.events.on("camera-changed", redraw);
    const unsubscribeInkSettingsForCursor = engine.inkSettings.events.on("changed", (payload) => {
      if (payload.toolId === activeToolId) redraw();
    });

    return () => {
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mouseleave", handleMouseLeave);
      unsubscribeCameraForCursor();
      unsubscribeInkSettingsForCursor();
      cursor.remove();
    };
  }, [activeToolId, notebookId, sectionId, pageId, effectiveReloadToken]);

  // --- Selection outline + move/rotate/scale handles -----------------------
  // Purely visual (pointer-events: none) — `SelectTool` itself does all handle hit-testing
  // through the normal world-space pointer dispatcher (see `selection-geometry.ts`'s doc
  // comment on why), so this effect only ever redraws, never intercepts input. Only shown while
  // the select tool is active, same tool-gating as the eraser-radius ring above.
  useEffect(() => {
    const container = containerRef.current;
    const engine = engineRef.current;
    if (!container || !engine || activeToolId !== "select") return;

    const outline = document.createElement("div");
    outline.className = "renote-selection-overlay";
    outline.style.display = "none";
    container.appendChild(outline);

    const handleEls = new Map<HandleId, HTMLDivElement>();

    const redraw = () => {
      const selectedObjects = engine.selection.selectedIds
        .map((id) => engine.scene.get(id))
        .filter((object): object is PageObject => object !== undefined);
      const geometry = computeSelectionGeometry(selectedObjects, engine.objectTypes, engine.getCamera().zoom);

      if (!geometry) {
        outline.style.display = "none";
        for (const el of handleEls.values()) el.remove();
        handleEls.clear();
        return;
      }

      const camera = engine.getCamera();
      outline.style.display = "block";
      outline.style.width = `${geometry.size.width * camera.zoom}px`;
      outline.style.height = `${geometry.size.height * camera.zoom}px`;
      const outlineX = (geometry.pivot.x - camera.x) * camera.zoom;
      const outlineY = (geometry.pivot.y - camera.y) * camera.zoom;
      outline.style.transform = `translate(${outlineX}px, ${outlineY}px) rotate(${geometry.rotation}rad) translate(-50%, -50%)`;

      const liveHandleIds = new Set(geometry.handles.map((handle) => handle.id));
      for (const [id, el] of handleEls) {
        if (!liveHandleIds.has(id)) {
          el.remove();
          handleEls.delete(id);
        }
      }

      for (const handle of geometry.handles) {
        let el = handleEls.get(handle.id);
        if (!el) {
          el = document.createElement("div");
          el.className =
            handle.id === "rotate"
              ? "renote-selection-handle renote-selection-handle-rotate"
              : `renote-selection-handle renote-selection-handle-${handle.id}`;
          container.appendChild(el);
          handleEls.set(handle.id, el);
        }
        const hx = (handle.x - camera.x) * camera.zoom;
        const hy = (handle.y - camera.y) * camera.zoom;
        el.style.transform = `translate(${hx}px, ${hy}px) translate(-50%, -50%)`;
      }
    };

    redraw();
    const unsubscribeSelection = engine.selection.events.on("changed", redraw);
    const unsubscribeAdded = engine.scene.events.on("added", redraw);
    const unsubscribeUpdated = engine.scene.events.on("updated", redraw);
    const unsubscribeRemoved = engine.scene.events.on("removed", redraw);
    const unsubscribeCameraForSelection = engine.events.on("camera-changed", redraw);

    return () => {
      unsubscribeSelection();
      unsubscribeAdded();
      unsubscribeUpdated();
      unsubscribeRemoved();
      unsubscribeCameraForSelection();
      outline.remove();
      for (const el of handleEls.values()) el.remove();
    };
  }, [activeToolId, notebookId, sectionId, pageId, effectiveReloadToken]);

  // The conflict bar. Nothing auto-resolves — silently merging two versions of a canvas document
  // is not a thing — so this is strictly the user's choice between the two versions.
  return (
    <>
      <div ref={containerRef} className="renote-page-editor" />
      {conflict !== null && (
        <div className="renote-conflict-bar" role="alert">
          <span className="renote-conflict-bar-message">
            This page was changed outside reNote (at {conflict}). Your edits are not saved.
          </span>
          <PixelButton
            onClick={() => {
              forceSaveRef.current = true;
              flushSaveRef.current?.();
            }}
          >
            Keep mine
          </PixelButton>
          <PixelButton onClick={() => setConflictReloadToken((token) => token + 1)}>
            Reload from disk
          </PixelButton>
        </div>
      )}
    </>
  );
}
