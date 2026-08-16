import type { PageObject } from "@renote/core";
import { blockText, contentBlocks } from "../page-editor/page-anchors.js";
import type {
  AssetRefDto,
  AutosaveMetaDto,
  CopyPageAssetRequestDto,
  CreateLinkedPageRequestDto,
  CreateNotebookRequestDto,
  CreatePageRequestDto,
  CreateSectionGroupRequestDto,
  CreateSectionRequestDto,
  CreateTagRequestDto,
  DeletePageAssetRequestDto,
  DeleteTagRequestDto,
  EmptyTrashEntryRequestDto,
  ExportNotebookBackupRequestDto,
  ExportNotebookMarkdownRequestDto,
  ExportNotebookPdfRequestDto,
  ExportPageMarkdownRequestDto,
  ExportPagePdfRequestDto,
  ExportPagePlainTextRequestDto,
  ExportSectionMarkdownRequestDto,
  ExportSectionPdfRequestDto,
  GetAutosaveStatusRequestDto,
  ImportNotebookBackupRequestDto,
  ImportPlainTextRequestDto,
  ListBacklinksRequestDto,
  ListPageLinksRequestDto,
  ListPagesRequestDto,
  MovePageRequestDto,
  MoveSectionRequestDto,
  ListSectionsRequestDto,
  ListTaggedParagraphsRequestDto,
  ListTagsRequestDto,
  LoadPageObjectsRequestDto,
  NotebookDto,
  PageDocumentDto,
  PageDto,
  PageLinkDto,
  PageLocationDto,
  PageObjectDto,
  RenameNotebookRequestDto,
  RenamePageRequestDto,
  RenameSectionGroupRequestDto,
  RenameSectionRequestDto,
  ReorderPagesRequestDto,
  ResolveAssetPathRequestDto,
  ResolveWikilinkTargetRequestDto,
  RestoreAutosaveRequestDto,
  RestoreFromTrashRequestDto,
  SaveAudioAssetRequest,
  SaveAutosaveRequestDto,
  SaveImageAssetRequestDto,
  SavePageObjectsRequestDto,
  SearchHitDto,
  SearchQueryDto,
  SearchResultsDto,
  SectionDto,
  SectionGroupDto,
  SetPageParentRequestDto,
  SetWorkspacePathRequestDto,
  StorageClient,
  TagDto,
  TaggedParagraphDto,
  TrashEntryDto,
  TrashNotebookRequestDto,
  TrashPageRequestDto,
  TrashSectionGroupRequestDto,
  TrashSectionRequestDto,
  UpdatePageBackgroundRequestDto,
  UpdateTagRequestDto,
  WikilinkResolutionDto,
} from "@renote/storage-client";

/** One fake in-memory autosave slot for a page (see `autosaves` below). */
interface FakeAutosave {
  timestamp: string;
  doc: PageDocumentDto;
}

/** A genuinely valid, minimal 1x1 transparent PNG (67 bytes) — see `saveImageAsset`'s doc
 *  comment for why the fake stores real, decodable image bytes rather than arbitrary filler. */
const MINIMAL_VALID_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00,
  0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d,
  0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

/** Everything cascade-removed by trashing one item, stashed so restore can put it all back. */
interface TrashedBundle {
  notebook?: NotebookDto;
  sectionGroups: SectionGroupDto[];
  sections: SectionDto[];
  pages: PageDocumentDto[];
}

/**
 * An in-memory `StorageClient` for running `apps/desktop` outside a Tauri
 * WebView — a plain browser has no Tauri IPC for the real client's
 * `invoke()` calls to reach, so `StorageProvider` swaps this in whenever
 * `isTauri()` is false (see that file). Backed by nothing durable: state
 * lives only for the life of the page and resets on reload. Seeded with one
 * sample notebook/section/page so navigation UI has something to render
 * when driven by the `run-desktop` skill or a local `pnpm dev` in a browser.
 */
export function createFakeStorageClient(): StorageClient {
  let counter = 0;
  const newId = (prefix: string) => `${prefix}-${++counter}`;
  const newOrderKey = () => String(Date.now() + counter).padStart(20, "0");
  const nowIso = () => new Date().toISOString();

  const notebooks = new Map<string, NotebookDto>();
  const sectionGroups = new Map<string, SectionGroupDto>();
  const sections = new Map<string, SectionDto>();
  const pages = new Map<string, PageDocumentDto>();
  const trash = new Map<string, TrashEntryDto>();
  const trashedBundles = new Map<string, TrashedBundle>();
  const tags = new Map<string, TagDto>();
  /** Fake per-page autosave slot: pageId -> its one autosave, if any. No real asset-copy
   *  semantics needed here (see `renote_storage::autosave`'s doc comment for why the real Rust
   *  side must copy blobs) — a plain deep-cloned `PageDocumentDto` is enough to drive
   *  `AutosavePanel` in browser-mode verification. */
  const autosaves = new Map<string, FakeAutosave>();
  /** Fake in-memory asset store: assetPath -> raw bytes + the original file name (kept only to
   *  guess a MIME type for the `data:` URL `resolveAssetPath` below builds — see that method's
   *  doc comment for why the fake diverges from the real client here). */
  const assets = new Map<string, { bytes: Uint8Array; fileName: string }>();

  function seed() {
    const notebook: NotebookDto = {
      id: newId("notebook"),
      name: "My Notebook",
      path: "(in-memory)",
      color: null,
      createdAt: nowIso(),
      modifiedAt: nowIso(),
    };
    notebooks.set(notebook.id, notebook);

    const section: SectionDto = {
      id: newId("section"),
      notebookId: notebook.id,
      parentGroupId: null,
      name: "Quick Notes",
      color: null,
      orderKey: newOrderKey(),
    };
    sections.set(section.id, section);

    const page: PageDocumentDto = {
      id: newId("page"),
      sectionId: section.id,
      parentPageId: null,
      orderKey: newOrderKey(),
      title: "Untitled page",
      background: { color: null, ruleLines: "none" },
      templateId: null,
      createdAt: nowIso(),
      modifiedAt: nowIso(),
      schemaVersion: 1,
      objects: [],
    };
    pages.set(page.id, page);
  }
  seed();

  function toPageDto(doc: PageDocumentDto): PageDto {
    const { objects: _objects, ...page } = doc;
    return page;
  }

  /** Recursively walks `value` for every `{kind: "wikilink", attr: "<pageId>"}` node — see
   *  `packages/text-editor/src/schema/marks.ts`'s `TextMark.attr2` doc comment for why `attr`
   *  (not a differently-named field) carries the resolved target page id — and adds each
   *  distinct one found to `out`. Mirrors `renote-index`'s `extract_wikilink_targets`/
   *  `collect_wikilink_targets` Rust walk, computed fresh on every call (rather than cached
   *  alongside each page save) — the same "infer from the current object data at query time"
   *  approach `search`'s tag-filter check above already uses for tag assignments, kept for
   *  consistency rather than introducing a second, separately-synced in-memory index here. */
  function collectWikilinkTargets(value: unknown, out: Set<string>): void {
    if (Array.isArray(value)) {
      for (const item of value) collectWikilinkTargets(item, out);
      return;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.kind === "wikilink" && typeof record.attr === "string" && record.attr !== "") {
        out.add(record.attr);
      }
      for (const nested of Object.values(record)) collectWikilinkTargets(nested, out);
    }
  }

  /** Every `(source, target)` wikilink pair across every currently in-memory page — including
   *  self-links (`sourcePageId === targetPageId`), which are never filtered out anywhere in this
   *  fake, matching the real Rust-side `page_link` table's same non-filtering. */
  function computeAllPageLinks(): PageLinkDto[] {
    const links: PageLinkDto[] = [];
    for (const page of pages.values()) {
      const targets = new Set<string>();
      for (const object of page.objects) {
        collectWikilinkTargets(object.data, targets);
      }
      for (const targetPageId of targets) {
        links.push({ sourcePageId: page.id, targetPageId });
      }
    }
    return links;
  }

  /** Recursively finds every section-group id nested (directly or indirectly) under `groupId`. */
  function descendantGroupIds(groupId: string): string[] {
    const direct = [...sectionGroups.values()].filter((g) => g.parentId === groupId);
    return direct.flatMap((g) => [g.id, ...descendantGroupIds(g.id)]);
  }

  /** Cascade-removes the section-group identified by `groupId` — that group ITSELF, plus every
   *  group/section/page nested under it — from the live maps, returning everything removed so
   *  it can be stashed in a trash entry's bundle. Callers must not separately re-add or
   *  re-delete `groupId`'s own group; it's already included in the returned `sectionGroups`. */
  function cutSectionGroupSubtree(groupId: string): TrashedBundle {
    const groupIds = [groupId, ...descendantGroupIds(groupId)];
    const cutGroups: SectionGroupDto[] = [];
    const cutSections: SectionDto[] = [];
    const cutPages: PageDocumentDto[] = [];

    for (const id of groupIds) {
      const group = sectionGroups.get(id);
      if (group) {
        cutGroups.push(group);
        sectionGroups.delete(id);
      }
    }
    for (const section of [...sections.values()]) {
      if (section.parentGroupId && groupIds.includes(section.parentGroupId)) {
        cutSections.push(section);
        sections.delete(section.id);
        for (const page of [...pages.values()]) {
          if (page.sectionId === section.id) {
            cutPages.push(page);
            pages.delete(page.id);
          }
        }
      }
    }
    return { sectionGroups: cutGroups, sections: cutSections, pages: cutPages };
  }

  function cutSection(sectionId: string): TrashedBundle {
    const section = sections.get(sectionId);
    if (!section) throw new Error(`fake storage: section not found: ${sectionId}`);
    sections.delete(sectionId);
    const cutPages: PageDocumentDto[] = [];
    for (const page of [...pages.values()]) {
      if (page.sectionId === sectionId) {
        cutPages.push(page);
        pages.delete(page.id);
      }
    }
    return { sectionGroups: [], sections: [section], pages: cutPages };
  }

  function restoreBundle(bundle: TrashedBundle) {
    if (bundle.notebook) notebooks.set(bundle.notebook.id, bundle.notebook);
    for (const group of bundle.sectionGroups) sectionGroups.set(group.id, group);
    for (const section of bundle.sections) sections.set(section.id, section);
    for (const page of bundle.pages) pages.set(page.id, page);
  }

  function trashEntry(bundle: TrashedBundle, fields: Omit<TrashEntryDto, "id" | "deletedAt">): TrashEntryDto {
    const entry: TrashEntryDto = { id: newId("trash"), deletedAt: nowIso(), ...fields };
    trash.set(entry.id, entry);
    trashedBundles.set(entry.id, bundle);
    return entry;
  }

  /**
   * Mirrors `renote-commands`' `naming` module: names are unique within their parent (a notebook
   * within the workspace, a section within its notebook, a page within its section), compared
   * case- and surrounding-whitespace-insensitively. `exceptId` is the item being renamed, so a
   * no-op rename to its own current name stays legal.
   */
  function isNameTaken(
    name: string,
    taken: Iterable<{ id: string; name: string }>,
    exceptId?: string,
  ): boolean {
    const wanted = name.trim().toLowerCase();
    for (const item of taken) {
      if (item.id !== exceptId && item.name.trim().toLowerCase() === wanted) return true;
    }
    return false;
  }

  /** The rename half of that rule: a name the user typed themselves is reported back as taken,
   *  never silently altered. The message shape matches the real command's, since that string is
   *  what the UI surfaces. */
  function ensureNameFree(
    kind: "notebook" | "section" | "page",
    name: string,
    taken: Iterable<{ id: string; name: string }>,
    exceptId?: string,
  ) {
    if (!isNameTaken(name, taken, exceptId)) return;
    const where =
      kind === "notebook" ? "this workspace" : kind === "section" ? "this notebook" : "this section";
    throw new Error(`a ${kind} ${kind === "page" ? "titled" : "named"} "${name}" already exists in ${where}`);
  }

  /** The create half: `name`, or the first of `"<name> 2"`, `"<name> 3"`… that is free — so
   *  "New Page" twice makes a second page rather than failing. */
  function freeName(name: string, taken: Iterable<{ id: string; name: string }>): string {
    const existing = [...taken];
    if (!isNameTaken(name, existing)) return name;
    for (let suffix = 2; ; suffix++) {
      const candidate = `${name} ${suffix}`;
      if (!isNameTaken(candidate, existing)) return candidate;
    }
  }

  /** Every section in a notebook, at any nesting depth — sections are unique per notebook, and
   *  `SectionDto` already carries `notebookId` whatever group it sits in. */
  function sectionsOfNotebook(notebookId: string) {
    return [...sections.values()].filter((s) => s.notebookId === notebookId);
  }

  /** Every page in a section, keyed the way `ensureNameFree` expects (a page's "name" is its
   *  title). */
  function pagesOfSection(sectionId: string) {
    return [...pages.values()]
      .filter((p) => p.sectionId === sectionId)
      .map((p) => ({ id: p.id, name: p.title }));
  }

  /** Overwrites `pageId`'s one autosave slot with a snapshot of its CURRENT in-memory state. */
  function writeAutosave(pageId: string) {
    const page = pages.get(pageId);
    if (!page) return;
    autosaves.set(pageId, { timestamp: nowIso(), doc: structuredClone(page) });
  }

  return {
    async listNotebooks() {
      return [...notebooks.values()];
    },

    async createNotebook(request: CreateNotebookRequestDto) {
      const notebook: NotebookDto = {
        id: newId("notebook"),
        name: freeName(request.name, notebooks.values()),
        path: "(in-memory)",
        color: request.color,
        createdAt: nowIso(),
        modifiedAt: nowIso(),
      };
      notebooks.set(notebook.id, notebook);
      return notebook;
    },

    async renameNotebook(request: RenameNotebookRequestDto) {
      const notebook = notebooks.get(request.notebookId);
      if (!notebook) throw new Error(`fake storage: notebook not found: ${request.notebookId}`);
      ensureNameFree("notebook", request.name, notebooks.values(), notebook.id);
      notebook.name = request.name;
      notebook.modifiedAt = nowIso();
      return notebook;
    },

    async listSections(request: ListSectionsRequestDto) {
      return [...sections.values()]
        .filter((s) => s.notebookId === request.notebookId && s.parentGroupId === request.parentGroupId)
        .sort((a, b) => a.orderKey.localeCompare(b.orderKey));
    },

    async listSectionGroups(request: ListSectionsRequestDto) {
      return [...sectionGroups.values()].filter(
        (g) => g.notebookId === request.notebookId && g.parentId === request.parentGroupId,
      );
    },

    async createSection(request: CreateSectionRequestDto) {
      const section: SectionDto = {
        id: newId("section"),
        notebookId: request.notebookId,
        parentGroupId: request.parentGroupId,
        name: freeName(request.name, sectionsOfNotebook(request.notebookId)),
        color: request.color,
        orderKey: request.orderKey,
      };
      sections.set(section.id, section);
      return section;
    },

    async renameSection(request: RenameSectionRequestDto) {
      const section = sections.get(request.sectionId);
      if (!section) throw new Error(`fake storage: section not found: ${request.sectionId}`);
      ensureNameFree("section", request.name, sectionsOfNotebook(section.notebookId), section.id);
      section.name = request.name;
      return section;
    },

    async moveSection(request: MoveSectionRequestDto) {
      const section = sections.get(request.id);
      if (!section) throw new Error(`fake storage: section not found: ${request.id}`);
      section.parentGroupId = request.targetParentGroupId;
      return section;
    },

    async moveSectionGroup(request: MoveSectionRequestDto) {
      const group = sectionGroups.get(request.id);
      if (!group) throw new Error(`fake storage: section group not found: ${request.id}`);
      group.parentId = request.targetParentGroupId;
      return group;
    },

    async renameSectionGroup(request: RenameSectionGroupRequestDto) {
      const group = sectionGroups.get(request.groupId);
      if (!group) throw new Error(`fake storage: section group not found: ${request.groupId}`);
      group.name = request.name;
      return group;
    },

    async createSectionGroup(request: CreateSectionGroupRequestDto) {
      const group: SectionGroupDto = {
        id: newId("section-group"),
        notebookId: request.notebookId,
        parentId: request.parentGroupId,
        name: request.name,
        orderKey: request.orderKey,
      };
      sectionGroups.set(group.id, group);
      return group;
    },

    async listPages(request: ListPagesRequestDto) {
      // Sorted by `orderKey`, matching `renote_storage::list_pages` — without it a reorder would
      // write the new keys and change nothing on screen.
      return [...pages.values()]
        .filter((p) => p.sectionId === request.sectionId)
        .sort((a, b) => a.orderKey.localeCompare(b.orderKey))
        .map(toPageDto);
    },

    async createPage(request: CreatePageRequestDto) {
      // Mirrors the real `create_page` command (renote-commands/src/page.rs): `templateId`
      // doubles as "copy from this page" — a template is just a page you copy, so this reads
      // the source page's own objects/background rather than the request's.
      const template = request.templateId ? pages.get(request.templateId) : undefined;
      const page: PageDocumentDto = {
        id: newId("page"),
        sectionId: request.sectionId,
        parentPageId: request.parentPageId,
        orderKey: request.orderKey,
        title: freeName(request.title, pagesOfSection(request.sectionId)),
        background: template ? template.background : request.background,
        templateId: request.templateId,
        createdAt: nowIso(),
        modifiedAt: nowIso(),
        schemaVersion: 1,
        objects: template
          ? template.objects.map((object) => ({ ...structuredClone(object), id: newId("obj") }))
          : [],
      };
      pages.set(page.id, page);
      return toPageDto(page);
    },

    async loadPageDocument(request: LoadPageObjectsRequestDto) {
      const page = pages.get(request.pageId);
      if (!page) throw new Error(`fake storage: page not found: ${request.pageId}`);
      return page;
    },

    async savePageObjects(request: SavePageObjectsRequestDto) {
      const page = pages.get(request.pageId);
      if (!page) throw new Error(`fake storage: page not found: ${request.pageId}`);
      // Same external-change guard the real command applies (see renote-commands/src/page.rs),
      // mirrored here so the conflict flow is exercisable outside a Tauri window.
      if (request.expectedModifiedAt !== null && request.expectedModifiedAt !== page.modifiedAt) {
        throw new Error(`conflict:${page.modifiedAt}`);
      }
      page.objects = request.objects;
      page.modifiedAt = nowIso();
      // No autosave side effect here, mirroring the real save_page_objects command (see
      // renote-commands/src/page.rs): autosaving is timer-driven from the frontend, not tied
      // to every content save.
      return toPageDto(page);
    },

    async updatePageBackground(request: UpdatePageBackgroundRequestDto) {
      const page = pages.get(request.pageId);
      if (!page) throw new Error(`fake storage: page not found: ${request.pageId}`);
      page.background = request.background;
      page.modifiedAt = nowIso();
      return toPageDto(page);
    },

    async renamePage(request: RenamePageRequestDto) {
      const page = pages.get(request.pageId);
      if (!page) throw new Error(`fake storage: page not found: ${request.pageId}`);
      ensureNameFree("page", request.title, pagesOfSection(page.sectionId), page.id);
      page.title = request.title;
      page.modifiedAt = nowIso();
      return toPageDto(page);
    },

    async setPageParent(request: SetPageParentRequestDto) {
      const page = pages.get(request.pageId);
      if (!page) throw new Error(`fake storage: page not found: ${request.pageId}`);
      page.parentPageId = request.parentPageId;
      page.modifiedAt = nowIso();
      return toPageDto(page);
    },

    async movePage(request: MovePageRequestDto) {
      const page = pages.get(request.pageId);
      if (!page) throw new Error(`fake storage: page not found: ${request.pageId}`);
      // Title de-dup runs BEFORE the page joins its new section, or it would collide with itself
      // and get suffixed on every move — the same order the real `move_page` command uses.
      page.title = freeName(page.title, pagesOfSection(request.targetSectionId));
      page.sectionId = request.targetSectionId;
      page.parentPageId = null;
      page.orderKey = request.orderKey;
      page.modifiedAt = nowIso();
      return toPageDto(page);
    },

    async reorderPages(request: ReorderPagesRequestDto) {
      return request.pageIds.map((pageId, position) => {
        const page = pages.get(pageId);
        if (!page) throw new Error(`fake storage: page not found: ${pageId}`);
        page.orderKey = String(position).padStart(20, "0");
        return toPageDto(page);
      });
    },

    async search(query: SearchQueryDto): Promise<SearchResultsDto> {
      const text = query.text.trim().toLowerCase();
      const tagIds = query.tagIds;
      // Empty free text is only "match nothing" when there's no tag filter either: a tag filter
      // with no text is the "browse every page carrying this tag" query the Tags panel's own
      // per-tag note counts are built on (see renote-index's search.rs, which treats it the same
      // way) — starting from an empty candidate list there would make every count read 0.
      const hasTagFilter = (query.tagIds?.length ?? 0) > 0;
      let candidates = text
        ? [...pages.values()].filter((p) => p.title.toLowerCase().includes(text))
        : hasTagFilter
          ? [...pages.values()]
          : [];

      if (tagIds && tagIds.length > 0) {
        // The fake seeds only trivial content, so rather than a real generic-JSON walk (see
        // renote-index's extract_tag_assignments for the real one), it's sufficient here to
        // just check whether any object's `data`, stringified, mentions one of the wanted tag
        // ids as a `"tagId":"<id>"` pair. Good enough for browser-mode verification; not meant
        // to be as rigorous as the Rust implementation.
        candidates = candidates.filter((p) =>
          p.objects.some((object) =>
            tagIds.some((tagId) => JSON.stringify(object.data).includes(`"tagId":"${tagId}"`)),
          ),
        );
      }

      const hits = candidates.map((p) => {
        const section = sections.get(p.sectionId);
        return {
          pageId: p.id,
          notebookId: section?.notebookId ?? "",
          sectionId: p.sectionId,
          title: p.title,
          snippet: p.title,
          score: 1,
        };
      });
      return { query, hits, tookMs: 0 };
    },

    async trashNotebook(request: TrashNotebookRequestDto) {
      const notebook = notebooks.get(request.notebookId);
      if (!notebook) throw new Error(`fake storage: notebook not found: ${request.notebookId}`);
      notebooks.delete(notebook.id);

      const topGroups = [...sectionGroups.values()].filter(
        (g) => g.notebookId === notebook.id && !g.parentId,
      );
      const nestedFromGroups = topGroups.reduce<TrashedBundle>(
        (acc, group) => {
          // cutSectionGroupSubtree(id) cuts `id`'s own group AND everything nested
          // under it (see its doc comment) — `group` itself is already in `cut.sectionGroups`.
          const cut = cutSectionGroupSubtree(group.id);
          return {
            sectionGroups: [...acc.sectionGroups, ...cut.sectionGroups],
            sections: [...acc.sections, ...cut.sections],
            pages: [...acc.pages, ...cut.pages],
          };
        },
        { sectionGroups: [], sections: [], pages: [] },
      );
      const topSections = [...sections.values()].filter(
        (s) => s.notebookId === notebook.id && !s.parentGroupId,
      );
      const cutTopSections = topSections.reduce<TrashedBundle>(
        (acc, section) => {
          const cut = cutSection(section.id);
          return {
            sectionGroups: acc.sectionGroups,
            sections: [...acc.sections, ...cut.sections],
            pages: [...acc.pages, ...cut.pages],
          };
        },
        { sectionGroups: [], sections: [], pages: [] },
      );

      const bundle: TrashedBundle = {
        notebook,
        sectionGroups: nestedFromGroups.sectionGroups,
        sections: [...nestedFromGroups.sections, ...cutTopSections.sections],
        pages: [...nestedFromGroups.pages, ...cutTopSections.pages],
      };
      return trashEntry(bundle, {
        kind: "notebook",
        originalId: notebook.id,
        name: notebook.name,
        notebookId: null,
        parentGroupId: null,
        sectionId: null,
      });
    },

    async trashSectionGroup(request: TrashSectionGroupRequestDto) {
      const group = sectionGroups.get(request.groupId);
      if (!group) throw new Error(`fake storage: section group not found: ${request.groupId}`);
      // cutSectionGroupSubtree(id) cuts `id`'s own group AND everything nested under it
      // (see its doc comment) — `group` is already included in `cut.sectionGroups`.
      const cut = cutSectionGroupSubtree(request.groupId);
      const bundle: TrashedBundle = {
        sectionGroups: cut.sectionGroups,
        sections: cut.sections,
        pages: cut.pages,
      };
      return trashEntry(bundle, {
        kind: "section-group",
        originalId: group.id,
        name: group.name,
        notebookId: group.notebookId,
        parentGroupId: group.parentId,
        sectionId: null,
      });
    },

    async trashSection(request: TrashSectionRequestDto) {
      const section = sections.get(request.sectionId);
      if (!section) throw new Error(`fake storage: section not found: ${request.sectionId}`);
      const bundle = cutSection(request.sectionId);
      return trashEntry(bundle, {
        kind: "section",
        originalId: section.id,
        name: section.name,
        notebookId: section.notebookId,
        parentGroupId: section.parentGroupId,
        sectionId: null,
      });
    },

    async trashPage(request: TrashPageRequestDto) {
      const page = pages.get(request.pageId);
      if (!page) throw new Error(`fake storage: page not found: ${request.pageId}`);
      pages.delete(page.id);
      return trashEntry(
        { sectionGroups: [], sections: [], pages: [page] },
        {
          kind: "page",
          originalId: page.id,
          name: page.title,
          notebookId: request.notebookId,
          parentGroupId: null,
          sectionId: page.sectionId,
        },
      );
    },

    async listTrash() {
      return [...trash.values()].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    },

    async restoreFromTrash(request: RestoreFromTrashRequestDto) {
      const entry = trash.get(request.entryId);
      const bundle = trashedBundles.get(request.entryId);
      if (!entry || !bundle) throw new Error(`fake storage: trash entry not found: ${request.entryId}`);
      restoreBundle(bundle);
      trash.delete(request.entryId);
      trashedBundles.delete(request.entryId);
      return entry;
    },

    async emptyTrashEntry(request: EmptyTrashEntryRequestDto) {
      trash.delete(request.entryId);
      trashedBundles.delete(request.entryId);
    },

    async emptyTrash() {
      trash.clear();
      trashedBundles.clear();
    },

    async exportNotebookBackup(request: ExportNotebookBackupRequestDto) {
      // No real filesystem to write to in a plain browser — this only
      // validates the notebook exists, matching how other fakes stay
      // honest about what they can/can't simulate (see this file's doc
      // comment). Native save dialogs are unavailable outside Tauri
      // anyway, so `AppShell` never invokes this path in browser dev mode.
      if (!notebooks.has(request.notebookId)) {
        throw new Error(`fake storage: notebook not found: ${request.notebookId}`);
      }
    },

    async importNotebookBackup(_request: ImportNotebookBackupRequestDto) {
      const notebook: NotebookDto = {
        id: newId("notebook"),
        name: "Restored Notebook",
        path: "(in-memory)",
        color: null,
        createdAt: nowIso(),
        modifiedAt: nowIso(),
      };
      notebooks.set(notebook.id, notebook);
      return notebook;
    },

    // A plain browser has no persisted workspace to read, and `AppShell` should never see the
    // "no workspace" gate outside Tauri (see this file's doc comment) — so unlike every other
    // fake method here, this always reports a workspace as already open.
    async getWorkspacePath() {
      return "(fake workspace)";
    },

    async setWorkspacePath(_request: SetWorkspacePathRequestDto) {
      // No-op: there's nothing to switch to in a plain browser.
    },

    async listRecentWorkspacePaths() {
      return [];
    },

    async listTags(request: ListTagsRequestDto) {
      return [...tags.values()].filter((t) => t.notebookId === request.notebookId);
    },

    async createTag(request: CreateTagRequestDto) {
      const tag: TagDto = {
        id: newId("tag"),
        notebookId: request.notebookId,
        kind: request.kind,
        label: request.label,
        color: request.color,
      };
      tags.set(tag.id, tag);
      return tag;
    },

    async updateTag(request: UpdateTagRequestDto) {
      const tag = tags.get(request.tagId);
      if (!tag) throw new Error(`fake storage: tag not found: ${request.tagId}`);
      tag.label = request.label;
      tag.color = request.color;
      return tag;
    },

    async deleteTag(request: DeleteTagRequestDto) {
      tags.delete(request.tagId);
      // Cascade-clear: null out this tag's id wherever it appears in any page's object data,
      // mirroring (loosely — see the `search` fake's own comment above) what the real
      // renote-storage::tag::delete_tag does with a proper recursive JSON walk. The fake
      // doesn't need that rigor, just enough to keep "delete a tag clears the assignment"
      // observable in browser-mode verification.
      for (const page of pages.values()) {
        for (const object of page.objects) {
          object.data = clearTagIdDeep(object.data, request.tagId);
        }
      }
    },

    async listTaggedParagraphs(request: ListTaggedParagraphsRequestDto): Promise<TaggedParagraphDto[]> {
      const notebookPages = [...pages.values()]
        .filter((page) => sections.get(page.sectionId)?.notebookId === request.notebookId)
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

      const rows: TaggedParagraphDto[] = [];
      for (const page of notebookPages) {
        for (const object of page.objects) {
          for (const block of contentBlocks(object as unknown as PageObject)) {
            if ((block as { tagId?: unknown }).tagId !== request.tagId) continue;
            rows.push({
              pageId: page.id,
              pageTitle: page.title,
              objectId: object.id,
              text: blockText(block),
            });
          }
        }
      }
      return rows;
    },

    async getAutosaveStatus(request: GetAutosaveStatusRequestDto): Promise<AutosaveMetaDto | null> {
      const autosave = autosaves.get(request.pageId);
      if (!autosave) return null;
      return {
        timestamp: autosave.timestamp,
        sizeBytes: JSON.stringify(autosave.doc).length,
        objectCount: autosave.doc.objects.length,
      };
    },

    async restoreAutosave(request: RestoreAutosaveRequestDto) {
      const autosave = autosaves.get(request.pageId);
      if (!autosave) {
        throw new Error(`fake storage: no autosave for page: ${request.pageId}`);
      }
      const page = pages.get(request.pageId);
      if (!page) throw new Error(`fake storage: page not found: ${request.pageId}`);
      page.objects = structuredClone(autosave.doc.objects);
      page.title = autosave.doc.title;
      page.background = autosave.doc.background;
      page.modifiedAt = nowIso();
      return toPageDto(page);
    },

    async saveAutosave(request: SaveAutosaveRequestDto) {
      writeAutosave(request.pageId);
    },

    // No real filesystem to read `sourcePath` from in a plain browser (the real client's
    // command reads it server-side in Rust — see `SaveImageAssetRequestDto`'s doc comment for
    // why). Stores a genuinely valid (if content-free) 1x1 PNG in place of the real picked
    // file's bytes — not just magic-byte-shaped filler — so `resolveAssetPath`'s resulting
    // `data:` URL still round-trips through a real `PIXI.Assets.load` decode for anyone
    // verifying the render pipeline in browser mode, even though the actual pixel content is a
    // stand-in.
    async saveImageAsset(request: SaveImageAssetRequestDto): Promise<AssetRefDto> {
      const fileName = request.sourcePath.split(/[\\/]/).pop() ?? "image";
      const assetPath = `assets/${request.pageId}/${newId("asset")}-${fileName}`;
      assets.set(assetPath, { bytes: MINIMAL_VALID_PNG, fileName });
      return { assetPath, naturalWidth: 1, naturalHeight: 1 };
    },

    // Real bytes (not filler, unlike `saveImageAsset` above): a browser can record real audio via
    // `MediaRecorder`, so there's no reason to substitute a stand-in — `resolveAssetPath` below
    // hands the recorded blob straight back as a `data:` URL a real `<audio>` element can play.
    async saveAudioAsset(request: SaveAudioAssetRequest, bytes: Uint8Array): Promise<string> {
      const assetPath = `assets/${request.pageId}/${newId("asset")}-${request.fileName}`;
      assets.set(assetPath, { bytes, fileName: request.fileName });
      return assetPath;
    },

    // Diverges deliberately from the real client: `tauriStorageClient.resolveAssetPath`
    // resolves an absolute filesystem path and runs it through Tauri's `convertFileSrc` (see
    // `packages/storage-client/src/asset-api.ts`), which only works inside a real Tauri WebView.
    // A plain browser has no Tauri asset protocol to fetch from at all, so this returns a
    // self-contained `data:` URL built straight from the bytes stashed in `saveImageAsset`
    // above — something a plain `<img>`/`PIXI.Assets.load` can consume directly with zero IPC,
    // keeping `run-desktop`-style browser-mode verification of real image rendering possible.
    async resolveAssetPath(request: ResolveAssetPathRequestDto): Promise<string> {
      const asset = assets.get(request.assetPath);
      if (!asset) throw new Error(`fake storage: asset not found: ${request.assetPath}`);
      return `data:${guessMimeType(asset.fileName)};base64,${bytesToBase64(asset.bytes)}`;
    },

    // Mirrors the real `readAudioAsset`'s bytes-in/bytes-out shape (see that method's doc comment
    // in `asset-api.ts`) — a plain browser has no WebKitGTK/GStreamer quirk to work around, but
    // `PageEditorView`'s audio overlay calls this either way, so the fake needs it too.
    async readAudioAsset(request: ResolveAssetPathRequestDto): Promise<ArrayBuffer> {
      const asset = assets.get(request.assetPath);
      if (!asset) throw new Error(`fake storage: asset not found: ${request.assetPath}`);
      return asset.bytes.slice().buffer;
    },

    async copyPageAsset(request: CopyPageAssetRequestDto): Promise<string> {
      const source = assets.get(request.sourceAssetPath);
      if (!source) throw new Error(`fake storage: asset not found: ${request.sourceAssetPath}`);
      const assetPath = `assets/${request.pageId}/${newId("asset")}-${source.fileName}`;
      assets.set(assetPath, { ...source });
      return assetPath;
    },

    async deletePageAsset(request: DeletePageAssetRequestDto) {
      assets.delete(request.assetPath);
    },

    // Mirrors the real `import_plain_text_file` command's return shape (a not-yet-inserted
    // text-box object DTO) but builds the `RichTextDocument`-shaped JSON directly in TS rather
    // than calling into `renote_import` (there's no Rust to call from a plain browser) — see
    // `fakeImportPlainText`'s doc comment below for why this mirrors the Rust implementation's
    // paragraph-per-line shape line for line.
    // No real filesystem to read `sourcePath` from in a plain browser (the real client's
    // command reads it server-side in Rust — see `ImportPlainTextRequestDto`'s doc comment for
    // why). Stands in with a short placeholder line naming the picked file, since there's no
    // real content to import — nothing in browser-mode verification depends on the imported
    // text's actual content, only on the insert/undo flow working.
    async importPlainTextFile(request: ImportPlainTextRequestDto): Promise<PageObjectDto> {
      const page = pages.get(request.pageId);
      if (!page) throw new Error(`fake storage: page not found: ${request.pageId}`);
      const fileName = request.sourcePath.split(/[\\/]/).pop() ?? "text file";
      return {
        id: newId("object"),
        type: "text-box",
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 0 },
        bounds: { x: 0, y: 0, width: 400, height: 300 },
        data: { content: fakeImportPlainText(`(fake import of ${fileName})`) },
      };
    },

    // No real file to write to in a plain browser — native save dialogs are unavailable outside
    // Tauri anyway (see this file's doc comment), so `AppShell` never invokes these paths in
    // browser dev mode. Each still validates its target exists, matching how
    // `exportNotebookBackup` above stays honest about what it can/can't simulate.
    async exportPagePdf(request: ExportPagePdfRequestDto) {
      if (!pages.has(request.pageId)) throw new Error(`fake storage: page not found: ${request.pageId}`);
    },

    async exportSectionPdf(request: ExportSectionPdfRequestDto) {
      if (!sections.has(request.sectionId)) {
        throw new Error(`fake storage: section not found: ${request.sectionId}`);
      }
    },

    async exportNotebookPdf(request: ExportNotebookPdfRequestDto) {
      if (!notebooks.has(request.notebookId)) {
        throw new Error(`fake storage: notebook not found: ${request.notebookId}`);
      }
    },

    async exportPagePlainText(request: ExportPagePlainTextRequestDto) {
      if (!pages.has(request.pageId)) throw new Error(`fake storage: page not found: ${request.pageId}`);
    },

    async exportPageMarkdown(request: ExportPageMarkdownRequestDto) {
      if (!pages.has(request.pageId)) throw new Error(`fake storage: page not found: ${request.pageId}`);
    },

    async exportSectionMarkdown(request: ExportSectionMarkdownRequestDto) {
      if (!sections.has(request.sectionId)) {
        throw new Error(`fake storage: section not found: ${request.sectionId}`);
      }
    },

    async exportNotebookMarkdown(request: ExportNotebookMarkdownRequestDto) {
      if (!notebooks.has(request.notebookId)) {
        throw new Error(`fake storage: notebook not found: ${request.notebookId}`);
      }
    },

    async listBacklinks(request: ListBacklinksRequestDto): Promise<PageDto[]> {
      const sourceIds = new Set(
        computeAllPageLinks()
          .filter((link) => link.targetPageId === request.pageId)
          .map((link) => link.sourcePageId),
      );
      const result: PageDto[] = [];
      for (const sourceId of sourceIds) {
        const page = pages.get(sourceId);
        if (page) result.push(toPageDto(page));
      }
      return result;
    },

    async resolveWikilinkTarget(request: ResolveWikilinkTargetRequestDto): Promise<WikilinkResolutionDto> {
      // Notebook scoping: a page belongs to the notebook if its section does — titles are only
      // unique within one notebook (see this command's Rust-side doc comment), so candidates
      // outside `request.notebookId` are never considered, even if their title matches too. The
      // page currently being edited is never excluded — resolving to itself (a self-link) is
      // exactly as valid a `found` result as any other page.
      const sectionIdsInNotebook = new Set(
        [...sections.values()].filter((s) => s.notebookId === request.notebookId).map((s) => s.id),
      );
      const matches = [...pages.values()].filter(
        (page) => sectionIdsInNotebook.has(page.sectionId) && page.title === request.title,
      );
      if (matches.length === 0) return { kind: "notFound" };
      if (matches.length === 1) return { kind: "found", page: toPageDto(matches[0]!) };
      return { kind: "ambiguous", pages: matches.map(toPageDto) };
    },

    async createLinkedPage(request: CreateLinkedPageRequestDto): Promise<PageDto> {
      ensureNameFree("page", request.title, pagesOfSection(request.sectionId));
      const page: PageDocumentDto = {
        id: newId("page"),
        sectionId: request.sectionId,
        parentPageId: null,
        orderKey: newOrderKey(),
        title: request.title,
        background: { color: null, ruleLines: "none" },
        templateId: null,
        createdAt: nowIso(),
        modifiedAt: nowIso(),
        schemaVersion: 1,
        objects: [],
      };
      pages.set(page.id, page);
      return toPageDto(page);
    },

    async listPageLinks(request: ListPageLinksRequestDto): Promise<PageLinkDto[]> {
      const sectionIdsInNotebook = new Set(
        [...sections.values()].filter((s) => s.notebookId === request.notebookId).map((s) => s.id),
      );
      return computeAllPageLinks().filter((link) => {
        const sourcePage = pages.get(link.sourcePageId);
        return sourcePage !== undefined && sectionIdsInNotebook.has(sourcePage.sectionId);
      });
    },

    async listPageLocations(): Promise<PageLocationDto[]> {
      const locations: PageLocationDto[] = [];
      for (const page of pages.values()) {
        const section = sections.get(page.sectionId);
        const notebook = section ? notebooks.get(section.notebookId) : undefined;
        // Same join the real command's SQL does: a page whose section (or notebook) is gone has
        // no address to report, so it is skipped rather than listed location-less.
        if (!section || !notebook) continue;
        locations.push({
          pageId: page.id,
          pageTitle: page.title,
          sectionId: section.id,
          sectionName: section.name,
          notebookId: notebook.id,
          notebookName: notebook.name,
        });
      }
      return locations;
    },

    // No bundled embedding model in a plain browser (the real one is Rust-side, loaded from
    // `renote-index/model/` — see `renote_index::semantic`'s doc comment) — an honest "nothing
    // found" rather than faking similarity scoring this fake has no way to compute correctly.
    async findRelatedPages(): Promise<SearchHitDto[]> {
      return [];
    },

    // AppShell.tsx only ever calls these inside `isTauri() && navigator.userAgent.includes
    // ("Linux")` — a plain browser (this fake's whole reason to exist) never reaches either one,
    // so there's nothing meaningful to fake here.
    async startNativeAudioCapture(): Promise<void> {
      throw new Error("fake storage: native audio capture has no browser-mode implementation");
    },
    async stopNativeAudioCapture(): Promise<string> {
      throw new Error("fake storage: native audio capture has no browser-mode implementation");
    },
  };
}

/**
 * TS-side reimplementation of `renote_import::import_plain_text`'s `RichTextDocument`-shaped
 * JSON: one paragraph per input line, an empty line becomes a paragraph with no runs, and a
 * single trailing newline does not add a spurious extra empty paragraph. Kept in lockstep with
 * the Rust implementation by hand (see that function's doc comment for the exact shape) rather
 * than shared code, since there's no Rust to call from a plain browser.
 */
function fakeImportPlainText(text: string): unknown {
  const normalized = text.replace(/\r\n/g, "\n");
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  const lines = body.length === 0 ? [""] : body.split("\n");

  return {
    paragraphs: lines.map((line) =>
      line.length === 0
        ? { runs: [], listKind: "none", indentLevel: 0, tagId: null }
        : { runs: [{ text: line, marks: [] }], listKind: "none", indentLevel: 0, tagId: null },
    ),
  };
}

/** Encodes raw bytes as base64 without blowing the call stack on large images (`btoa` needs a
 *  plain binary string, and `String.fromCharCode(...bytes)` on a multi-megabyte array can
 *  exceed the engine's max argument count — chunking avoids that). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** Guesses a MIME type from a file's extension — good enough for a `data:` URL an `<img>`/Pixi
 *  texture load can decode; the real Rust side never needs this (the OS/asset protocol already
 *  knows each file's actual type from its bytes and extension). */
function guessMimeType(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "webm":
      return "audio/webm";
    case "m4a":
    case "mp4":
      return "audio/mp4";
    default:
      return "application/octet-stream";
  }
}

/** Recursively replaces any `tagId` field equal to `tagId` with `null`, anywhere in `value`. */
function clearTagIdDeep(value: unknown, tagId: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => clearTagIdDeep(item, tagId));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, v]) => {
      if (key === "tagId" && v === tagId) return [key, null] as const;
      return [key, clearTagIdDeep(v, tagId)] as const;
    });
    return Object.fromEntries(entries);
  }
  return value;
}
