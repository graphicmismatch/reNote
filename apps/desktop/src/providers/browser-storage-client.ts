import type { PageObject } from "@renote/core";
import { blockText, contentBlocks } from "../page-editor/page-anchors.js";
import { pageMarkdown, pagePlainText, pagesMarkdown, printableHtml } from "./page-export.js";
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
  FindRelatedPagesRequestDto,
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

/** One autosave slot for a page (see `autosaves` below). */
interface Autosave {
  timestamp: string;
  doc: PageDocumentDto;
}

/** Everything cascade-removed by trashing one item, stashed so restore can put it all back. */
interface TrashedBundle {
  notebook?: NotebookDto;
  sectionGroups: SectionGroupDto[];
  sections: SectionDto[];
  pages: PageDocumentDto[];
}

export interface StoredAsset {
  bytes: Uint8Array;
  fileName: string;
}

/** Everything except asset bytes, as plain entry arrays — what `ClientStore.saveState` persists. */
export interface StateSnapshot {
  notebooks: [string, NotebookDto][];
  sectionGroups: [string, SectionGroupDto][];
  sections: [string, SectionDto][];
  pages: [string, PageDocumentDto][];
  trash: [string, TrashEntryDto][];
  trashedBundles: [string, TrashedBundle][];
  tags: [string, TagDto][];
  autosaves: [string, Autosave][];
}

/** Where the client's data lives between sessions (see `idb-store.ts`). */
export interface ClientStore {
  state: StateSnapshot | null;
  assets: Map<string, StoredAsset>;
  saveState(snapshot: StateSnapshot): void;
  putAsset(path: string, asset: StoredAsset): void;
  deleteAsset(path: string): void;
}

/** A self-contained reNote backup file (notebook subtree + its tags and asset bytes). */
interface BackupFile {
  format: "renote-backup";
  version: 1;
  notebook: NotebookDto;
  sectionGroups: SectionGroupDto[];
  sections: SectionDto[];
  pages: PageDocumentDto[];
  tags: TagDto[];
  assets: [string, { base64: string; fileName: string }][];
}

/** Methods that never change data — everything else triggers a save after it settles. */
const READ_ONLY = /^(list|load|get|resolve|read|search|find|export|import)/;

/**
 * The app's `StorageClient`: all data in memory, persisted through `store` (IndexedDB in the
 * app, nothing in tests). Without a stored state it seeds one sample notebook/section/page.
 */
export function createBrowserStorageClient(store?: ClientStore): StorageClient {
  let counter = 0;
  const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
  const newOrderKey = () => String(Date.now() + ++counter).padStart(20, "0");
  const nowIso = () => new Date().toISOString();

  const notebooks = new Map<string, NotebookDto>(store?.state?.notebooks);
  const sectionGroups = new Map<string, SectionGroupDto>(store?.state?.sectionGroups);
  const sections = new Map<string, SectionDto>(store?.state?.sections);
  const pages = new Map<string, PageDocumentDto>(store?.state?.pages);
  const trash = new Map<string, TrashEntryDto>(store?.state?.trash);
  const trashedBundles = new Map<string, TrashedBundle>(store?.state?.trashedBundles);
  const tags = new Map<string, TagDto>(store?.state?.tags);
  /** pageId -> its one autosave. ponytail: references assets by path rather than copying them,
   *  so restoring after an image was deleted leaves that image broken. */
  const autosaves = new Map<string, Autosave>(store?.state?.autosaves);
  const assets = new Map<string, StoredAsset>(store?.assets);
  const putAsset = (path: string, asset: StoredAsset) => {
    assets.set(path, asset);
    store?.putAsset(path, asset);
  };
  const removeAsset = (path: string) => {
    assets.delete(path);
    store?.deleteAsset(path);
  };
  const snapshot = (): StateSnapshot => ({
    notebooks: [...notebooks],
    sectionGroups: [...sectionGroups],
    sections: [...sections],
    pages: [...pages],
    trash: [...trash],
    trashedBundles: [...trashedBundles],
    tags: [...tags],
    autosaves: [...autosaves],
  });

  function seed() {
    const notebook: NotebookDto = {
      id: newId("notebook"),
      name: "My Notebook",
      path: "",
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
  if (!store?.state) seed();

  function toPageDto(doc: PageDocumentDto): PageDto {
    const { objects: _objects, ...page } = doc;
    return page;
  }

  /** Recursively walks `value` for every `{kind: "wikilink", attr: "<pageId>"}` node — see
   *  `packages/text-editor/src/schema/marks.ts`'s `TextMark.attr2` doc comment for why `attr`
   *  (not a differently-named field) carries the resolved target page id — and adds each
   *  distinct one found to `out`. Computed fresh on every call rather than indexed. */
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
   *  self-links (`sourcePageId === targetPageId`), which are deliberately kept. */
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
    if (!section) throw new Error(`section not found: ${sectionId}`);
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
   * Names are unique within their parent (a notebook
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

  const client: StorageClient = {
    async listNotebooks() {
      return [...notebooks.values()];
    },

    async createNotebook(request: CreateNotebookRequestDto) {
      const notebook: NotebookDto = {
        id: newId("notebook"),
        name: freeName(request.name, notebooks.values()),
        path: "",
        color: request.color,
        createdAt: nowIso(),
        modifiedAt: nowIso(),
      };
      notebooks.set(notebook.id, notebook);
      return notebook;
    },

    async renameNotebook(request: RenameNotebookRequestDto) {
      const notebook = notebooks.get(request.notebookId);
      if (!notebook) throw new Error(`notebook not found: ${request.notebookId}`);
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
      if (!section) throw new Error(`section not found: ${request.sectionId}`);
      ensureNameFree("section", request.name, sectionsOfNotebook(section.notebookId), section.id);
      section.name = request.name;
      return section;
    },

    async moveSection(request: MoveSectionRequestDto) {
      const section = sections.get(request.id);
      if (!section) throw new Error(`section not found: ${request.id}`);
      section.parentGroupId = request.targetParentGroupId;
      return section;
    },

    async moveSectionGroup(request: MoveSectionRequestDto) {
      const group = sectionGroups.get(request.id);
      if (!group) throw new Error(`section group not found: ${request.id}`);
      group.parentId = request.targetParentGroupId;
      return group;
    },

    async renameSectionGroup(request: RenameSectionGroupRequestDto) {
      const group = sectionGroups.get(request.groupId);
      if (!group) throw new Error(`section group not found: ${request.groupId}`);
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
      // Sorted by `orderKey` — without it a reorder would
      // write the new keys and change nothing on screen.
      return [...pages.values()]
        .filter((p) => p.sectionId === request.sectionId)
        .sort((a, b) => a.orderKey.localeCompare(b.orderKey))
        .map(toPageDto);
    },

    async createPage(request: CreatePageRequestDto) {
      // `templateId`
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
      if (!page) throw new Error(`page not found: ${request.pageId}`);
      return page;
    },

    async savePageObjects(request: SavePageObjectsRequestDto) {
      const page = pages.get(request.pageId);
      if (!page) throw new Error(`page not found: ${request.pageId}`);
      // Optimistic-concurrency guard: another tab may have saved this page since it was loaded.
      if (request.expectedModifiedAt !== null && request.expectedModifiedAt !== page.modifiedAt) {
        throw new Error(`conflict:${page.modifiedAt}`);
      }
      page.objects = request.objects;
      page.modifiedAt = nowIso();
      // No autosave side effect: autosaving is timer-driven from the frontend.
      return toPageDto(page);
    },

    async updatePageBackground(request: UpdatePageBackgroundRequestDto) {
      const page = pages.get(request.pageId);
      if (!page) throw new Error(`page not found: ${request.pageId}`);
      page.background = request.background;
      page.modifiedAt = nowIso();
      return toPageDto(page);
    },

    async renamePage(request: RenamePageRequestDto) {
      const page = pages.get(request.pageId);
      if (!page) throw new Error(`page not found: ${request.pageId}`);
      ensureNameFree("page", request.title, pagesOfSection(page.sectionId), page.id);
      page.title = request.title;
      page.modifiedAt = nowIso();
      return toPageDto(page);
    },

    async setPageParent(request: SetPageParentRequestDto) {
      const page = pages.get(request.pageId);
      if (!page) throw new Error(`page not found: ${request.pageId}`);
      page.parentPageId = request.parentPageId;
      page.modifiedAt = nowIso();
      return toPageDto(page);
    },

    async movePage(request: MovePageRequestDto) {
      const page = pages.get(request.pageId);
      if (!page) throw new Error(`page not found: ${request.pageId}`);
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
        if (!page) throw new Error(`page not found: ${pageId}`);
        page.orderKey = String(position).padStart(20, "0");
        return toPageDto(page);
      });
    },

    async search(query: SearchQueryDto): Promise<SearchResultsDto> {
      const started = performance.now();
      const terms = query.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const tagIds = query.tagIds ?? [];
      // Empty text with a tag filter is the "every page carrying this tag" browse query the Tags
      // panel's counts rely on; empty text with no filter matches nothing.
      if (terms.length === 0 && tagIds.length === 0) return { query, hits: [], tookMs: 0 };

      const hits: SearchHitDto[] = [];
      for (const page of pages.values()) {
        const section = sections.get(page.sectionId);
        if (!section) continue;
        if (query.notebookIds && !query.notebookIds.includes(section.notebookId)) continue;
        if (query.sectionIds && !query.sectionIds.includes(page.sectionId)) continue;
        if (query.modifiedAfter && page.modifiedAt < query.modifiedAfter) continue;
        if (query.modifiedBefore && page.modifiedAt > query.modifiedBefore) continue;
        if (
          tagIds.length > 0 &&
          !page.objects.some((object) =>
            tagIds.some((tagId) => JSON.stringify(object.data).includes(`"tagId":"${tagId}"`)),
          )
        ) {
          continue;
        }
        const text = pagePlainText(page);
        const lower = text.toLowerCase();
        if (!terms.every((term) => lower.includes(term))) continue;
        const title = page.title.toLowerCase();
        const at = terms.length > 0 ? lower.indexOf(terms[0]!) : 0;
        hits.push({
          pageId: page.id,
          notebookId: section.notebookId,
          sectionId: page.sectionId,
          title: page.title,
          snippet: text.slice(Math.max(0, at - 40), at + 80).replace(/\s+/g, " "),
          // Title matches rank first, then by how often the terms occur.
          score: terms.reduce(
            (sum, term) => sum + (title.includes(term) ? 10 : 0) + lower.split(term).length - 1,
            0,
          ),
        });
      }
      hits.sort((a, b) => b.score - a.score);
      return { query, hits, tookMs: performance.now() - started };
    },

    async trashNotebook(request: TrashNotebookRequestDto) {
      const notebook = notebooks.get(request.notebookId);
      if (!notebook) throw new Error(`notebook not found: ${request.notebookId}`);
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
      if (!group) throw new Error(`section group not found: ${request.groupId}`);
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
      if (!section) throw new Error(`section not found: ${request.sectionId}`);
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
      if (!page) throw new Error(`page not found: ${request.pageId}`);
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
      if (!entry || !bundle) throw new Error(`trash entry not found: ${request.entryId}`);
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
      const notebook = notebooks.get(request.notebookId);
      if (!notebook) throw new Error(`notebook not found: ${request.notebookId}`);
      const notebookSections = sectionsOfNotebook(notebook.id);
      const sectionIds = new Set(notebookSections.map((section) => section.id));
      const backupPages = [...pages.values()].filter((page) => sectionIds.has(page.sectionId));
      const pageIds = new Set(backupPages.map((page) => page.id));
      const backup: BackupFile = {
        format: "renote-backup",
        version: 1,
        notebook,
        sectionGroups: [...sectionGroups.values()].filter((group) => group.notebookId === notebook.id),
        sections: notebookSections,
        pages: backupPages,
        tags: [...tags.values()].filter((tag) => tag.notebookId === notebook.id),
        assets: [...assets]
          .filter(([path]) => pageIds.has(path.split("/")[1] ?? ""))
          .map(([path, asset]) => [path, { base64: bytesToBase64(asset.bytes), fileName: asset.fileName }]),
      };
      return new Blob([JSON.stringify(backup)], { type: "application/json" });
    },

    async importNotebookBackup(request: ImportNotebookBackupRequestDto) {
      let backup: BackupFile;
      try {
        backup = JSON.parse(await request.file.text()) as BackupFile;
      } catch {
        throw new Error("That file isn't a reNote backup.");
      }
      if (backup.format !== "renote-backup" || backup.version !== 1) {
        throw new Error("That file isn't a reNote backup.");
      }
      // ponytail: ids are kept as-is so wikilinks inside the backup still resolve; restoring a
      // notebook that still exists is refused instead of remapping every id.
      if (notebooks.has(backup.notebook.id)) {
        throw new Error(`"${backup.notebook.name}" is already open — trash it first to restore this backup.`);
      }
      const notebook = { ...backup.notebook, name: freeName(backup.notebook.name, notebooks.values()) };
      notebooks.set(notebook.id, notebook);
      for (const group of backup.sectionGroups) sectionGroups.set(group.id, group);
      for (const section of backup.sections) sections.set(section.id, section);
      for (const page of backup.pages) pages.set(page.id, page);
      for (const tag of backup.tags) tags.set(tag.id, tag);
      for (const [path, asset] of backup.assets) {
        putAsset(path, { bytes: base64ToBytes(asset.base64), fileName: asset.fileName });
      }
      return notebook;
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
      if (!tag) throw new Error(`tag not found: ${request.tagId}`);
      tag.label = request.label;
      tag.color = request.color;
      return tag;
    },

    async deleteTag(request: DeleteTagRequestDto) {
      tags.delete(request.tagId);
      // Cascade-clear: null out this tag's id wherever it appears in any page's object data.
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
        throw new Error(`no autosave for page: ${request.pageId}`);
      }
      const page = pages.get(request.pageId);
      if (!page) throw new Error(`page not found: ${request.pageId}`);
      page.objects = structuredClone(autosave.doc.objects);
      page.title = autosave.doc.title;
      page.background = autosave.doc.background;
      page.modifiedAt = nowIso();
      return toPageDto(page);
    },

    async saveAutosave(request: SaveAutosaveRequestDto) {
      writeAutosave(request.pageId);
    },

    async saveImageAsset(request: SaveImageAssetRequestDto): Promise<AssetRefDto> {
      const file = request.file;
      const fileName = file instanceof File ? file.name : "image";
      const bitmap = await createImageBitmap(file);
      const assetRef = {
        assetPath: `assets/${request.pageId}/${newId("asset")}-${fileName}`,
        naturalWidth: bitmap.width,
        naturalHeight: bitmap.height,
      };
      bitmap.close();
      putAsset(assetRef.assetPath, { bytes: new Uint8Array(await file.arrayBuffer()), fileName });
      return assetRef;
    },

    // Real bytes (not filler, unlike `saveImageAsset` above): a browser can record real audio via
    // `MediaRecorder`, so there's no reason to substitute a stand-in — `resolveAssetPath` below
    // hands the recorded blob straight back as a `data:` URL a real `<audio>` element can play.
    async saveAudioAsset(request: SaveAudioAssetRequest, bytes: Uint8Array): Promise<string> {
      const assetPath = `assets/${request.pageId}/${newId("asset")}-${request.fileName}`;
      putAsset(assetPath, { bytes, fileName: request.fileName });
      return assetPath;
    },

    async resolveAssetPath(request: ResolveAssetPathRequestDto): Promise<string> {
      const asset = assets.get(request.assetPath);
      if (!asset) throw new Error(`asset not found: ${request.assetPath}`);
      return `data:${guessMimeType(asset.fileName)};base64,${bytesToBase64(asset.bytes)}`;
    },

    async readAudioAsset(request: ResolveAssetPathRequestDto): Promise<ArrayBuffer> {
      const asset = assets.get(request.assetPath);
      if (!asset) throw new Error(`asset not found: ${request.assetPath}`);
      return asset.bytes.slice().buffer;
    },

    async copyPageAsset(request: CopyPageAssetRequestDto): Promise<string> {
      const source = assets.get(request.sourceAssetPath);
      if (!source) throw new Error(`asset not found: ${request.sourceAssetPath}`);
      const assetPath = `assets/${request.pageId}/${newId("asset")}-${source.fileName}`;
      putAsset(assetPath, { ...source });
      return assetPath;
    },

    async deletePageAsset(request: DeletePageAssetRequestDto) {
      removeAsset(request.assetPath);
    },

    async importPlainTextFile(request: ImportPlainTextRequestDto): Promise<PageObjectDto> {
      if (!pages.has(request.pageId)) throw new Error(`page not found: ${request.pageId}`);
      return {
        id: newId("object"),
        type: "text-box",
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 0 },
        bounds: { x: 0, y: 0, width: 400, height: 300 },
        data: { content: plainTextToRichText(await request.file.text()) },
      };
    },

    async exportPagePdf(request: ExportPagePdfRequestDto) {
      const page = requirePage(request.pageId);
      return printableHtml(page.title, [page], assetDataUrl);
    },

    async exportSectionPdf(request: ExportSectionPdfRequestDto) {
      const section = sections.get(request.sectionId);
      if (!section) throw new Error(`section not found: ${request.sectionId}`);
      return printableHtml(section.name, sectionPages(section.id), assetDataUrl);
    },

    async exportNotebookPdf(request: ExportNotebookPdfRequestDto) {
      const notebook = notebooks.get(request.notebookId);
      if (!notebook) throw new Error(`notebook not found: ${request.notebookId}`);
      return printableHtml(notebook.name, notebookPages(notebook.id), assetDataUrl);
    },

    async exportPagePlainText(request: ExportPagePlainTextRequestDto) {
      return textBlob(pagePlainText(requirePage(request.pageId)), "text/plain");
    },

    async exportPageMarkdown(request: ExportPageMarkdownRequestDto) {
      return textBlob(pageMarkdown(requirePage(request.pageId)), "text/markdown");
    },

    async exportSectionMarkdown(request: ExportSectionMarkdownRequestDto) {
      if (!sections.has(request.sectionId)) throw new Error(`section not found: ${request.sectionId}`);
      return textBlob(pagesMarkdown(sectionPages(request.sectionId)), "text/markdown");
    },

    async exportNotebookMarkdown(request: ExportNotebookMarkdownRequestDto) {
      if (!notebooks.has(request.notebookId)) throw new Error(`notebook not found: ${request.notebookId}`);
      return textBlob(pagesMarkdown(notebookPages(request.notebookId)), "text/markdown");
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
      // unique within one notebook, so candidates
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

    // ponytail: bag-of-words cosine similarity replaces the old embedding model — finds
    // pages sharing vocabulary, not synonyms. Swap in an embedding model if that matters.
    async findRelatedPages(request: FindRelatedPagesRequestDto): Promise<SearchHitDto[]> {
      const target = pages.get(request.pageId);
      if (!target) return [];
      const targetVector = termVector(pagePlainText(target));
      const hits: SearchHitDto[] = [];
      for (const page of notebookPages(request.notebookId)) {
        if (page.id === target.id) continue;
        const score = cosine(targetVector, termVector(pagePlainText(page)));
        if (score <= 0) continue;
        hits.push({
          pageId: page.id,
          notebookId: request.notebookId,
          sectionId: page.sectionId,
          title: page.title,
          snippet: pagePlainText(page)
            .slice(page.title.length, page.title.length + 120)
            .trim(),
          score,
        });
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, request.limit);
    },
  };

  function requirePage(pageId: string): PageDocumentDto {
    const page = pages.get(pageId);
    if (!page) throw new Error(`page not found: ${pageId}`);
    return page;
  }

  function sectionPages(sectionId: string): PageDocumentDto[] {
    return [...pages.values()]
      .filter((page) => page.sectionId === sectionId)
      .sort((a, b) => a.orderKey.localeCompare(b.orderKey));
  }

  function notebookPages(notebookId: string): PageDocumentDto[] {
    return sectionsOfNotebook(notebookId)
      .sort((a, b) => a.orderKey.localeCompare(b.orderKey))
      .flatMap((section) => sectionPages(section.id));
  }

  function assetDataUrl(assetPath: string): string | undefined {
    const asset = assets.get(assetPath);
    return asset && `data:${guessMimeType(asset.fileName)};base64,${bytesToBase64(asset.bytes)}`;
  }

  if (!store) return client;
  // Save after every mutating call settles — failed calls too, since they may have partially
  // mutated the in-memory maps before throwing.
  return new Proxy(client, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver) as unknown;
      if (typeof value !== "function" || typeof key !== "string" || READ_ONLY.test(key)) return value;
      return (...args: unknown[]) =>
        (value as (...a: unknown[]) => Promise<unknown>)
          .apply(target, args)
          .finally(() => store.saveState(snapshot()));
    },
  });
}

const textBlob = (text: string, type: string) => new Blob([text], { type: `${type};charset=utf-8` });

function termVector(text: string): Map<string, number> {
  const vector = new Map<string, number>();
  for (const word of text.toLowerCase().match(/\p{L}{3,}/gu) ?? [])
    vector.set(word, (vector.get(word) ?? 0) + 1);
  return vector;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  for (const [word, count] of a) dot += count * (b.get(word) ?? 0);
  if (dot === 0) return 0;
  const norm = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((sum, n) => sum + n * n, 0));
  return dot / (norm(a) * norm(b));
}

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** Plain text as a `RichTextDocument`: one paragraph per line; a single trailing newline adds no
 *  extra empty paragraph. */
function plainTextToRichText(text: string): unknown {
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

/** Guesses a MIME type from a file's extension — good enough for a `data:` URL. */
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
