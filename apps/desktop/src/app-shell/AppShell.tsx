import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  AddObjectCommand,
  CompositeCommand,
  InkSettingsRegistry,
  RemoveObjectCommand,
  UpdateObjectCommand,
  convertInkStrokeToShape,
  createAudioClipObject,
  createImageObject,
  createLinkButton,
  createTextBox,
  straightenInkStroke,
  type InkStrokeEngineObject,
  type PageEngine,
} from "@renote/canvas-engine";
import { transformedBounds, type AppCommand, type Bounds, type PageObject } from "@renote/core";
import { KeymapRegistry, keyboardEventToCombo } from "@renote/shortcuts";
import {
  AutosavePanel,
  BacklinksPanel,
  CommandPalette,
  ContextMenu,
  FindBar,
  HelpDialog,
  HistoryPanel,
  Minimap,
  Panel,
  PageBackgroundPanel,
  PixelButton,
  RecordingPanel,
  RelatedNotesPanel,
  SearchPanel,
  SettingsDialog,
  TaggedParagraphsPanel,
  TagSummaryPanel,
  ThemeToggle,
  ToolSettingsPanel,
  Toolbar,
  TrashPanel,
  TreeView,
  useTheme,
  type AutosaveEntry,
  type BacklinkEntry,
  type CommandPaletteItem,
  type ContextMenuItem,
  type HistoryEntry,
  type PageBackgroundValue,
  type RelatedNoteEntry,
  type SearchResultItem,
  type TaggedParagraphEntry,
  type TagSummaryEntry,
  type TagSummaryKind,
  type ToolbarGroup,
  type ToolbarItem,
  type TreeNode,
} from "@renote/ui";
import type {
  NotebookDto,
  PageDto,
  SearchHitDto,
  SectionDto,
  StorageClient,
  TagDto,
  TaggedParagraphDto,
  TrashEntryDto,
} from "@renote/storage-client";
import { GraphView } from "../graph-view/GraphView.js";
import { PageEditorView } from "../page-editor/PageEditorView.js";
import { centerCameraOn, findMatchingObjects, type WikilinkTarget } from "../page-editor/page-anchors.js";
import {
  assetPathsOf,
  centerObjectsOn,
  decodeObjects,
  encodeObjects,
  plainTextContent,
  remapAssetPaths,
  translateObjects,
  withFreshIds,
  type ClipboardSource,
} from "../page-editor/clipboard.js";
import { useStorageClient } from "../providers/StorageProvider.js";
import { useSettings } from "../providers/SettingsProvider.js";
import { applyAutoInkColorForBackground } from "./auto-ink-switch.js";
import { tagBoxContent } from "./tag-box-content.js";
import { downloadBlob, pickFile, printHtml } from "./file-io.js";

/** Human-readable labels for the canvas engine's registered tool ids. */
const TOOL_LABELS: Record<string, string> = {
  select: "Select",
  pen: "Pen",
  highlighter: "Highlighter",
  "stroke-eraser": "Stroke Eraser",
  "pixel-eraser": "Pixel Eraser",
  lasso: "Lasso",
  "shape-rectangle": "Rectangle",
  "shape-ellipse": "Ellipse",
  "shape-line": "Line",
  "shape-arrow": "Arrow",
  "text-box": "Text Box",
};

/** Leading glyph shown next to each tool's label on the toolbar button. */
const TOOL_ICONS: Record<string, string> = {
  select: "◸",
  pen: "✎",
  highlighter: "▬",
  "stroke-eraser": "⌫",
  "pixel-eraser": "▦",
  lasso: "◌",
  "shape-rectangle": "▭",
  "shape-ellipse": "○",
  "shape-line": "╱",
  "shape-arrow": "↗",
  "text-box": "T",
};

/** Which tools carry live `{color, width}` settings (see `engine.inkSettings`) and the
 *  slider bounds for each — select/lasso have neither and show no settings panel at all.
 *  `hasColor: false` for the erasers, whose `width` field doubles as a hit-tolerance/erase
 *  radius rather than a stroke color (see `ink-settings.ts`'s doc comment). */
const TOOL_SETTINGS_CONFIG: Record<string, { hasColor: boolean; minWidth: number; maxWidth: number }> = {
  pen: { hasColor: true, minWidth: 1, maxWidth: 20 },
  highlighter: { hasColor: true, minWidth: 4, maxWidth: 40 },
  "shape-rectangle": { hasColor: true, minWidth: 1, maxWidth: 20 },
  "shape-ellipse": { hasColor: true, minWidth: 1, maxWidth: 20 },
  "shape-line": { hasColor: true, minWidth: 1, maxWidth: 20 },
  "shape-arrow": { hasColor: true, minWidth: 1, maxWidth: 20 },
  "pixel-eraser": { hasColor: false, minWidth: 4, maxWidth: 60 },
  "stroke-eraser": { hasColor: false, minWidth: 2, maxWidth: 40 },
};

const SELECT_TOOL_IDS = ["select"];
const DRAW_TOOL_IDS = ["pen", "highlighter", "stroke-eraser", "pixel-eraser", "lasso"];
const SHAPE_TOOL_IDS = ["shape-rectangle", "shape-ellipse", "shape-line", "shape-arrow"];
const TEXT_TOOL_IDS = ["text-box"];

/** All tool ids in shortcut order, paired 1:1 with `TOOL_SHORTCUT_KEYS` below — "text-box" has
 *  no numbered shortcut (there are only ten "1".."9"/"0" keys and all ten are already spoken
 *  for), so it falls back to `TOOL_SHORTCUT_KEYS[index] ?? null` (no default shortcut) below;
 *  it's still reachable via its toolbar button and the command palette. */
const ALL_TOOL_IDS = [...SELECT_TOOL_IDS, ...DRAW_TOOL_IDS, ...SHAPE_TOOL_IDS, ...TEXT_TOOL_IDS];
/** "1".."9" then "0" — the ten default single-key tool shortcuts, in `ALL_TOOL_IDS` order. */
const TOOL_SHORTCUT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

/** Placement size for the "Insert Tag"/"Insert Link" boxes — matches `TextBoxTool`'s own
 *  click-to-place default, so a spawned one looks exactly like a hand-placed text box (and
 *  autosizes from there the moment it's edited). */
const SPAWNED_BOX_WIDTH = 220;
const SPAWNED_BOX_HEIGHT = 32;
/** Auto-created top-level section Quick Capture (Phase 11.2) drops its pages into — found by
 *  name each time rather than tracked by id, since there's no other place that remembers it. */
const QUICK_NOTES_SECTION_NAME = "Quick Notes";
/** Starting size of a spawned link button, before its target is picked — it is re-sized to fit
 *  the target's label once there is one (see `linkButtonWidthFor`). */
const LINK_BUTTON_WIDTH = 180;
const LINK_BUTTON_HEIGHT = 30;
/** Placement size for a spawned "audio-clip" object — wide enough for the play well, track and
 *  duration/filename label (see `audio-clip-object-type.ts`'s `drawAudioClipView`). */
const AUDIO_CLIP_WIDTH = 240;
const AUDIO_CLIP_HEIGHT = 36;
/** Each successive spawn is nudged this far down-right of the last (page units), wrapping after
 *  this many steps — see `centeredBounds`. */
/** The commands that act on the current canvas selection, so the palette can hide them when
 *  nothing is selected. */
const SELECTION_COMMANDS = new Set([
  "edit:cut",
  "edit:copy",
  "edit:duplicate",
  "edit:delete-objects",
  "object:bring-to-front",
  "object:send-to-back",
  "object:convert-to-shape",
  "object:straighten-stroke",
]);
/** Context-menu entries that start a new visual group (a divider is drawn above them). */
const CONTEXT_MENU_GROUP_STARTS = new Set([
  "edit:delete-objects",
  "object:bring-to-front",
  "page:trash",
  "section:trash",
  "notebook:trash",
]);

const SPAWN_CASCADE_OFFSET = 18;
const SPAWN_CASCADE_STEPS = 8;

/** A sortable, monotonically-increasing key good enough for "new items append at the end." */
function newOrderKey(): string {
  return Date.now().toString().padStart(20, "0");
}

/**
 * Shows the user a rejected rename's reason. Names are unique within their parent (see
 * `renote-commands`' `naming` module), so renaming a page to a title its section already carries
 * is refused — and without this the row would just silently snap back to its old label with no
 * explanation. The message comes straight from the command, which rejects with a plain string.
 *
 * ponytail: `window.alert` blocks the whole webview. Route it through a toast the day this app
 * grows one.
 */
function reportRename(error: unknown): void {
  console.error("Rename refused.", error);
  window.alert(error instanceof Error ? error.message : String(error));
}

/** Sanitizes a notebook name into a safe suggested backup file name. */
function suggestedBackupFileName(notebookName: string): string {
  return `${notebookName.trim().replace(/[/\\:*?"<>|]/g, "_") || "notebook"}.renote.json`;
}

/** Sanitizes a title into a safe suggested export file name, same character set
 *  `suggestedBackupFileName` rejects. */
function suggestedExportFileName(title: string, extension: string): string {
  return `${title.trim().replace(/[/\\:*?"<>|]/g, "_") || "untitled"}.${extension}`;
}

/** World-space bounding box containing every object's bounds, or null for an empty page —
 *  feeds the minimap's `contentBounds` prop. */
function unionBounds(objects: readonly PageObject[]): Bounds | null {
  if (objects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const object of objects) {
    minX = Math.min(minX, object.bounds.x);
    minY = Math.min(minY, object.bounds.y);
    maxX = Math.max(maxX, object.bounds.x + object.bounds.width);
    maxY = Math.max(maxY, object.bounds.y + object.bounds.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Fetches one level of section-groups/sections under `parentGroupId`, recursing
 * into any group that's currently expanded. Fetching on every render pass is
 * intentional for this phase — no caching layer, notebook contents are small.
 */
async function buildGroupLevel(
  client: StorageClient,
  notebookId: string,
  parentGroupId: string | null,
  depth: number,
  expandedGroupIds: Set<string>,
  selectedSectionId: string | null,
  selectedPageId: string | null,
  pagesForSelectedSection: PageDto[],
): Promise<TreeNode[]> {
  const [groups, sections] = await Promise.all([
    client.listSectionGroups({ notebookId, parentGroupId }),
    client.listSections({ notebookId, parentGroupId }),
  ]);

  const nodes: TreeNode[] = [];

  for (const group of groups) {
    const expanded = expandedGroupIds.has(group.id);
    nodes.push({
      id: `group:${group.id}`,
      label: group.name,
      depth,
      hasChildren: true,
      expanded,
      selected: false,
      icon: "section-group",
    });
    if (expanded) {
      const children = await buildGroupLevel(
        client,
        notebookId,
        group.id,
        depth + 1,
        expandedGroupIds,
        selectedSectionId,
        selectedPageId,
        pagesForSelectedSection,
      );
      nodes.push(...children);
    }
  }

  for (const section of sections) {
    const selected = section.id === selectedSectionId;
    nodes.push({
      id: `section:${section.id}`,
      label: section.name,
      depth,
      hasChildren: true,
      expanded: selected,
      // A section stays visually expanded (its pages listed below) even once a page
      // within it is chosen, but only ONE row in the whole tree should ever get the
      // strong "this is the current selection" treatment — so a section only counts as
      // selected in its own right when nothing more specific is chosen underneath it.
      selected: selected && !selectedPageId,
      icon: "section",
    });
    if (selected) {
      pushPageNodes(nodes, pagesForSelectedSection, null, depth + 1, selectedPageId, new Set());
    }
  }

  return nodes;
}

/**
 * Recursively indents pages under their `parentPageId` (Phase 11.4 subpages) — `parentPageId`/
 * `orderKey` are pure ordering metadata, not filesystem nesting (see `renote_storage`'s module
 * docs), so this is the one place that turns them into visual depth. `pages` is already
 * `orderKey`-sorted (see `listPages`'s doc comment), and `Array.filter` preserves that order, so
 * each recursive pass lists its children in the right order without a separate sort.
 *
 * `visited` guards against a cycle (a page whose ancestry loops back to itself) turning into an
 * infinite recursion — normal use (indent/outdent below) can never create one, but this is cheap
 * insurance against corrupted `parentPageId` data doing it anyway.
 */
function pushPageNodes(
  nodes: TreeNode[],
  pages: readonly PageDto[],
  parentPageId: string | null,
  depth: number,
  selectedPageId: string | null,
  visited: Set<string>,
): void {
  for (const page of pages) {
    if (page.parentPageId !== parentPageId || visited.has(page.id)) continue;
    visited.add(page.id);
    nodes.push({
      id: `page:${page.id}`,
      label: page.title,
      depth,
      hasChildren: false,
      expanded: false,
      selected: page.id === selectedPageId,
      icon: "page",
    });
    pushPageNodes(nodes, pages, page.id, depth + 1, selectedPageId, visited);
  }
}

/**
 * Finds the first section reachable from a notebook's root (or, recursively, from a given
 * section-group), in the same listing order the nav tree itself renders — so "first" here means
 * whatever section would visually appear first once fully expanded. Returns the ids of any
 * section-groups that must be expanded to reveal it, so the caller can add them to
 * `expandedGroupIds` and the tree actually shows the path down to the auto-selected section
 * rather than leaving it selected-but-hidden. Returns `null` if the notebook has no sections at
 * all (an empty/freshly created notebook).
 */
async function findFirstSection(
  client: StorageClient,
  notebookId: string,
  parentGroupId: string | null = null,
): Promise<{ sectionId: string; expandPath: string[] } | null> {
  const [groups, sections] = await Promise.all([
    client.listSectionGroups({ notebookId, parentGroupId }),
    client.listSections({ notebookId, parentGroupId }),
  ]);
  if (sections.length > 0) {
    return { sectionId: sections[0]!.id, expandPath: [] };
  }
  for (const group of groups) {
    const found = await findFirstSection(client, notebookId, group.id);
    if (found) return { sectionId: found.sectionId, expandPath: [group.id, ...found.expandPath] };
  }
  return null;
}

/** Builds the full flattened tree: notebooks at depth 0, the open one expanded into its contents. */
async function buildTreeNodes(
  client: StorageClient,
  notebooks: NotebookDto[],
  openNotebookId: string | null,
  expandedGroupIds: Set<string>,
  selectedSectionId: string | null,
  selectedPageId: string | null,
  pagesForSelectedSection: PageDto[],
): Promise<TreeNode[]> {
  const nodes: TreeNode[] = [];

  for (const notebook of notebooks) {
    const expanded = notebook.id === openNotebookId;
    nodes.push({
      id: `notebook:${notebook.id}`,
      label: notebook.name,
      depth: 0,
      hasChildren: true,
      expanded,
      // Same reasoning as the section node below: being open (expanded) isn't the same
      // as being the current selection — a notebook only counts as truly selected when
      // nothing more specific (a section or page inside it) is chosen, otherwise every
      // ancestor on the path to the real selection would light up identically and it'd
      // be unclear which row Delete Selected/Restore-style actions actually target.
      selected: expanded && !selectedSectionId,
      icon: "notebook",
    });
    if (expanded) {
      const children = await buildGroupLevel(
        client,
        notebook.id,
        null,
        1,
        expandedGroupIds,
        selectedSectionId,
        selectedPageId,
        pagesForSelectedSection,
      );
      nodes.push(...children);
    }
  }

  return nodes;
}

const LAST_OPEN_KEY = "renote:last-open";

interface LastOpen {
  notebookId: string | null;
  sectionId: string | null;
  pageId: string | null;
}

const NOTHING_OPEN: LastOpen = { notebookId: null, sectionId: null, pageId: null };

/** What was open when the app last closed. Client-local UI state, kept in `localStorage`. */
function loadLastOpen(): LastOpen {
  try {
    const raw = window.localStorage.getItem(LAST_OPEN_KEY);
    if (!raw) return NOTHING_OPEN;
    const parsed = JSON.parse(raw) as Partial<LastOpen>;
    return {
      notebookId: typeof parsed.notebookId === "string" ? parsed.notebookId : null,
      sectionId: typeof parsed.sectionId === "string" ? parsed.sectionId : null,
      pageId: typeof parsed.pageId === "string" ? parsed.pageId : null,
    };
  } catch {
    return NOTHING_OPEN;
  }
}

export function AppShell() {
  const client = useStorageClient();
  const { mode, setMode } = useTheme();
  const {
    pointerSourceOverridesRef,
    pointerSourceOverrides,
    setPointerSourceOverride,
    autosaveIntervalSeconds,
    setAutosaveIntervalSeconds,
    setThemeMode,
    recognizeShapesRef,
    recognizeShapes,
    setRecognizeShapes,
  } = useSettings();

  /** Toggles the live theme AND records it as the mode to start in next time. */
  const toggleTheme = useCallback(() => {
    const next = mode === "light" ? "dark" : "light";
    setMode(next);
    setThemeMode(next);
  }, [mode, setMode, setThemeMode]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [backgroundPanelOpen, setBackgroundPanelOpen] = useState(false);

  // --- Navigation state ----------------------------------------------------
  const [notebooks, setNotebooks] = useState<NotebookDto[]>([]);
  const [notebooksRefreshToken, setNotebooksRefreshToken] = useState(0);
  // Restored from the last run so the app reopens where it was left — see `loadLastOpen`. Read
  // once (lazy `useState`), never re-read: from here on these are ordinary selection state.
  const [lastOpen] = useState(() => loadLastOpen());
  const [openNotebookId, setOpenNotebookId] = useState<string | null>(lastOpen.notebookId);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(lastOpen.sectionId);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(lastOpen.pageId);
  const [pages, setPages] = useState<PageDto[]>([]);
  const [pagesRefreshToken, setPagesRefreshToken] = useState(0);
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [treeRefreshToken, setTreeRefreshToken] = useState(0);
  const [trashEntries, setTrashEntries] = useState<TrashEntryDto[]>([]);
  const [trashRefreshToken, setTrashRefreshToken] = useState(0);
  const [tags, setTags] = useState<TagDto[]>([]);
  const [tagsRefreshToken, setTagsRefreshToken] = useState(0);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [autosaveEntry, setAutosaveEntry] = useState<AutosaveEntry | null>(null);
  const [autosaveRefreshToken, setAutosaveRefreshToken] = useState(0);
  // Bumped after an autosave restore to force PageEditorView's mount effect to re-run for the
  // SAME pageId (see that component's `reloadToken` prop doc comment) — nothing else in its
  // dependency list changes when only a page's on-disk content, not its id, is replaced.
  const [pageReloadToken, setPageReloadToken] = useState(0);
  // What a rename/background write left the page's `modifiedAt` at, handed to PageEditorView so
  // its next save doesn't mistake this app's own write for an external one — see that
  // component's `pageRevision` prop doc comment.
  const [pageRevision, setPageRevision] = useState<{
    pageId: string;
    modifiedAt: string;
  } | null>(null);

  // --- Phase 7: page linking + graph view ----------------------------------
  // `apps/desktop` has no router — same top-level-boolean-toggle pattern `focusMode` already
  // uses (see its own declaration further below), just with a third render target instead of
  // "hide the chrome": "graph" swaps the whole editor body for `GraphView`.
  const [viewMode, setViewMode] = useState<"editor" | "graph">("editor");
  const [backlinks, setBacklinks] = useState<PageDto[]>([]);
  // Bumped on every debounced content save (see `handlePageSaved`) — a save is exactly what can
  // add/remove a wikilink, INCLUDING a self-link pointing right back at the same page currently
  // open, which changes that page's own backlinks without any navigation ever happening to
  // otherwise re-trigger the fetch below (selectedPageId stays the same the whole time).
  const [backlinksRefreshToken, setBacklinksRefreshToken] = useState(0);

  useEffect(() => {
    client
      .listNotebooks()
      .then(setNotebooks)
      .catch((error: unknown) => {
        console.error("Failed to list notebooks.", error);
      });
  }, [client, notebooksRefreshToken]);

  // A notebook that isn't there anymore can't stay open — covers a restored id whose notebook was
  // deleted since (or trashed in this session), which would otherwise leave the tree expanded on
  // nothing with a dead section/page selected under it.
  useEffect(() => {
    if (!openNotebookId || notebooks.length === 0) return;
    if (notebooks.some((notebook) => notebook.id === openNotebookId)) return;
    setOpenNotebookId(null);
    setSelectedSectionId(null);
    setSelectedPageId(null);
  }, [notebooks, openNotebookId]);

  // Remembers where the user was, for `loadLastOpen` to restore on the next run.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        LAST_OPEN_KEY,
        JSON.stringify({
          notebookId: openNotebookId,
          sectionId: selectedSectionId,
          pageId: selectedPageId,
        }),
      );
    } catch {
      // Same as `SettingsProvider`'s persist: a localStorage write can throw, and all that costs
      // is reopening on nothing.
    }
  }, [openNotebookId, selectedSectionId, selectedPageId]);

  useEffect(() => {
    client
      .listTrash()
      .then(setTrashEntries)
      .catch((error: unknown) => {
        console.error("Failed to list trash.", error);
      });
  }, [client, trashRefreshToken]);

  useEffect(() => {
    if (!openNotebookId || !selectedSectionId) {
      setPages([]);
      return;
    }
    let cancelled = false;
    client
      .listPages({ notebookId: openNotebookId, sectionId: selectedSectionId })
      .then((result) => {
        if (cancelled) return;
        setPages(result);
        // Never leave a selected section with no page open — see this component's other
        // cascading-selection logic (notebook-open picks a first section the same way). Only
        // steps in when nothing in THIS section's own page list is already selected (a fresh
        // section pick, or the previously selected page having just been trashed/moved out from
        // under it); a page the user deliberately chose within this section is left alone.
        setSelectedPageId((prevPageId) => {
          if (prevPageId && result.some((page) => page.id === prevPageId)) return prevPageId;
          return result[0]?.id ?? null;
        });
      })
      .catch((error: unknown) => {
        console.error("Failed to list pages.", error);
        // Most likely a section that no longer exists (a restored id from the last run, deleted
        // since). Drop the selection rather than sitting on a section nothing can load.
        if (cancelled) return;
        setSelectedSectionId(null);
        setSelectedPageId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, openNotebookId, selectedSectionId, pagesRefreshToken]);

  useEffect(() => {
    if (!openNotebookId) {
      setTags([]);
      setSelectedTagId(null);
      return;
    }
    let cancelled = false;
    client
      .listTags({ notebookId: openNotebookId })
      .then((result) => {
        if (!cancelled) setTags(result);
      })
      .catch((error: unknown) => {
        console.error("Failed to list tags.", error);
      });
    return () => {
      cancelled = true;
    };
  }, [client, openNotebookId, tagsRefreshToken]);

  // Autosave status is page-scoped (like the undo/redo command log), so it's fetched whenever
  // the selected page changes — mirroring how the `pages` effect above guards on
  // `selectedSectionId` being set.
  useEffect(() => {
    if (!openNotebookId || !selectedSectionId || !selectedPageId) {
      setAutosaveEntry(null);
      return;
    }
    let cancelled = false;
    client
      .getAutosaveStatus({ notebookId: openNotebookId, sectionId: selectedSectionId, pageId: selectedPageId })
      .then((result) => {
        if (!cancelled) setAutosaveEntry(result);
      })
      .catch((error: unknown) => {
        console.error("Failed to get autosave status.", error);
      });
    return () => {
      cancelled = true;
    };
  }, [client, openNotebookId, selectedSectionId, selectedPageId, autosaveRefreshToken]);

  // Autosave timer: overwrites the open page's one autosave slot at the interval the user
  // picked in Settings (see `SettingsDialog`'s "Autosave" section) — a value of 0 turns
  // autosave off entirely, matching `SettingsDialogProps.autosaveIntervalSeconds`'s doc
  // comment. Unlike the debounced content save inside `PageEditorView` (which persists the
  // live page on every edit), this fires on a plain wall-clock interval regardless of whether
  // anything changed since the last tick.
  useEffect(() => {
    if (!openNotebookId || !selectedSectionId || !selectedPageId || autosaveIntervalSeconds <= 0) {
      return;
    }
    const notebookId = openNotebookId;
    const sectionId = selectedSectionId;
    const pageId = selectedPageId;
    const intervalId = window.setInterval(() => {
      client
        .saveAutosave({ notebookId, sectionId, pageId })
        .then(() => {
          setAutosaveRefreshToken((token) => token + 1);
        })
        .catch((error: unknown) => {
          console.error("Failed to autosave.", error);
        });
    }, autosaveIntervalSeconds * 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [client, openNotebookId, selectedSectionId, selectedPageId, autosaveIntervalSeconds]);

  // Backlinks ("Linked Mentions") are page-scoped, same guard/dependency shape as autosave
  // status above. Refetched on `pagesRefreshToken` (a new page anywhere in the notebook, e.g.
  // wikilink auto-create, might be the source of a link into this one) AND on
  // `backlinksRefreshToken` (every debounced content save of the CURRENTLY open page itself —
  // see that token's own doc comment for why a self-link needs this one specifically).
  useEffect(() => {
    if (!openNotebookId || !selectedSectionId || !selectedPageId) {
      setBacklinks([]);
      return;
    }
    let cancelled = false;
    client
      .listBacklinks({ notebookId: openNotebookId, sectionId: selectedSectionId, pageId: selectedPageId })
      .then((result) => {
        if (!cancelled) setBacklinks(result);
      })
      .catch((error: unknown) => {
        console.error("Failed to list backlinks.", error);
      });
    return () => {
      cancelled = true;
    };
  }, [client, openNotebookId, selectedSectionId, selectedPageId, pagesRefreshToken, backlinksRefreshToken]);

  const backlinkEntries: BacklinkEntry[] = useMemo(
    () => backlinks.map((page) => ({ id: page.id, title: page.title })),
    [backlinks],
  );

  const handleBacklinkSelect = useCallback(
    (pageId: string) => {
      const target = backlinks.find((page) => page.id === pageId);
      if (!target) return;
      // Wikilinks are notebook-scoped (see `resolve_wikilink_target`'s doc comment) — the
      // backlinking page always belongs to the SAME notebook already open, so `openNotebookId`
      // itself never needs to change here, only which section/page is selected within it.
      setSelectedSectionId(target.sectionId);
      setSelectedPageId(target.id);
    },
    [backlinks],
  );

  // --- Phase 13: Related Notes (local semantic layer) -----------------------
  // Same page-scoped guard/refetch shape as Backlinks above — `backlinksRefreshToken` is reused
  // rather than a new token: it already bumps on every debounced content save of the currently
  // open page, which is exactly when that page's own embedding vector (and so its nearest
  // neighbours) can have changed.
  const [relatedNotes, setRelatedNotes] = useState<SearchHitDto[]>([]);

  useEffect(() => {
    if (!openNotebookId || !selectedSectionId || !selectedPageId) {
      setRelatedNotes([]);
      return;
    }
    let cancelled = false;
    client
      .findRelatedPages({
        notebookId: openNotebookId,
        sectionId: selectedSectionId,
        pageId: selectedPageId,
        limit: 5,
      })
      .then((result) => {
        if (!cancelled) setRelatedNotes(result);
      })
      .catch((error: unknown) => {
        console.error("Failed to find related pages.", error);
      });
    return () => {
      cancelled = true;
    };
  }, [client, openNotebookId, selectedSectionId, selectedPageId, pagesRefreshToken, backlinksRefreshToken]);

  const relatedNoteEntries: RelatedNoteEntry[] = useMemo(
    () => relatedNotes.map((hit) => ({ id: hit.pageId, title: hit.title })),
    [relatedNotes],
  );

  const handleRelatedNoteSelect = useCallback(
    (pageId: string) => {
      const target = relatedNotes.find((hit) => hit.pageId === pageId);
      if (!target) return;
      setSelectedSectionId(target.sectionId);
      setSelectedPageId(target.pageId);
    },
    [relatedNotes],
  );

  // --- Following a wikilink -------------------------------------------------
  /** Set just before navigating to a link's target page, and handed to `PageEditorView` so it can
   *  center the camera on that heading once the new page's objects have loaded — see that
   *  component's `pendingAnchor` prop. Same-page anchors never come through here (PageEditorView
   *  pans for those itself, with no navigation involved). */
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);

  /**
   * Navigates to a clicked wikilink's target page, wherever it lives — a different section, or a
   * different notebook (a wikilink stores only its target's page id, which is notebook-agnostic).
   * The page currently open is already handled inside `PageEditorView`, so anything reaching here
   * is a real navigation and needs the target's notebook/section, which the id alone doesn't give.
   *
   * The section currently open is answered straight from `pages`; anything else is looked up by
   * page id in the workspace-wide location list (`listPageLocations`), so a link still resolves
   * after its target has been renamed or moved to another section — the id is all it stores.
   */
  const handleFollowLink = useCallback(
    (target: WikilinkTarget) => {
      const local = pages.find((page) => page.id === target.pageId);
      if (local) {
        setPendingAnchor(target.anchor);
        setSelectedPageId(local.id);
        return;
      }
      client
        .listPageLocations()
        .then((locations) => {
          const location = locations.find((candidate) => candidate.pageId === target.pageId);
          if (!location) {
            console.warn("Could not locate the page this link points to.", target);
            return;
          }
          setPendingAnchor(target.anchor);
          setOpenNotebookId(location.notebookId);
          setSelectedSectionId(location.sectionId);
          setSelectedPageId(location.pageId);
        })
        .catch((error: unknown) => {
          console.error("Failed to follow link.", error);
        });
    },
    [client, pages],
  );

  const handleGraphNavigate = useCallback((sectionId: string, pageId: string) => {
    setSelectedSectionId(sectionId);
    setSelectedPageId(pageId);
    setViewMode("editor");
  }, []);

  // Per-tag note counts for TagSummaryPanel: one tag-filtered, empty-free-text search per tag
  // (search's "browse by tag" path — see renote-index's search.rs — returns every page carrying
  // that tag with no text query needed). Notebook-scoped tag counts, not per-paragraph, since a
  // page counts once even if several of its paragraphs carry the same tag (matching the
  // dedup already built into the tag-filtered search query itself).
  const [tagCounts, setTagCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (tags.length === 0) {
      setTagCounts({});
      return;
    }
    let cancelled = false;
    Promise.all(
      tags.map((tag) =>
        client
          .search({
            text: "",
            notebookIds: openNotebookId ? [openNotebookId] : null,
            sectionIds: null,
            tagIds: [tag.id],
            modifiedAfter: null,
            modifiedBefore: null,
          })
          .then((result) => [tag.id, result.hits.length] as const),
      ),
    )
      .then((entries) => {
        if (!cancelled) setTagCounts(Object.fromEntries(entries));
      })
      .catch((error: unknown) => {
        console.error("Failed to count tagged pages.", error);
      });
    return () => {
      cancelled = true;
    };
  }, [client, tags, openNotebookId, pagesRefreshToken]);

  useEffect(() => {
    if (!openNotebookId) {
      setTreeNodes(
        notebooks.map((notebook) => ({
          id: `notebook:${notebook.id}`,
          label: notebook.name,
          depth: 0,
          hasChildren: true,
          expanded: false,
          selected: false,
          icon: "notebook",
        })),
      );
      return;
    }
    let cancelled = false;
    buildTreeNodes(
      client,
      notebooks,
      openNotebookId,
      expandedGroupIds,
      selectedSectionId,
      selectedPageId,
      pages,
    )
      .then((nodes) => {
        if (!cancelled) setTreeNodes(nodes);
      })
      .catch((error: unknown) => {
        console.error("Failed to build navigation tree.", error);
      });
    return () => {
      cancelled = true;
    };
  }, [
    client,
    notebooks,
    openNotebookId,
    expandedGroupIds,
    selectedSectionId,
    selectedPageId,
    pages,
    treeRefreshToken,
  ]);

  const handleToggleExpand = useCallback(
    (id: string) => {
      if (id.startsWith("notebook:")) {
        const notebookId = id.slice("notebook:".length);
        if (openNotebookId === notebookId) {
          // Collapsing the currently open notebook — no section/page context survives that.
          setOpenNotebookId(null);
          setSelectedSectionId(null);
          setSelectedPageId(null);
          return;
        }
        setOpenNotebookId(notebookId);
        setSelectedSectionId(null);
        setSelectedPageId(null);
        // Cascade straight to a real page — see this component's other cascading-selection
        // logic (the pages-fetch effect does the same thing one level down, section -> page).
        // "There should never be a time you're taking notes that don't belong to any page":
        // opening a notebook with content should land you on one, not on an empty canvas you
        // have to know to drill into manually.
        findFirstSection(client, notebookId)
          .then((found) => {
            if (!found) return;
            setSelectedSectionId(found.sectionId);
            if (found.expandPath.length > 0) {
              setExpandedGroupIds((prevGroups) => {
                const next = new Set(prevGroups);
                for (const groupId of found.expandPath) next.add(groupId);
                return next;
              });
            }
          })
          .catch((error: unknown) => {
            console.error("Failed to find the notebook's first section.", error);
          });
      } else if (id.startsWith("group:")) {
        const groupId = id.slice("group:".length);
        setExpandedGroupIds((prev) => {
          const next = new Set(prev);
          if (next.has(groupId)) {
            next.delete(groupId);
          } else {
            next.add(groupId);
          }
          return next;
        });
      } else if (id.startsWith("section:")) {
        const sectionId = id.slice("section:".length);
        setSelectedSectionId((prev) => (prev === sectionId ? null : sectionId));
        setSelectedPageId(null);
      }
    },
    [client, openNotebookId],
  );

  const handleSelect = useCallback(
    (id: string) => {
      if (id.startsWith("page:")) {
        setSelectedPageId(id.slice("page:".length));
      } else {
        handleToggleExpand(id);
      }
    },
    [handleToggleExpand],
  );

  /** Double-clicking a tree row's label (see `TreeView`'s `onRename` prop) commits a new
   *  name/title for whichever kind of node it is, inferred from the same `<kind>:<id>` prefix
   *  every other tree-node handler in this component already switches on. */
  const handleRenameNode = useCallback(
    (id: string, label: string) => {
      if (id.startsWith("notebook:")) {
        const notebookId = id.slice("notebook:".length);
        client
          .renameNotebook({ notebookId, name: label })
          .then(() => setNotebooksRefreshToken((token) => token + 1))
          .catch(reportRename);
      } else if (id.startsWith("group:")) {
        if (!openNotebookId) return;
        const groupId = id.slice("group:".length);
        client
          .renameSectionGroup({ notebookId: openNotebookId, groupId, name: label })
          .then(() => setTreeRefreshToken((token) => token + 1))
          .catch((error: unknown) => {
            console.error("Failed to rename section group.", error);
          });
      } else if (id.startsWith("section:")) {
        if (!openNotebookId) return;
        const sectionId = id.slice("section:".length);
        client
          .renameSection({ notebookId: openNotebookId, sectionId, name: label })
          .then(() => setTreeRefreshToken((token) => token + 1))
          .catch(reportRename);
      } else if (id.startsWith("page:")) {
        if (!openNotebookId || !selectedSectionId) return;
        const pageId = id.slice("page:".length);
        client
          .renamePage({ notebookId: openNotebookId, sectionId: selectedSectionId, pageId, title: label })
          .then((page) => {
            setPageRevision({ pageId, modifiedAt: page.modifiedAt });
            setPagesRefreshToken((token) => token + 1);
          })
          .catch(reportRename);
      }
    },
    [client, openNotebookId, selectedSectionId],
  );

  const handleNewNotebook = useCallback(() => {
    client
      .createNotebook({ name: "New Notebook", color: null, parentDirectory: null })
      .then(() => setNotebooksRefreshToken((token) => token + 1))
      .catch((error: unknown) => {
        console.error("Failed to create notebook.", error);
      });
  }, [client]);

  const handleNewSection = useCallback(() => {
    if (!openNotebookId) return;
    client
      .createSection({
        notebookId: openNotebookId,
        parentGroupId: null,
        name: "New Section",
        color: null,
        orderKey: newOrderKey(),
      })
      .then((section: SectionDto) => {
        setTreeRefreshToken((token) => token + 1);
        setSelectedSectionId(section.id);
        setSelectedPageId(null);
      })
      .catch((error: unknown) => {
        console.error("Failed to create section.", error);
      });
  }, [client, openNotebookId]);

  const handleNewPage = useCallback(() => {
    if (!openNotebookId || !selectedSectionId) return;
    client
      .createPage({
        notebookId: openNotebookId,
        sectionId: selectedSectionId,
        parentPageId: null,
        orderKey: newOrderKey(),
        title: "Untitled page",
        background: { color: null, ruleLines: "none" },
        templateId: null,
      })
      .then((page: PageDto) => {
        setPagesRefreshToken((token) => token + 1);
        setSelectedPageId(page.id);
      })
      .catch((error: unknown) => {
        console.error("Failed to create page.", error);
      });
  }, [client, openNotebookId, selectedSectionId]);

  /**
   * Trashes the most specific current selection (page > section > notebook)
   * — mirrors the priority TreeView selection state already implies.
   */
  const handleDeleteSelected = useCallback(() => {
    if (selectedPageId) {
      if (!openNotebookId || !selectedSectionId) return;
      client
        .trashPage({ notebookId: openNotebookId, sectionId: selectedSectionId, pageId: selectedPageId })
        .then(() => {
          setSelectedPageId(null);
          setPagesRefreshToken((token) => token + 1);
          setTreeRefreshToken((token) => token + 1);
          setTrashRefreshToken((token) => token + 1);
        })
        .catch((error: unknown) => {
          console.error("Failed to trash page.", error);
        });
    } else if (selectedSectionId) {
      if (!openNotebookId) return;
      client
        .trashSection({ notebookId: openNotebookId, sectionId: selectedSectionId })
        .then(() => {
          setSelectedSectionId(null);
          setSelectedPageId(null);
          setTreeRefreshToken((token) => token + 1);
          setTrashRefreshToken((token) => token + 1);
        })
        .catch((error: unknown) => {
          console.error("Failed to trash section.", error);
        });
    } else if (openNotebookId) {
      client
        .trashNotebook({ notebookId: openNotebookId })
        .then(() => {
          setOpenNotebookId(null);
          setSelectedSectionId(null);
          setSelectedPageId(null);
          setTreeRefreshToken((token) => token + 1);
          setTrashRefreshToken((token) => token + 1);
          setNotebooksRefreshToken((token) => token + 1);
        })
        .catch((error: unknown) => {
          console.error("Failed to trash notebook.", error);
        });
    }
  }, [client, openNotebookId, selectedSectionId, selectedPageId]);

  const handleBackupNotebook = useCallback(() => {
    if (!openNotebookId) return;
    const notebook = notebooks.find((n) => n.id === openNotebookId);
    client
      .exportNotebookBackup({ notebookId: openNotebookId })
      .then((blob) => downloadBlob(blob, suggestedBackupFileName(notebook?.name ?? "notebook")))
      .catch((error: unknown) => {
        console.error("Failed to back up notebook.", error);
      });
  }, [client, openNotebookId, notebooks]);

  const handleRestoreNotebookBackup = useCallback(() => {
    pickFile(".json,application/json")
      .then(async (file) => {
        if (!file) return; // user cancelled
        await client.importNotebookBackup({ file });
        setNotebooksRefreshToken((token) => token + 1);
      })
      .catch((error: unknown) => {
        console.error("Failed to restore notebook from backup.", error);
        window.alert(error instanceof Error ? error.message : String(error));
      });
  }, [client]);

  const handleTrashRestore = useCallback(
    (entryId: string) => {
      client
        .restoreFromTrash({ entryId })
        .then(() => {
          // Bump every refresh token unconditionally rather than branching on
          // the restored entry's kind — a restored page needs pagesRefreshToken
          // too (the pages effect doesn't re-fetch on tree/notebook changes),
          // and unconditional bumps are simpler and still correct for the
          // other kinds.
          setTrashRefreshToken((token) => token + 1);
          setTreeRefreshToken((token) => token + 1);
          setNotebooksRefreshToken((token) => token + 1);
          setPagesRefreshToken((token) => token + 1);
        })
        .catch((error: unknown) => {
          console.error("Failed to restore trash entry.", error);
        });
    },
    [client],
  );

  const handleTrashEmptyEntry = useCallback(
    (entryId: string) => {
      client
        .emptyTrashEntry({ entryId })
        .then(() => {
          setTrashRefreshToken((token) => token + 1);
        })
        .catch((error: unknown) => {
          console.error("Failed to empty trash entry.", error);
        });
    },
    [client],
  );

  const handleTrashEmptyAll = useCallback(() => {
    client
      .emptyTrash()
      .then(() => {
        setTrashRefreshToken((token) => token + 1);
      })
      .catch((error: unknown) => {
        console.error("Failed to empty trash.", error);
      });
  }, [client]);

  // --- Autosave --------------------------------------------------------------
  // Fired by PageEditorView after each debounced automatic save resolves — see that
  // component's `onSaved` prop doc comment. Autosave itself is timer-driven (see the
  // `setInterval` effect above), not tied to this callback.
  const handlePageSaved = useCallback(() => {
    setBacklinksRefreshToken((token) => token + 1);
    // Tag assignments live in saved object data exactly like wikilinks do, and the Tags panel's
    // per-tag note counts are derived from a tag-filtered search (see `tagCounts`' effect, keyed
    // on `pagesRefreshToken`) — so without this a paragraph tag applied on this page, whether by
    // the tag picker or the "Insert Tag" button, leaves the panel showing a stale count until
    // some unrelated action happens to refetch pages.
    setPagesRefreshToken((token) => token + 1);
  }, []);

  // A page auto-created by the wikilink-autocomplete flow (see `PageEditorView`'s
  // `onLinkedPageCreated` doc comment) is invisible to `pages`/the tree until this refetches
  // them — the exact same "something changed outside PageEditorView's own state" reasoning
  // `handlePageSaved` above already follows for backlinks.
  const handleLinkedPageCreated = useCallback(() => {
    setPagesRefreshToken((token) => token + 1);
  }, []);

  const handleAutosaveRestore = useCallback(() => {
    if (!openNotebookId || !selectedSectionId || !selectedPageId) return;
    client
      .restoreAutosave({
        notebookId: openNotebookId,
        sectionId: selectedSectionId,
        pageId: selectedPageId,
      })
      .then(() => {
        setAutosaveRefreshToken((token) => token + 1);
        setPagesRefreshToken((token) => token + 1);
        // Forces PageEditorView to remount and reload the page's now-restored content — see
        // that component's `reloadToken` prop doc comment for why nothing else notices this.
        setPageReloadToken((token) => token + 1);
      })
      .catch((error: unknown) => {
        console.error("Failed to restore autosave.", error);
      });
  }, [client, openNotebookId, selectedSectionId, selectedPageId]);

  // --- Canvas engine handle + toolbar/history sync --------------------------
  const [engine, setEngine] = useState<PageEngine | null>(null);
  const [activeToolId, setActiveToolId] = useState<string>("select");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyPointer, setHistoryPointer] = useState(-1);
  const [contentBounds, setContentBounds] = useState<Bounds | null>(null);
  const [viewportRect, setViewportRect] = useState<Bounds>({ x: 0, y: 0, width: 0, height: 0 });

  const handleEngineReady = useCallback((nextEngine: PageEngine) => {
    setEngine(nextEngine);
    setActiveToolId(nextEngine.tools.active?.id ?? "select");
  }, []);

  const handleEngineDispose = useCallback(() => {
    setEngine(null);
  }, []);

  useEffect(() => {
    if (!engine) {
      setCanUndo(false);
      setCanRedo(false);
      setHistoryEntries([]);
      setHistoryPointer(-1);
      return;
    }
    const syncFromEngine = () => {
      setCanUndo(engine.commands.canUndo);
      setCanRedo(engine.commands.canRedo);
      setHistoryEntries(engine.commands.history.map((command) => ({ id: command.id, label: command.label })));
      setHistoryPointer(engine.commands.pointerIndex);
    };
    syncFromEngine();
    return engine.commands.events.on("changed", syncFromEngine);
  }, [engine]);

  // --- Quick capture (Phase 11.2) --------------------------------------------
  /** The page id a just-created Quick Capture page is waiting to seed its starter text box into
   *  — never explicitly cleared (see the effect below for why). A ref, not state: the effect
   *  must see this synchronously the moment `engine`/`selectedPageId` line up, not a render later. */
  const quickCaptureTargetRef = useRef<string | null>(null);

  useEffect(() => {
    if (!engine || !selectedPageId || selectedPageId !== quickCaptureTargetRef.current) return;
    // Guards on the SCENE being empty rather than clearing the ref after one run: StrictMode's
    // dev-only double-invoke of effects mounts this page's engine twice in a row (mount, dispose,
    // remount) for the exact same `[engine, selectedPageId]` transition, and only the SECOND
    // (surviving) engine matters — an eagerly-cleared "already ran" ref would seed the FIRST,
    // soon-to-be-disposed engine and then skip the second, leaving the real page never seeded.
    // Checking emptiness instead makes this correct no matter how many times a fresh engine
    // mounts for this page, and doubles as the guard against reseeding a page the user already
    // has content on if they navigate back to it later.
    if (engine.scene.all.length > 0) return;
    // Fixed near-origin placement, not `centeredBounds`: this fires right as a brand-new page's
    // engine mounts, before its first `ResizeObserver` callback has necessarily measured a real
    // viewport size — and a fresh page has nothing on it yet to avoid overlapping anyway.
    const bounds: Bounds = { x: 40, y: 40, width: SPAWNED_BOX_WIDTH, height: SPAWNED_BOX_HEIGHT };
    const objectId = createTextBox(engine, bounds);
    engine.events.emit("text-edit:begin", { objectId, worldBounds: bounds, rotation: 0 });
  }, [engine, selectedPageId]);

  /** Finds (or creates) a top-level "Quick Notes" section in the open notebook, then drops a
   *  fresh, dated page into it with the cursor already inside a starter text box (seeded by the
   *  effect above once that page's engine mounts) — the fast path for "capture this thought right
   *  now" without picking where it goes first. */
  const handleQuickCapture = useCallback(() => {
    if (!openNotebookId) return;
    const notebookId = openNotebookId;

    const captureInto = (sectionId: string) => {
      client
        .createPage({
          notebookId,
          sectionId,
          parentPageId: null,
          orderKey: newOrderKey(),
          title: `Quick Note ${new Date().toLocaleString()}`,
          background: { color: null, ruleLines: "none" },
          templateId: null,
        })
        .then((page: PageDto) => {
          quickCaptureTargetRef.current = page.id;
          setTreeRefreshToken((token) => token + 1);
          // Bumped even though selecting a different section already reloads `pages` on its
          // own: if the user was already IN Quick Notes when they hit the shortcut, that
          // selectedSectionId set above is a no-op re-render-wise, and this is what still
          // picks up the just-created page.
          setPagesRefreshToken((token) => token + 1);
          setSelectedSectionId(sectionId);
          setSelectedPageId(page.id);
        })
        .catch((error: unknown) => {
          console.error("Failed to quick-capture a note.", error);
        });
    };

    client
      .listSections({ notebookId, parentGroupId: null })
      .then((sections: SectionDto[]) => {
        const existing = sections.find((section) => section.name === QUICK_NOTES_SECTION_NAME);
        if (existing) {
          captureInto(existing.id);
          return;
        }
        return client
          .createSection({
            notebookId,
            parentGroupId: null,
            name: QUICK_NOTES_SECTION_NAME,
            color: null,
            orderKey: newOrderKey(),
          })
          .then((section: SectionDto) => captureInto(section.id));
      })
      .catch((error: unknown) => {
        console.error("Failed to quick-capture a note.", error);
      });
  }, [client, openNotebookId]);

  // --- Find in page (Phase 11.6) ---------------------------------------------
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findMatchIndex, setFindMatchIndex] = useState(0);

  // Scanned once per open/query change, not kept live against further edits while the bar stays
  // open — "a small find bar scanning loaded objects' text", not a live-updating index.
  // ponytail: re-scan on scene changes too (engine.scene.events) if stale matches during an open
  // find bar prove to matter in practice.
  const findMatches = useMemo(
    () => (engine && findBarOpen ? findMatchingObjects(engine.scene.all, findQuery) : []),
    [engine, findBarOpen, findQuery],
  );
  // `((n % len) + len) % len` rather than a plain `%`: JS's `%` keeps the sign of the dividend, so
  // a plain modulo would leave a negative index after stepping "previous" past the first match.
  const currentFindIndex =
    findMatches.length > 0
      ? ((findMatchIndex % findMatches.length) + findMatches.length) % findMatches.length
      : -1;

  useEffect(() => {
    if (!engine || currentFindIndex < 0) return;
    const object = findMatches[currentFindIndex];
    if (!object) return;
    engine.selection.set([object.id]);
    centerCameraOn(engine, transformedBounds(object.bounds, object.transform));
  }, [engine, findMatches, currentFindIndex]);

  const handleOpenFindBar = useCallback(() => {
    if (!engine) return;
    setFindMatchIndex(0);
    setFindBarOpen(true);
  }, [engine]);

  const handleCloseFindBar = useCallback(() => {
    setFindBarOpen(false);
    setFindQuery("");
    setFindMatchIndex(0);
  }, []);

  const handleFindQueryChange = useCallback((query: string) => {
    setFindQuery(query);
    setFindMatchIndex(0);
  }, []);

  const handleFindNext = useCallback(() => {
    setFindMatchIndex((index) => index + 1);
  }, []);

  const handleFindPrevious = useCallback(() => {
    setFindMatchIndex((index) => index - 1);
  }, []);

  // --- Minimap sync -----------------------------------------------------
  useEffect(() => {
    if (!engine) {
      setContentBounds(null);
      setViewportRect({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    const syncContentBounds = () => setContentBounds(unionBounds(engine.scene.all));
    const syncViewportRect = () => {
      const camera = engine.getCamera();
      const viewport = engine.getViewport();
      setViewportRect({
        x: camera.x,
        y: camera.y,
        width: viewport.width / camera.zoom,
        height: viewport.height / camera.zoom,
      });
    };
    syncContentBounds();
    syncViewportRect();
    const unsubscribers = [
      engine.scene.events.on("added", syncContentBounds),
      engine.scene.events.on("updated", syncContentBounds),
      engine.scene.events.on("removed", syncContentBounds),
      engine.events.on("camera-changed", syncViewportRect),
      engine.events.on("viewport-changed", syncViewportRect),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [engine]);

  const handleMinimapNavigate = useCallback(
    (worldX: number, worldY: number) => {
      if (!engine) return;
      const camera = engine.getCamera();
      const viewport = engine.getViewport();
      engine.setCamera(
        worldX - viewport.width / (2 * camera.zoom),
        worldY - viewport.height / (2 * camera.zoom),
        camera.zoom,
      );
    },
    [engine],
  );

  // --- Tool color/width settings ---------------------------------------
  // Owned here (not inside PageEditorView) and passed down as a stable instance so a
  // user-chosen pen color survives navigating to a different page — see
  // PageEditorView.tsx's `inkSettings` prop doc comment for why the engine itself can't own
  // this across page switches.
  const inkSettingsRef = useRef<InkSettingsRegistry | null>(null);
  if (!inkSettingsRef.current) inkSettingsRef.current = new InkSettingsRegistry();

  const [activeToolSettings, setActiveToolSettings] = useState<{ color: string; width: number } | null>(null);

  useEffect(() => {
    if (!engine) {
      setActiveToolSettings(null);
      return;
    }
    const sync = () => setActiveToolSettings(engine.inkSettings.get(activeToolId) ?? null);
    sync();
    return engine.inkSettings.events.on("changed", (payload) => {
      if (payload.toolId === activeToolId) sync();
    });
  }, [engine, activeToolId]);

  const handleToolColorChange = useCallback(
    (color: string) => {
      engine?.inkSettings.setColor(activeToolId, color);
    },
    [engine, activeToolId],
  );

  const handleToolWidthChange = useCallback(
    (width: number) => {
      engine?.inkSettings.setWidth(activeToolId, width);
    },
    [engine, activeToolId],
  );

  const activateTool = useCallback(
    (toolId: string) => {
      if (!engine) return;
      engine.tools.activate(toolId);
      setActiveToolId(toolId);
    },
    [engine],
  );

  // --- Page background (Phase 5.10) ----------------------------------------
  const currentPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? null,
    [pages, selectedPageId],
  );

  /** "A template is just a page you copy" (Phase 11.1): duplicating IS applying a template, with
   *  the source page as the template. `templateId` doubles as "copy from this page" on the backend
   *  — `create_page` reads the source's own objects/background when it's set, so passing
   *  `currentPage.background` here is only for the (unreachable in this path) non-template shape
   *  the DTO still requires. Reusing `currentPage.title` lets `free_page_title`'s existing
   *  dedup-by-suffix do the "Copy"/" 2" naming for free. */
  const handleDuplicatePage = useCallback(() => {
    if (!openNotebookId || !selectedSectionId || !currentPage) return;
    client
      .createPage({
        notebookId: openNotebookId,
        sectionId: selectedSectionId,
        parentPageId: currentPage.parentPageId,
        orderKey: newOrderKey(),
        title: currentPage.title,
        background: currentPage.background,
        templateId: currentPage.id,
      })
      .then((page: PageDto) => {
        setPagesRefreshToken((token) => token + 1);
        setSelectedPageId(page.id);
      })
      .catch((error: unknown) => {
        console.error("Failed to duplicate page.", error);
      });
  }, [client, openNotebookId, selectedSectionId, currentPage]);

  // --- Subpages (Phase 11.4) --------------------------------------------------
  /** Creates a new page nested directly under the current selection — subpage nesting is pure
   *  `parentPageId`/`orderKey` metadata (see `renote_storage`'s module docs), not a different
   *  section, so this is `handleNewPage` with one extra field. */
  const handleNewSubpage = useCallback(() => {
    if (!openNotebookId || !selectedSectionId || !selectedPageId) return;
    client
      .createPage({
        notebookId: openNotebookId,
        sectionId: selectedSectionId,
        parentPageId: selectedPageId,
        orderKey: newOrderKey(),
        title: "Untitled page",
        background: { color: null, ruleLines: "none" },
        templateId: null,
      })
      .then((page: PageDto) => {
        setPagesRefreshToken((token) => token + 1);
        setSelectedPageId(page.id);
      })
      .catch((error: unknown) => {
        console.error("Failed to create subpage.", error);
      });
  }, [client, openNotebookId, selectedSectionId, selectedPageId]);

  /** Nests the selected page under its immediately preceding sibling (same `parentPageId`, next
   *  lowest `orderKey` — `pages` is already sorted that way, see `listPages`'s doc comment). A
   *  no-op when there's no preceding sibling to indent under (already first in its group). */
  const handleIndentPage = useCallback(() => {
    if (!openNotebookId || !selectedSectionId || !currentPage) return;
    const siblings = pages.filter((page) => page.parentPageId === currentPage.parentPageId);
    const index = siblings.findIndex((page) => page.id === currentPage.id);
    const precedingSibling = index > 0 ? siblings[index - 1] : undefined;
    if (!precedingSibling) return;
    client
      .setPageParent({
        notebookId: openNotebookId,
        sectionId: selectedSectionId,
        pageId: currentPage.id,
        parentPageId: precedingSibling.id,
      })
      .then(() => setPagesRefreshToken((token) => token + 1))
      .catch((error: unknown) => {
        console.error("Failed to indent page.", error);
      });
  }, [client, openNotebookId, selectedSectionId, currentPage, pages]);

  /** Promotes the selected page to be a sibling of its current parent, one level shallower. A
   *  no-op on an already-top-level page (nothing to outdent from). */
  const handleOutdentPage = useCallback(() => {
    if (!openNotebookId || !selectedSectionId || !currentPage?.parentPageId) return;
    const parent = pages.find((page) => page.id === currentPage.parentPageId);
    client
      .setPageParent({
        notebookId: openNotebookId,
        sectionId: selectedSectionId,
        pageId: currentPage.id,
        parentPageId: parent?.parentPageId ?? null,
      })
      .then(() => setPagesRefreshToken((token) => token + 1))
      .catch((error: unknown) => {
        console.error("Failed to outdent page.", error);
      });
  }, [client, openNotebookId, selectedSectionId, currentPage, pages]);

  const handleBackgroundChange = useCallback(
    (background: PageBackgroundValue) => {
      if (!openNotebookId || !selectedSectionId || !selectedPageId) return;
      const notebookId = openNotebookId;
      const sectionId = selectedSectionId;
      const pageId = selectedPageId;

      // Immediate feedback: apply straight to the live engine before the round trip resolves —
      // `PageEditorView` already holds this exact engine reference, so no new plumbing is
      // needed. Also re-runs the same auto black/white ink-switch logic PageEditorView's
      // page-load effect runs (see `applyAutoInkColorForBackground`'s doc comment) so a tool
      // still at its default color reacts to the new paper color immediately too.
      if (engine) {
        engine.setPageBackground(background);
        applyAutoInkColorForBackground(engine, background);
      }

      client
        .updatePageBackground({ notebookId, sectionId, pageId, background })
        .then((page) => {
          setPageRevision({ pageId, modifiedAt: page.modifiedAt });
          setPagesRefreshToken((token) => token + 1);
        })
        .catch((error: unknown) => {
          console.error("Failed to update page background.", error);
        });
    },
    [client, engine, openNotebookId, selectedSectionId, selectedPageId],
  );

  // A tool that could create or edit content is disabled until a real page is open — see
  // `selectedPageId`'s cascading-auto-select effects above/below: without this guard, the
  // engine (always mounted, even with no page selected — see PageEditorView) would happily let
  // a user draw/type into a page that has nowhere to be saved, silently discarding the work the
  // instant they navigate away. "select" is harmless with nothing to select, but disabling it
  // too keeps this one rule simple rather than special-casing it.
  const toolItem = useCallback(
    (toolId: string): ToolbarItem => ({
      id: toolId,
      label: TOOL_LABELS[toolId] ?? toolId,
      icon: TOOL_ICONS[toolId],
      active: activeToolId === toolId,
      disabled: !engine || !selectedPageId,
      onClick: () => activateTool(toolId),
    }),
    [activeToolId, activateTool, engine, selectedPageId],
  );

  // --- Insert Image (Phase 5.9) --------------------------------------------
  // File picker -> save the bytes as a page asset (dimensions probed there) -> commit a real,
  // undoable "image" object.
  const handleInsertImage = useCallback(() => {
    if (!engine || !openNotebookId || !selectedSectionId || !selectedPageId) return;
    const notebookId = openNotebookId;
    const sectionId = selectedSectionId;
    const pageId = selectedPageId;

    pickFile("image/png,image/jpeg,image/gif,image/webp")
      .then(async (file) => {
        if (!file) return; // user cancelled the picker
        const assetRef = await client.saveImageAsset({ notebookId, sectionId, pageId, file });
        const { naturalWidth, naturalHeight } = assetRef;

        // Center the inserted image in the current viewport, scaled DOWN (never up) so an
        // oversized photo doesn't blow past the visible canvas on insert.
        const camera = engine.getCamera();
        const viewport = engine.getViewport();
        const maxWidth = viewport.width > 0 ? (viewport.width * 0.6) / camera.zoom : naturalWidth;
        const scale = naturalWidth > 0 ? Math.min(1, maxWidth / naturalWidth) : 1;
        const width = naturalWidth * scale;
        const height = naturalHeight * scale;
        const centerX = camera.x + viewport.width / (2 * camera.zoom);
        const centerY = camera.y + viewport.height / (2 * camera.zoom);
        const bounds: Bounds = { x: centerX - width / 2, y: centerY - height / 2, width, height };

        createImageObject(engine, bounds, {
          assetPath: assetRef.assetPath,
          naturalWidth,
          naturalHeight,
          cropRect: null,
        });
      })
      .catch((error: unknown) => {
        console.error("Failed to insert image.", error);
      });
  }, [engine, client, openNotebookId, selectedSectionId, selectedPageId]);

  // --- Insert Tag / Insert Link --------------------------------------------
  /** How many spawns deep the cascade below currently is. A ref, not state: nothing renders from
   *  it, and it must not re-run any effect. */
  const spawnCascadeRef = useRef(0);

  /** Page-space bounds for a `width`x`height` object dropped into the middle of whatever the
   *  user is currently looking at — the same centering `handleInsertImage` above and
   *  `handleImportPlainTextFile` below already do inline for their own (differently-sized)
   *  objects. */
  const centeredBounds = useCallback(
    (width: number, height: number): Bounds | null => {
      if (!engine) return null;
      const camera = engine.getCamera();
      const viewport = engine.getViewport();
      // Cascaded like stacked windows rather than dead-centered every time: two spawns in a row
      // would otherwise land on the exact same spot, and the second would completely hide the
      // first with nothing on screen hinting that two objects are there. Wraps back to zero so a
      // long spawning session can't walk off the visible page.
      const step = (spawnCascadeRef.current = (spawnCascadeRef.current + 1) % SPAWN_CASCADE_STEPS);
      const offset = step * SPAWN_CASCADE_OFFSET;
      return {
        x: camera.x + viewport.width / (2 * camera.zoom) - width / 2 + offset,
        y: camera.y + viewport.height / (2 * camera.zoom) - height / 2 + offset,
        width,
        height,
      };
    },
    [engine],
  );

  // --- Record Audio (Phase 12) ----------------------------------------------
  // `MediaRecorder` capture (Opus/AAC, whatever the browser supports). Recorder/stream live in
  // refs, not state:
  // nothing about them needs to trigger a render, only `isRecording` and the elapsed-seconds tick
  // below do.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0);
  // Set on the first capture-start failure from either backend (no input device, permission
  // denied, ...) so the toolbar/palette can stop offering a feature that's already demonstrated
  // it won't work here, instead of inviting a repeat dead-end click — see the Toolbar wiring
  // below for how this disables the button and changes its label.
  const [recordingUnavailable, setRecordingUnavailable] = useState(false);

  useEffect(() => {
    if (!isRecording) return;
    const intervalId = window.setInterval(() => {
      setRecordingElapsedSeconds((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [isRecording]);

  const handleRecordAudio = useCallback(() => {
    if (!engine || !openNotebookId || !selectedSectionId || !selectedPageId || isRecording) return;

    navigator.mediaDevices
      // Explicitly OFF, not just omitted: a plain `{ audio: true }` request still lets the
      // WebView apply its own default audio-processing constraints (echo cancellation, noise
      // suppression, auto gain) before MediaRecorder ever sees the track, an extra processing
      // stage worth skipping regardless of platform.
      .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then((stream) => {
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/mp4";
        const recorder = new MediaRecorder(stream, { mimeType });
        recordingChunksRef.current = [];
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data.size > 0) recordingChunksRef.current.push(event.data);
        });
        recordingStreamRef.current = stream;
        mediaRecorderRef.current = recorder;
        recorder.start(5000);
        setRecordingElapsedSeconds(0);
        setIsRecording(true);
      })
      .catch((error: unknown) => {
        console.error("Failed to start audio recording.", error);
        setRecordingUnavailable(true);
      });
  }, [engine, openNotebookId, selectedSectionId, selectedPageId, isRecording]);

  /** Stops the in-progress recording and, if anything was captured, saves it as a new
   *  "audio-clip" object centered in the viewport — the same "save asset, then insert" split
   *  `handleInsertImage` uses. A recording cancelled before any data arrived leaves no object
   *  behind, matching the plan's "no page object exists until the recording succeeds" design. */
  const handleStopRecording = useCallback(() => {
    const notebookId = openNotebookId;
    const sectionId = selectedSectionId;
    const pageId = selectedPageId;
    const durationSeconds = recordingElapsedSeconds;
    setIsRecording(false);

    // Always stops every track in `finally`-like fashion (both the success and no-op exit paths
    // below release the mic) — leaving it hot is the classic bug this guards against.
    const recorder = mediaRecorderRef.current;
    const stream = recordingStreamRef.current;
    mediaRecorderRef.current = null;
    recordingStreamRef.current = null;

    if (!recorder || !engine || !notebookId || !sectionId || !pageId) {
      stream?.getTracks().forEach((track) => track.stop());
      return;
    }

    recorder.addEventListener(
      "stop",
      () => {
        stream?.getTracks().forEach((track) => track.stop());
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType });
        recordingChunksRef.current = [];
        if (blob.size === 0) {
          // Some browser/OS combinations report a live track that never yields encoded bytes.
          // Logged (and marks the feature unavailable) rather than silently doing nothing.
          console.error(
            "Recording produced no audio data (0 bytes). This WebView's MediaRecorder/microphone " +
              "capture pipeline isn't producing output. No audio-clip object was created.",
          );
          setRecordingUnavailable(true);
          return;
        }

        blob
          .arrayBuffer()
          .then((buffer) => {
            const extension = recorder.mimeType.includes("mp4") ? "m4a" : "webm";
            return client.saveAudioAsset(
              { notebookId, sectionId, pageId, fileName: `recording-${Date.now()}.${extension}` },
              new Uint8Array(buffer),
            );
          })
          .then((assetPath) => {
            const bounds = centeredBounds(AUDIO_CLIP_WIDTH, AUDIO_CLIP_HEIGHT);
            if (!bounds) return;
            createAudioClipObject(engine, bounds, { assetPath, durationSeconds });
          })
          .catch((error: unknown) => {
            console.error("Failed to save the recorded audio clip.", error);
          });
      },
      { once: true },
    );
    recorder.stop();
  }, [
    engine,
    client,
    openNotebookId,
    selectedSectionId,
    selectedPageId,
    recordingElapsedSeconds,
    centeredBounds,
  ]);

  /** Spawns a tag object for the tag currently selected in the Tags panel, falling back to the
   *  notebook's first tag when none is selected. Deliberately NOT a new object type: it's an
   *  ordinary text box whose single paragraph carries the tag (see `tagBoxContent`), so it stays
   *  editable, searchable, undoable, and counted in the Tags panel with no new renderer,
   *  hit-test, tool, or persisted schema of its own. */
  const handleInsertTag = useCallback(() => {
    const tag = tags.find((candidate) => candidate.id === selectedTagId) ?? tags[0];
    const bounds = centeredBounds(SPAWNED_BOX_WIDTH, SPAWNED_BOX_HEIGHT);
    if (!engine || !tag || !bounds) return;
    createTextBox(engine, bounds, tagBoxContent(tag));
  }, [engine, tags, selectedTagId, centeredBounds]);

  /** Spawns a "link-button" object — a navigation button that holds a target and nothing else,
   *  not a text box — and opens the target picker over it (see `PageEditorView`'s link picker,
   *  driven by the "link-edit:begin" event). Wikilinks typed inside a text box are untouched by
   *  this: they remain ordinary text marks. */
  const handleInsertLink = useCallback(() => {
    const bounds = centeredBounds(LINK_BUTTON_WIDTH, LINK_BUTTON_HEIGHT);
    if (!engine || !bounds) return;
    const objectId = createLinkButton(engine, bounds);
    engine.events.emit("link-edit:begin", { objectId, worldBounds: bounds });
  }, [engine, centeredBounds]);

  // --- Clipboard (Phase 8.1) ------------------------------------------------
  // Mirrors the canvas selection as a plain boolean, purely so the command palette can hide the
  // selection-dependent clipboard entries. The selection itself stays owned by the engine — this
  // is the same "engine event -> React state" sync the undo/redo flags above already do.
  const [hasSelectedObjects, setHasSelectedObjects] = useState(false);

  useEffect(() => {
    if (!engine) {
      setHasSelectedObjects(false);
      return;
    }
    setHasSelectedObjects(engine.selection.selectedIds.length > 0);
    return engine.selection.events.on("changed", (ids) => setHasSelectedObjects(ids.length > 0));
  }, [engine]);

  /** The selected objects, live from the scene — the selection manager holds ids only. */
  const selectedObjects = useCallback((): PageObject[] => {
    if (!engine) return [];
    const objects: PageObject[] = [];
    for (const id of engine.selection.selectedIds) {
      const object = engine.scene.get(id);
      if (object) objects.push(object);
    }
    return objects;
  }, [engine]);

  const handleCopy = useCallback(() => {
    const objects = selectedObjects();
    if (objects.length === 0 || !openNotebookId || !selectedSectionId || !selectedPageId) return;
    const text = encodeObjects(objects, {
      notebookId: openNotebookId,
      sectionId: selectedSectionId,
      pageId: selectedPageId,
    });
    navigator.clipboard.writeText(text).catch((error: unknown) => {
      console.error("Failed to copy to the clipboard.", error);
    });
  }, [selectedObjects, openNotebookId, selectedSectionId, selectedPageId]);

  /** Deletes the selected OBJECTS (not the selected tree node — that's `handleDeleteSelected`).
   *  One composite command, so a multi-object delete is a single undo step. */
  const handleDeleteObjects = useCallback(() => {
    if (!engine) return;
    const objects = selectedObjects();
    if (objects.length === 0) return;
    engine.commands.execute(new CompositeCommand(objects.map((object) => new RemoveObjectCommand(object))));
    engine.selection.clear();
  }, [engine, selectedObjects]);

  const handleCut = useCallback(() => {
    handleCopy();
    handleDeleteObjects();
  }, [handleCopy, handleDeleteObjects]);

  const handleSelectAllObjects = useCallback(() => {
    if (!engine) return;
    engine.selection.set(Array.from(engine.scene.all, (object) => object.id));
  }, [engine]);

  /** Commits already-positioned new objects as one undoable step and selects them, so whatever
   *  just appeared is what the next drag or Delete acts on. */
  const commitNewObjects = useCallback(
    (objects: PageObject[]) => {
      if (!engine || objects.length === 0) return;
      engine.commands.execute(new CompositeCommand(objects.map((object) => new AddObjectCommand(object))));
      engine.selection.set(objects.map((object) => object.id));
    },
    [engine],
  );

  /**
   * Pastes `objects` centered on whatever the user is currently looking at. Copied coordinates are
   * deliberately not preserved: on another page they mean nothing, and after panning away they
   * would drop the paste somewhere off screen with no sign anything happened.
   */
  const addPastedObjects = useCallback(
    (objects: PageObject[]) => {
      if (!engine || objects.length === 0) return;
      const camera = engine.getCamera();
      const viewport = engine.getViewport();
      centerObjectsOn(objects, {
        x: camera.x + viewport.width / (2 * camera.zoom),
        y: camera.y + viewport.height / (2 * camera.zoom),
      });
      commitNewObjects(objects);
    },
    [engine, commitNewObjects],
  );

  /**
   * Copies every asset the pasted objects reference into the destination page and rewrites their
   * `assetPath`s, so a pasted image owns its own file (see `CopyPageAssetRequestDto`). A no-op
   * when pasting back onto the page the objects came from — the paths are already correct there,
   * and duplicating the file would just leave two copies of the same picture on disk.
   */
  const copyPastedAssets = useCallback(
    async (objects: PageObject[], source: ClipboardSource) => {
      if (!openNotebookId || !selectedSectionId || !selectedPageId) return;
      if (source.pageId === selectedPageId) return;
      const paths = assetPathsOf(objects);
      if (paths.length === 0) return;
      const remapped = new Map<string, string>();
      for (const sourceAssetPath of paths) {
        try {
          const assetPath = await client.copyPageAsset({
            sourceNotebookId: source.notebookId,
            sourceSectionId: source.sectionId,
            sourceAssetPath,
            notebookId: openNotebookId,
            sectionId: selectedSectionId,
            pageId: selectedPageId,
          });
          remapped.set(sourceAssetPath, assetPath);
        } catch (error: unknown) {
          // A missing source file (the original page was deleted, the workspace moved) shouldn't
          // sink the whole paste — that object just keeps pointing at the old path and renders as
          // a broken asset, exactly as it would have on its own page.
          console.error("Failed to copy a pasted asset.", error);
        }
      }
      remapAssetPaths(objects, remapped);
    },
    [client, openNotebookId, selectedSectionId, selectedPageId],
  );

  const handlePaste = useCallback(() => {
    if (!engine || !selectedPageId) return;
    navigator.clipboard
      .readText()
      .then(async (text) => {
        const envelope = decodeObjects(text);
        if (envelope) {
          const objects = withFreshIds(envelope.objects);
          await copyPastedAssets(objects, envelope.source);
          addPastedObjects(objects);
          return;
        }
        // Not ours: anything else on the clipboard that is text becomes a text box, the way
        // pasting into any note app works. Images are handled separately (see the plan's 8.1
        // spike note — `navigator.clipboard.read()` for image blobs is the unreliable part).
        const trimmed = text.trim();
        if (trimmed === "") return;
        const bounds = centeredBounds(SPAWNED_BOX_WIDTH, SPAWNED_BOX_HEIGHT);
        if (bounds) createTextBox(engine, bounds, plainTextContent(trimmed));
      })
      .catch((error: unknown) => {
        console.error("Failed to paste from the clipboard.", error);
      });
  }, [engine, selectedPageId, copyPastedAssets, addPastedObjects, centeredBounds]);

  /** Duplicate never touches the system clipboard, so it can't overwrite what the user copied.
   *  It also nudges rather than centering: the original is right there on screen, and the copy
   *  landing slightly down-right of it is what every canvas app does. */
  const handleDuplicate = useCallback(() => {
    const objects = selectedObjects();
    if (objects.length === 0) return;
    const copies = withFreshIds(objects);
    translateObjects(copies, SPAWN_CASCADE_OFFSET, SPAWN_CASCADE_OFFSET);
    commitNewObjects(copies);
  }, [selectedObjects, commitNewObjects]);

  // --- Move / reorder (Phase 8.3) -------------------------------------------
  /**
   * Handles a drag-and-drop in the notebook tree. Which gestures are legal is decided here rather
   * than in `TreeView`, which only reports "this row was dropped on that row, at that position":
   *
   * - a page dropped on a section moves into it, appended at the end;
   * - a page dropped between two pages of the OPEN section reorders it there (that is the only
   *   section whose page list is loaded, so it's the only one whose order can be computed);
   * - a section dropped on a section-group, or on the notebook, moves under it;
   * - a section-group dropped on another group, or on the notebook, moves under it.
   *
   * Anything else is ignored — a rejected drag simply leaves the tree as it was.
   */
  const handleMoveNode = useCallback(
    (sourceId: string, targetId: string, position: "before" | "after" | "inside") => {
      if (!openNotebookId) return;
      const notebookId = openNotebookId;
      const refresh = () => {
        setPagesRefreshToken((token) => token + 1);
        setTreeRefreshToken((token) => token + 1);
      };
      const report = (error: unknown) => {
        console.error("Failed to move that item.", error);
        refresh();
      };

      if (sourceId.startsWith("page:")) {
        const pageId = sourceId.slice("page:".length);
        if (!selectedSectionId) return;

        if (targetId.startsWith("section:")) {
          const targetSectionId = targetId.slice("section:".length);
          if (targetSectionId === selectedSectionId) return;
          client
            .movePage({
              notebookId,
              sectionId: selectedSectionId,
              pageId,
              targetNotebookId: notebookId,
              targetSectionId,
              orderKey: newOrderKey(),
            })
            .then(refresh)
            .catch(report);
          return;
        }

        if (!targetId.startsWith("page:") || position === "inside") return;
        const targetPageId = targetId.slice("page:".length);
        const order = pages.map((page) => page.id).filter((id) => id !== pageId);
        const targetIndex = order.indexOf(targetPageId);
        // Both pages have to be in the open section's loaded list for the new order to be known.
        if (targetIndex === -1 || !pages.some((page) => page.id === pageId)) return;
        order.splice(position === "before" ? targetIndex : targetIndex + 1, 0, pageId);
        client
          .reorderPages({ notebookId, sectionId: selectedSectionId, pageIds: order })
          .then(refresh)
          .catch(report);
        return;
      }

      const targetParentGroupId = targetId.startsWith("group:")
        ? targetId.slice("group:".length)
        : targetId.startsWith("notebook:")
          ? null
          : undefined;
      if (targetParentGroupId === undefined) return;

      if (sourceId.startsWith("section:")) {
        client
          .moveSection({ notebookId, id: sourceId.slice("section:".length), targetParentGroupId })
          .then(refresh)
          .catch(report);
      } else if (sourceId.startsWith("group:")) {
        client
          .moveSectionGroup({ notebookId, id: sourceId.slice("group:".length), targetParentGroupId })
          .then(refresh)
          .catch(report);
      }
    },
    [client, openNotebookId, selectedSectionId, pages],
  );

  // --- Context menus (Phase 8.2) --------------------------------------------
  /** Which surface was right-clicked, and where. Item ids are command ids straight out of
   *  `allCommands`, so a menu entry and its palette entry can never drift apart. */
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    commandIds: string[];
  } | null>(null);

  const handleCanvasContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      // The text editor's DOM overlay keeps the browser's own menu: right-clicking inside a text
      // box you're editing should offer spell-check suggestions and clipboard, not canvas actions.
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("[contenteditable='true']")) return;
      if (!engine || !selectedPageId) return;
      event.preventDefault();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        commandIds: [
          "edit:cut",
          "edit:copy",
          "edit:paste",
          "edit:duplicate",
          "edit:delete-objects",
          "object:bring-to-front",
          "object:send-to-back",
          "object:convert-to-shape",
          "object:straighten-stroke",
          "edit:select-all",
        ],
      });
    },
    [engine, selectedPageId],
  );

  /** Right-clicking a tree row makes it the current selection first — every command in the menu
   *  acts on "what's selected", so without this a menu opened on one row would delete another. */
  const handleTreeContextMenu = useCallback((id: string, x: number, y: number) => {
    let commandIds: string[];
    if (id.startsWith("page:")) {
      setSelectedPageId(id.slice("page:".length));
      commandIds = [
        "page:new",
        "page:duplicate",
        "page:new-subpage",
        "page:indent",
        "page:outdent",
        "page:export-pdf",
        "page:export-plain-text",
        "page:export-markdown",
        "page:trash",
      ];
    } else if (id.startsWith("section:")) {
      setSelectedSectionId(id.slice("section:".length));
      setSelectedPageId(null);
      commandIds = [
        "page:new",
        "section:new",
        "section:export-pdf",
        "section:export-markdown",
        "section:trash",
      ];
    } else if (id.startsWith("notebook:")) {
      setOpenNotebookId(id.slice("notebook:".length));
      setSelectedSectionId(null);
      setSelectedPageId(null);
      commandIds = [
        "section:new",
        "notebook:backup",
        "notebook:export-pdf",
        "notebook:export-markdown",
        "notebook:trash",
      ];
    } else {
      // A section group holds sections, and nothing else acts on one today.
      commandIds = ["section:new"];
    }
    setContextMenu({ x, y, commandIds });
  }, []);

  // --- Z-order (Phase 8.4) --------------------------------------------------
  /** Restacks the selection above or below everything else on the page. Relative order WITHIN the
   *  selection is preserved (sorted by current `zIndex`, then reassigned in sequence), so sending
   *  a group back doesn't shuffle its own layering. */
  const handleRestack = useCallback(
    (direction: "front" | "back") => {
      if (!engine) return;
      const objects = selectedObjects().sort((a, b) => a.transform.zIndex - b.transform.zIndex);
      if (objects.length === 0) return;
      let extreme = 0;
      for (const object of engine.scene.all) {
        extreme =
          direction === "front"
            ? Math.max(extreme, object.transform.zIndex)
            : Math.min(extreme, object.transform.zIndex);
      }
      engine.commands.execute(
        new CompositeCommand(
          objects.map((object, index) => {
            const zIndex = direction === "front" ? extreme + 1 + index : extreme - objects.length + index;
            return new UpdateObjectCommand(engine.scene, object.id, {
              ...object,
              transform: { ...object.transform, zIndex },
            });
          }),
        ),
      );
    },
    [engine, selectedObjects],
  );

  // --- Ink intelligence (Phase 10.3/10.4) ------------------------------------
  const selectedInkStrokes = useCallback(
    (): InkStrokeEngineObject[] =>
      selectedObjects().filter((object): object is InkStrokeEngineObject => object.type === "ink-stroke"),
    [selectedObjects],
  );

  /** "Convert to Shape": runs the same recognizer `PenTool`'s live toggle uses, applied after the
   *  fact. Strokes that don't recognize as a shape are left as ink; a mixed selection converts
   *  what it can as one undo step and leaves the rest untouched. */
  const handleConvertToShape = useCallback(() => {
    if (!engine) return;
    const strokes = selectedInkStrokes();
    if (strokes.length === 0) return;
    const commands: (RemoveObjectCommand | AddObjectCommand)[] = [];
    const nextSelection: PageObject["id"][] = [];
    for (const stroke of strokes) {
      const shape = convertInkStrokeToShape(stroke);
      if (!shape) continue;
      commands.push(new RemoveObjectCommand(stroke), new AddObjectCommand(shape));
      nextSelection.push(shape.id);
    }
    if (commands.length === 0) return;
    engine.commands.execute(new CompositeCommand(commands));
    engine.selection.set(nextSelection);
  }, [engine, selectedInkStrokes]);

  /** "Straighten Stroke": snaps each selected near-collinear stroke onto its chord. Strokes too
   *  curved to read as a line are left untouched, same "no-op on a mismatch" behavior as Convert. */
  const handleStraightenStroke = useCallback(() => {
    if (!engine) return;
    const strokes = selectedInkStrokes();
    if (strokes.length === 0) return;
    const commands = strokes
      .map((stroke) => {
        const straightened = straightenInkStroke(stroke);
        return straightened ? new UpdateObjectCommand(engine.scene, stroke.id, straightened) : null;
      })
      .filter((command): command is UpdateObjectCommand => command !== null);
    if (commands.length === 0) return;
    engine.commands.execute(new CompositeCommand(commands));
  }, [engine, selectedInkStrokes]);

  // --- Import/Export (Phase 6) ----------------------------------------------
  // File picker -> shape the text into a text-box object DTO -> commit a real, undoable
  // "text-box" object via `createTextBox`. Exports download a file; PDF goes through print.
  const handleImportPlainTextFile = useCallback(() => {
    if (!engine || !openNotebookId || !selectedSectionId || !selectedPageId) return;
    const notebookId = openNotebookId;
    const sectionId = selectedSectionId;
    const pageId = selectedPageId;

    pickFile(".txt,.md,text/plain,text/markdown")
      .then(async (file) => {
        if (!file) return; // user cancelled the picker
        const objectDto = await client.importPlainTextFile({ notebookId, sectionId, pageId, file });

        // Centered in the current viewport, same placement `handleInsertImage` uses — the
        // backend's own default bounds are just a placeholder (it has no viewport to center
        // against), so this always overrides them.
        const camera = engine.getCamera();
        const viewport = engine.getViewport();
        const width = objectDto.bounds.width;
        const height = objectDto.bounds.height;
        const centerX = camera.x + viewport.width / (2 * camera.zoom);
        const centerY = camera.y + viewport.height / (2 * camera.zoom);
        const bounds: Bounds = { x: centerX - width / 2, y: centerY - height / 2, width, height };

        createTextBox(engine, bounds, (objectDto.data as { content: unknown }).content);
      })
      .catch((error: unknown) => {
        console.error("Failed to import plain text file.", error);
      });
  }, [engine, client, openNotebookId, selectedSectionId, selectedPageId]);

  const handleExportPagePdf = useCallback(() => {
    if (!openNotebookId || !selectedSectionId || !selectedPageId) return;
    client
      .exportPagePdf({ notebookId: openNotebookId, sectionId: selectedSectionId, pageId: selectedPageId })
      .then(printHtml)
      .catch((error: unknown) => {
        console.error("Failed to export page as PDF.", error);
      });
  }, [client, openNotebookId, selectedSectionId, selectedPageId]);

  const handleExportPagePlainText = useCallback(() => {
    if (!openNotebookId || !selectedSectionId || !selectedPageId) return;
    const page = pages.find((p) => p.id === selectedPageId);
    client
      .exportPagePlainText({
        notebookId: openNotebookId,
        sectionId: selectedSectionId,
        pageId: selectedPageId,
      })
      .then((blob) => downloadBlob(blob, suggestedExportFileName(page?.title ?? "page", "txt")))
      .catch((error: unknown) => {
        console.error("Failed to export page as plain text.", error);
      });
  }, [client, openNotebookId, selectedSectionId, selectedPageId, pages]);

  const handleExportSectionPdf = useCallback(() => {
    if (!openNotebookId || !selectedSectionId) return;
    client
      .exportSectionPdf({ notebookId: openNotebookId, sectionId: selectedSectionId })
      .then(printHtml)
      .catch((error: unknown) => {
        console.error("Failed to export section as PDF.", error);
      });
  }, [client, openNotebookId, selectedSectionId]);

  const handleExportNotebookPdf = useCallback(() => {
    if (!openNotebookId) return;
    client
      .exportNotebookPdf({ notebookId: openNotebookId })
      .then(printHtml)
      .catch((error: unknown) => {
        console.error("Failed to export notebook as PDF.", error);
      });
  }, [client, openNotebookId]);

  const handleExportPageMarkdown = useCallback(() => {
    if (!openNotebookId || !selectedSectionId || !selectedPageId) return;
    const page = pages.find((p) => p.id === selectedPageId);
    client
      .exportPageMarkdown({
        notebookId: openNotebookId,
        sectionId: selectedSectionId,
        pageId: selectedPageId,
      })
      .then((blob) => downloadBlob(blob, suggestedExportFileName(page?.title ?? "page", "md")))
      .catch((error: unknown) => {
        console.error("Failed to export page as Markdown.", error);
      });
  }, [client, openNotebookId, selectedSectionId, selectedPageId, pages]);

  const handleExportSectionMarkdown = useCallback(() => {
    if (!openNotebookId || !selectedSectionId) return;
    client
      .exportSectionMarkdown({ notebookId: openNotebookId, sectionId: selectedSectionId })
      .then((blob) => downloadBlob(blob, suggestedExportFileName("section", "md")))
      .catch((error: unknown) => {
        console.error("Failed to export section as Markdown.", error);
      });
  }, [client, openNotebookId, selectedSectionId]);

  const handleExportNotebookMarkdown = useCallback(() => {
    if (!openNotebookId) return;
    const notebook = notebooks.find((n) => n.id === openNotebookId);
    client
      .exportNotebookMarkdown({ notebookId: openNotebookId })
      .then((blob) => downloadBlob(blob, suggestedExportFileName(notebook?.name ?? "notebook", "md")))
      .catch((error: unknown) => {
        console.error("Failed to export notebook as Markdown.", error);
      });
  }, [client, openNotebookId, notebooks]);

  const toolbarGroups: ToolbarGroup[] = [
    { items: SELECT_TOOL_IDS.map(toolItem) },
    { items: DRAW_TOOL_IDS.map(toolItem) },
    { items: SHAPE_TOOL_IDS.map(toolItem) },
    { items: TEXT_TOOL_IDS.map(toolItem) },
    {
      items: [
        {
          id: "insert-image",
          label: "Insert Image",
          icon: "▨",
          disabled: !engine || !openNotebookId || !selectedSectionId || !selectedPageId,
          onClick: handleInsertImage,
        },
        {
          id: "insert-tag",
          // Nothing to insert until the notebook actually has a tag — same "only offer it once
          // it can do something" gating the text-edit tag picker itself uses.
          label: "Insert Tag",
          icon: "#",
          disabled: !engine || !selectedPageId || tags.length === 0,
          onClick: handleInsertTag,
        },
        {
          id: "insert-link",
          label: "Insert Link",
          icon: "→",
          disabled: !engine || !selectedPageId,
          onClick: handleInsertLink,
        },
        {
          id: "record-audio",
          label: recordingUnavailable ? "Record Audio (unavailable)" : "Record Audio",
          icon: "●",
          disabled:
            !engine ||
            !openNotebookId ||
            !selectedSectionId ||
            !selectedPageId ||
            isRecording ||
            recordingUnavailable,
          onClick: handleRecordAudio,
        },
      ],
    },
    {
      items: [
        {
          id: "undo",
          label: "Undo",
          icon: "↺",
          disabled: !engine || !canUndo,
          onClick: () => engine?.commands.undo(),
        },
        {
          id: "redo",
          label: "Redo",
          icon: "↻",
          disabled: !engine || !canRedo,
          onClick: () => engine?.commands.redo(),
        },
      ],
    },
  ];

  // --- Command palette + keyboard shortcuts --------------------------------
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [focusMode, setFocusMode] = useState(false);

  const allCommands = useMemo<AppCommand[]>(() => {
    const toolCommands: AppCommand[] = ALL_TOOL_IDS.map((toolId, index) => ({
      id: `tool:${toolId}`,
      label: TOOL_LABELS[toolId] ?? toolId,
      defaultShortcut: TOOL_SHORTCUT_KEYS[index] ?? null,
      handler: () => activateTool(toolId),
    }));

    return [
      ...toolCommands,
      {
        id: "edit:undo",
        label: "Undo",
        defaultShortcut: "Mod+Z",
        handler: () => {
          engine?.commands.undo();
        },
      },
      {
        id: "edit:redo",
        label: "Redo",
        defaultShortcut: "Mod+Shift+Z",
        handler: () => {
          engine?.commands.redo();
        },
      },
      { id: "edit:cut", label: "Cut", defaultShortcut: "Mod+X", handler: handleCut },
      { id: "edit:copy", label: "Copy", defaultShortcut: "Mod+C", handler: handleCopy },
      { id: "edit:paste", label: "Paste", defaultShortcut: "Mod+V", handler: handlePaste },
      { id: "edit:duplicate", label: "Duplicate", defaultShortcut: "Mod+D", handler: handleDuplicate },
      {
        id: "object:bring-to-front",
        label: "Bring to Front",
        defaultShortcut: null,
        handler: () => handleRestack("front"),
      },
      {
        id: "object:send-to-back",
        label: "Send to Back",
        defaultShortcut: null,
        handler: () => handleRestack("back"),
      },
      {
        id: "object:convert-to-shape",
        label: "Convert to Shape",
        defaultShortcut: null,
        handler: handleConvertToShape,
      },
      {
        id: "object:straighten-stroke",
        label: "Straighten Stroke",
        defaultShortcut: null,
        handler: handleStraightenStroke,
      },
      {
        id: "edit:select-all",
        label: "Select All Objects",
        defaultShortcut: "Mod+A",
        handler: handleSelectAllObjects,
      },
      {
        id: "edit:delete-objects",
        label: "Delete Selected Objects",
        defaultShortcut: "Delete",
        handler: handleDeleteObjects,
      },
      {
        id: "notebook:new",
        label: "New Notebook",
        defaultShortcut: null,
        handler: handleNewNotebook,
      },
      {
        id: "section:new",
        label: "New Section",
        defaultShortcut: null,
        handler: handleNewSection,
      },
      {
        id: "page:new",
        label: "New Page",
        defaultShortcut: null,
        handler: handleNewPage,
      },
      {
        id: "page:duplicate",
        label: "Duplicate Page",
        defaultShortcut: null,
        handler: handleDuplicatePage,
      },
      {
        id: "page:quick-capture",
        label: "Quick Capture",
        defaultShortcut: "Mod+Shift+N",
        handler: handleQuickCapture,
      },
      {
        id: "page:new-subpage",
        label: "New Subpage",
        defaultShortcut: null,
        handler: handleNewSubpage,
      },
      {
        id: "page:indent",
        label: "Indent Page",
        defaultShortcut: null,
        handler: handleIndentPage,
      },
      {
        id: "page:outdent",
        label: "Outdent Page",
        defaultShortcut: null,
        handler: handleOutdentPage,
      },
      {
        id: "notebook:trash",
        label: "Delete Notebook",
        defaultShortcut: null,
        handler: handleDeleteSelected,
      },
      {
        id: "section:trash",
        label: "Delete Section",
        defaultShortcut: null,
        handler: handleDeleteSelected,
      },
      {
        id: "page:trash",
        label: "Delete Page",
        defaultShortcut: null,
        handler: handleDeleteSelected,
      },
      {
        id: "notebook:backup",
        label: "Back Up Notebook...",
        defaultShortcut: null,
        handler: handleBackupNotebook,
      },
      {
        id: "notebook:restore-backup",
        label: "Restore Notebook from Backup...",
        defaultShortcut: null,
        handler: handleRestoreNotebookBackup,
      },
      {
        id: "page:insert-image",
        label: "Insert Image...",
        defaultShortcut: null,
        handler: handleInsertImage,
      },
      {
        id: "page:record-audio",
        label: "Record Audio",
        defaultShortcut: null,
        handler: handleRecordAudio,
      },
      {
        id: "page:import-plain-text",
        label: "Import Plain Text File...",
        defaultShortcut: null,
        handler: handleImportPlainTextFile,
      },
      {
        id: "page:export-pdf",
        label: "Export Page as PDF...",
        defaultShortcut: null,
        handler: handleExportPagePdf,
      },
      {
        id: "page:export-plain-text",
        label: "Export Page as Plain Text...",
        defaultShortcut: null,
        handler: handleExportPagePlainText,
      },
      {
        id: "section:export-pdf",
        label: "Export Section as PDF...",
        defaultShortcut: null,
        handler: handleExportSectionPdf,
      },
      {
        id: "notebook:export-pdf",
        label: "Export Notebook as PDF...",
        defaultShortcut: null,
        handler: handleExportNotebookPdf,
      },
      {
        id: "page:export-markdown",
        label: "Export Page as Markdown...",
        defaultShortcut: null,
        handler: handleExportPageMarkdown,
      },
      {
        id: "section:export-markdown",
        label: "Export Section as Markdown...",
        defaultShortcut: null,
        handler: handleExportSectionMarkdown,
      },
      {
        id: "notebook:export-markdown",
        label: "Export Notebook as Markdown...",
        defaultShortcut: null,
        handler: handleExportNotebookMarkdown,
      },
      {
        id: "page:edit-background",
        label: "Edit Page Background...",
        defaultShortcut: null,
        handler: () => setBackgroundPanelOpen(true),
      },
      {
        id: "view:command-palette",
        label: "Command Palette",
        defaultShortcut: "Mod+K",
        handler: () => {
          setPaletteQuery("");
          setPaletteOpen(true);
        },
      },
      {
        id: "view:find-in-page",
        label: "Find in Page",
        defaultShortcut: "Mod+F",
        handler: handleOpenFindBar,
      },
      {
        id: "view:toggle-focus-mode",
        label: "Toggle Focus Mode",
        defaultShortcut: "Mod+.",
        handler: () => setFocusMode((prev) => !prev),
      },
      {
        id: "view:toggle-graph-view",
        label: "Toggle Graph View",
        defaultShortcut: null,
        handler: () => setViewMode((prev) => (prev === "editor" ? "graph" : "editor")),
      },
      {
        id: "view:toggle-theme",
        label: "Toggle Theme",
        defaultShortcut: null,
        handler: toggleTheme,
      },
      {
        id: "help:open",
        label: "Help",
        defaultShortcut: "F1",
        handler: () => setHelpOpen(true),
      },
    ];
  }, [
    activateTool,
    engine,
    handleNewNotebook,
    handleNewSection,
    handleNewPage,
    handleDuplicatePage,
    handleQuickCapture,
    handleNewSubpage,
    handleIndentPage,
    handleOutdentPage,
    handleDeleteSelected,
    handleBackupNotebook,
    handleRestoreNotebookBackup,
    handleInsertImage,
    handleRecordAudio,
    handleImportPlainTextFile,
    handleExportPagePdf,
    handleExportPagePlainText,
    handleExportSectionPdf,
    handleExportNotebookPdf,
    handleExportPageMarkdown,
    handleExportSectionMarkdown,
    handleExportNotebookMarkdown,
    handleOpenFindBar,
    handleCut,
    handleCopy,
    handlePaste,
    handleDuplicate,
    handleSelectAllObjects,
    handleDeleteObjects,
    handleRestack,
    handleConvertToShape,
    handleStraightenStroke,
    toggleTheme,
  ]);

  const keymapRegistry = useMemo(() => new KeymapRegistry(allCommands), [allCommands]);

  /** Runs a command by id — the one dispatch path shared by the command palette and every
   *  context menu, so a menu entry can never do something different from its palette twin. */
  const runCommand = useCallback(
    (id: string) => {
      const command = allCommands.find((candidate) => candidate.id === id);
      void command?.handler();
    },
    [allCommands],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target as HTMLElement | null)?.isContentEditable
      ) {
        return;
      }
      const combo = keyboardEventToCombo(event);
      if (keymapRegistry.handleCombo(combo)) {
        event.preventDefault();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [keymapRegistry]);

  const paletteItems: CommandPaletteItem[] = useMemo(() => {
    const query = paletteQuery.trim().toLowerCase();
    return allCommands
      .filter((command) => {
        if (command.id.startsWith("tool:") && !engine) return false;
        if (command.id === "view:find-in-page" && !engine) return false;
        if (command.id === "edit:undo" && (!engine || !canUndo)) return false;
        if (command.id === "edit:redo" && (!engine || !canRedo)) return false;
        if (command.id === "section:new" && !openNotebookId) return false;
        if (command.id === "page:new" && (!openNotebookId || !selectedSectionId)) return false;
        // Clipboard: the three that act on a selection are hidden without one, so the palette
        // never offers "Copy" when there is nothing to copy. Paste only needs an open page —
        // what's on the clipboard can't be checked without reading it.
        if (SELECTION_COMMANDS.has(command.id) && !hasSelectedObjects) return false;
        if (
          (command.id === "edit:paste" || command.id === "edit:select-all") &&
          (!engine || !selectedPageId)
        ) {
          return false;
        }
        // Only the command matching what "delete the current selection" will
        // actually do is shown — same page > section > notebook priority as
        // handleDeleteSelected — so the palette never offers a label that
        // doesn't match the effect of choosing it.
        if (command.id === "page:trash" && !selectedPageId) return false;
        if (command.id === "section:trash" && (!selectedSectionId || selectedPageId)) return false;
        if (command.id === "notebook:trash" && (!openNotebookId || selectedSectionId || selectedPageId)) {
          return false;
        }
        if (command.id === "notebook:backup" && !openNotebookId) return false;
        if (command.id === "page:edit-background" && !selectedPageId) return false;
        if (
          command.id === "page:record-audio" &&
          (!engine || !openNotebookId || !selectedSectionId || !selectedPageId || recordingUnavailable)
        ) {
          return false;
        }
        // Import/export each need the scope its label promises actually selected: page-scoped
        // needs a selected page, section-scoped a selected section, notebook-scoped a notebook.
        if (command.id === "page:import-plain-text" && !selectedPageId) return false;
        if (command.id === "page:export-pdf" && !selectedPageId) return false;
        if (command.id === "page:export-plain-text" && !selectedPageId) return false;
        if (command.id === "section:export-pdf" && !selectedSectionId) return false;
        if (command.id === "notebook:export-pdf" && !openNotebookId) return false;
        if (command.id === "page:export-markdown" && !selectedPageId) return false;
        if (command.id === "section:export-markdown" && !selectedSectionId) return false;
        if (command.id === "notebook:export-markdown" && !openNotebookId) return false;
        return true;
      })
      .filter((command) => query === "" || command.label.toLowerCase().includes(query))
      .map((command) => ({ id: command.id, label: command.label, shortcut: command.defaultShortcut }));
  }, [
    allCommands,
    paletteQuery,
    engine,
    canUndo,
    canRedo,
    hasSelectedObjects,
    openNotebookId,
    selectedSectionId,
    selectedPageId,
    recordingUnavailable,
  ]);

  const handlePaletteExecute = useCallback(
    (id: string) => {
      runCommand(id);
      setPaletteOpen(false);
    },
    [runCommand],
  );

  /** Menu entries for the open menu: command ids resolved to their labels, with the
   *  selection-dependent ones greyed out rather than missing, so the menu's shape stays stable. */
  const contextMenuItems: ContextMenuItem[] = useMemo(() => {
    if (!contextMenu) return [];
    return contextMenu.commandIds.flatMap((id) => {
      const command = allCommands.find((candidate) => candidate.id === id);
      if (!command) return [];
      return [
        {
          id,
          label: command.label,
          disabled: SELECTION_COMMANDS.has(id) && !hasSelectedObjects,
          separatorBefore: CONTEXT_MENU_GROUP_STARTS.has(id),
        },
      ];
    });
  }, [contextMenu, allCommands, hasSelectedObjects]);

  // --- Search ----------------------------------------------------------------
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHitDto[]>([]);

  // A selected tag (clicked in TagSummaryPanel) narrows search alongside free-text `searchQuery`
  // — both combine into the same `tagIds`/`text` request below, rather than being two separate
  // search paths. `search`'s Rust side already treats "tag filter, no free text" as a legitimate
  // "browse every page carrying this tag" query (see renote-index's search.rs), so selecting a
  // tag with an empty search box still returns its pages.
  useEffect(() => {
    if (!searchQuery.trim() && !selectedTagId) {
      setSearchHits([]);
      return;
    }
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      client
        .search({
          text: searchQuery,
          notebookIds: null,
          sectionIds: null,
          tagIds: selectedTagId ? [selectedTagId] : null,
          modifiedAfter: null,
          modifiedBefore: null,
        })
        .then((result) => {
          if (!cancelled) setSearchHits(result.hits);
        })
        .catch((error: unknown) => {
          console.error("Failed to search.", error);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [client, searchQuery, selectedTagId]);

  const searchResults: SearchResultItem[] = useMemo(
    () => searchHits.map((hit) => ({ id: hit.pageId, title: hit.title, snippet: hit.snippet })),
    [searchHits],
  );

  const handleSearchSelect = useCallback(
    (id: string) => {
      const hit = searchHits.find((h) => h.pageId === id);
      if (!hit) return;
      setOpenNotebookId(hit.notebookId);
      setSelectedSectionId(hit.sectionId);
      setSelectedPageId(hit.pageId);
    },
    [searchHits],
  );

  // --- Tags --------------------------------------------------------------
  const tagSummaryEntries: TagSummaryEntry[] = useMemo(
    () =>
      tags.map((tag) => ({
        id: tag.id,
        kind: tag.kind as TagSummaryKind,
        label: tag.label,
        color: tag.color,
        noteCount: tagCounts[tag.id] ?? 0,
      })),
    [tags, tagCounts],
  );

  const handleSelectTag = useCallback((tagId: string) => {
    setSelectedTagId((prev) => (prev === tagId ? null : tagId));
    setSearchQuery("");
  }, []);

  const handleCreateTag = useCallback(
    (kind: TagSummaryKind, label: string, color: string) => {
      if (!openNotebookId) return;
      client
        .createTag({ notebookId: openNotebookId, kind, label, color })
        .then(() => setTagsRefreshToken((token) => token + 1))
        .catch((error: unknown) => {
          console.error("Failed to create tag.", error);
        });
    },
    [client, openNotebookId],
  );

  const handleRenameTag = useCallback(
    (tagId: string, label: string, color: string) => {
      if (!openNotebookId) return;
      client
        .updateTag({ notebookId: openNotebookId, tagId, label, color })
        .then(() => setTagsRefreshToken((token) => token + 1))
        .catch((error: unknown) => {
          console.error("Failed to update tag.", error);
        });
    },
    [client, openNotebookId],
  );

  const handleDeleteTag = useCallback(
    (tagId: string) => {
      if (!openNotebookId) return;
      client
        .deleteTag({ notebookId: openNotebookId, tagId })
        .then(() => {
          setTagsRefreshToken((token) => token + 1);
          setSelectedTagId((prev) => (prev === tagId ? null : prev));
          // The cascade-clear on the backend can touch paragraphs on the currently open page,
          // so a reload is needed for the editor to reflect the now-cleared tagId — same
          // refresh-token bump every other mutating action here already uses.
          setPagesRefreshToken((token) => token + 1);
        })
        .catch((error: unknown) => {
          console.error("Failed to delete tag.", error);
        });
    },
    [client, openNotebookId],
  );

  // --- To-do rollup (Phase 11.3) ----------------------------------------------
  const [taggedParagraphs, setTaggedParagraphs] = useState<TaggedParagraphDto[]>([]);

  useEffect(() => {
    if (!openNotebookId || !selectedTagId) {
      setTaggedParagraphs([]);
      return;
    }
    let cancelled = false;
    client
      .listTaggedParagraphs({ notebookId: openNotebookId, tagId: selectedTagId })
      .then((rows) => {
        if (!cancelled) setTaggedParagraphs(rows);
      })
      .catch((error: unknown) => {
        console.error("Failed to list tagged paragraphs.", error);
      });
    return () => {
      cancelled = true;
    };
  }, [client, openNotebookId, selectedTagId, pagesRefreshToken]);

  const taggedParagraphEntries: TaggedParagraphEntry[] = useMemo(
    () =>
      taggedParagraphs.map((row) => ({
        id: `${row.pageId}:${row.objectId}`,
        pageId: row.pageId,
        pageTitle: row.pageTitle,
        objectId: row.objectId,
        text: row.text,
      })),
    [taggedParagraphs],
  );

  const selectedTagLabel = useMemo(
    () => tags.find((tag) => tag.id === selectedTagId)?.label ?? "",
    [tags, selectedTagId],
  );

  /** Navigates to a tagged paragraph's page, wherever it lives — same local-then-`listPageLocations`
   *  fallback shape as `handleFollowLink` — then opens the find bar pre-filled with the
   *  paragraph's own text, which lands on and highlights it once that page's engine loads (reusing
   *  Phase 11.6's find-in-page machinery rather than a second, bespoke "wait for this page's
   *  objects to exist" mechanism). */
  const handleSelectTaggedParagraph = useCallback(
    (entry: TaggedParagraphEntry) => {
      const landOnIt = () => {
        setFindQuery(entry.text);
        setFindMatchIndex(0);
        setFindBarOpen(true);
      };
      const local = pages.find((page) => page.id === entry.pageId);
      if (local) {
        setSelectedSectionId(local.sectionId);
        setSelectedPageId(entry.pageId);
        landOnIt();
        return;
      }
      client
        .listPageLocations()
        .then((locations) => {
          const location = locations.find((candidate) => candidate.pageId === entry.pageId);
          if (!location) {
            console.warn("Could not locate the page this tagged paragraph belongs to.", entry);
            return;
          }
          setOpenNotebookId(location.notebookId);
          setSelectedSectionId(location.sectionId);
          setSelectedPageId(location.pageId);
          landOnIt();
        })
        .catch((error: unknown) => {
          console.error("Failed to navigate to a tagged paragraph.", error);
        });
    },
    [client, pages],
  );

  return (
    <div className="renote-app-shell">
      <header className="renote-title-bar">
        <span className="renote-title-bar-label">reNote</span>
        <div className="renote-title-bar-actions">
          <PixelButton
            type="button"
            onClick={() => setViewMode((prev) => (prev === "editor" ? "graph" : "editor"))}
          >
            {viewMode === "editor" ? "Graph View" : "Editor"}
          </PixelButton>
          <PixelButton type="button" onClick={() => setBackgroundPanelOpen(true)} disabled={!selectedPageId}>
            Page Background
          </PixelButton>
          <PixelButton type="button" onClick={() => setSettingsOpen(true)}>
            Settings
          </PixelButton>
          <PixelButton type="button" onClick={() => setHelpOpen(true)}>
            Help
          </PixelButton>
          <ThemeToggle mode={mode} onToggle={toggleTheme} />
        </div>
      </header>
      {viewMode === "graph" ? (
        <GraphView notebookId={openNotebookId} onNavigate={handleGraphNavigate} />
      ) : (
        <div className="renote-app-body">
          {!focusMode && (
            <aside className="renote-sidebar">
              <Panel title="Search">
                <SearchPanel
                  query={searchQuery}
                  results={searchResults}
                  onQueryChange={setSearchQuery}
                  onSelect={handleSearchSelect}
                />
              </Panel>
              <Panel title="Notebooks">
                <div className="renote-sidebar-actions">
                  <PixelButton type="button" onClick={handleNewNotebook}>
                    New Notebook
                  </PixelButton>
                  <PixelButton type="button" onClick={handleNewSection} disabled={!openNotebookId}>
                    New Section
                  </PixelButton>
                  <PixelButton type="button" onClick={handleNewPage} disabled={!selectedSectionId}>
                    New Page
                  </PixelButton>
                  <PixelButton type="button" onClick={handleDeleteSelected} disabled={!openNotebookId}>
                    Delete Selected
                  </PixelButton>
                </div>
                <TreeView
                  nodes={treeNodes}
                  onToggleExpand={handleToggleExpand}
                  onSelect={handleSelect}
                  onRename={handleRenameNode}
                  onContextMenu={handleTreeContextMenu}
                  onMoveNode={handleMoveNode}
                />
              </Panel>
              <TagSummaryPanel
                tags={tagSummaryEntries}
                onSelectTag={handleSelectTag}
                onCreateTag={handleCreateTag}
                onRenameTag={handleRenameTag}
                onDeleteTag={handleDeleteTag}
              />
              {selectedTagId && (
                <TaggedParagraphsPanel
                  tagLabel={selectedTagLabel}
                  entries={taggedParagraphEntries}
                  onSelect={handleSelectTaggedParagraph}
                />
              )}
              <TrashPanel
                entries={trashEntries}
                onRestore={handleTrashRestore}
                onEmptyEntry={handleTrashEmptyEntry}
                onEmptyAll={handleTrashEmptyAll}
              />
            </aside>
          )}
          <main className="renote-main" onContextMenu={handleCanvasContextMenu}>
            <Toolbar groups={toolbarGroups} />
            {!selectedPageId && (
              <div className="renote-empty-page-state">
                <p>
                  {openNotebookId
                    ? "Select or create a page to start taking notes."
                    : "Select or create a notebook to get started."}
                </p>
              </div>
            )}
            <PageEditorView
              notebookId={openNotebookId ?? undefined}
              sectionId={selectedSectionId ?? undefined}
              pageId={selectedPageId ?? undefined}
              pageTitle={currentPage?.title}
              onEngineReady={handleEngineReady}
              onEngineDispose={handleEngineDispose}
              onSaved={handlePageSaved}
              onLinkedPageCreated={handleLinkedPageCreated}
              inkSettings={inkSettingsRef.current}
              pointerSourceOverrides={pointerSourceOverridesRef.current}
              recognizeShapesRef={recognizeShapesRef}
              activeToolId={activeToolId}
              availableTags={tags}
              onFollowLink={handleFollowLink}
              pendingAnchor={pendingAnchor}
              reloadToken={pageReloadToken}
              pageRevision={pageRevision ?? undefined}
            />
          </main>
          {!focusMode && (
            <aside className="renote-history-sidebar">
              {TOOL_SETTINGS_CONFIG[activeToolId] && activeToolSettings && (
                <ToolSettingsPanel
                  toolLabel={TOOL_LABELS[activeToolId] ?? activeToolId}
                  color={TOOL_SETTINGS_CONFIG[activeToolId]!.hasColor ? activeToolSettings.color : null}
                  onColorChange={handleToolColorChange}
                  width={activeToolSettings.width}
                  minWidth={TOOL_SETTINGS_CONFIG[activeToolId]!.minWidth}
                  maxWidth={TOOL_SETTINGS_CONFIG[activeToolId]!.maxWidth}
                  onWidthChange={handleToolWidthChange}
                />
              )}
              <Minimap
                contentBounds={contentBounds}
                viewportRect={viewportRect}
                onNavigate={handleMinimapNavigate}
              />
              <HistoryPanel
                entries={historyEntries}
                pointerIndex={historyPointer}
                onJumpTo={(index) => engine?.commands.jumpTo(index)}
              />
              <AutosavePanel entry={autosaveEntry} onRestore={handleAutosaveRestore} />
              <BacklinksPanel entries={backlinkEntries} onSelect={handleBacklinkSelect} />
              <RelatedNotesPanel entries={relatedNoteEntries} onSelect={handleRelatedNoteSelect} />
            </aside>
          )}
        </div>
      )}
      <CommandPalette
        open={paletteOpen}
        query={paletteQuery}
        items={paletteItems}
        onQueryChange={setPaletteQuery}
        onExecute={handlePaletteExecute}
        onClose={() => setPaletteOpen(false)}
      />
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onSelect={runCommand}
          onClose={() => setContextMenu(null)}
        />
      )}
      {findBarOpen && (
        <FindBar
          query={findQuery}
          matchCount={findMatches.length}
          currentIndex={currentFindIndex}
          onQueryChange={handleFindQueryChange}
          onNext={handleFindNext}
          onPrevious={handleFindPrevious}
          onClose={handleCloseFindBar}
        />
      )}
      {isRecording && (
        <RecordingPanel elapsedSeconds={recordingElapsedSeconds} onStop={handleStopRecording} />
      )}
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        pointerSourceOverrides={pointerSourceOverrides}
        onPointerSourceOverrideChange={setPointerSourceOverride}
        autosaveIntervalSeconds={autosaveIntervalSeconds}
        onAutosaveIntervalSecondsChange={setAutosaveIntervalSeconds}
        recognizeShapes={recognizeShapes}
        onRecognizeShapesChange={setRecognizeShapes}
      />
      <PageBackgroundPanel
        open={backgroundPanelOpen}
        onClose={() => setBackgroundPanelOpen(false)}
        background={currentPage?.background ?? { color: null, ruleLines: "none" }}
        onChange={handleBackgroundChange}
      />
    </div>
  );
}
