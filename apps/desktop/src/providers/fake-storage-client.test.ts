import { describe, expect, it } from "vitest";
import { createFakeStorageClient } from "./fake-storage-client.js";

/**
 * The trash cascade logic (cutSectionGroupSubtree + its three call sites)
 * moves items between live maps and a trash bundle by hand, with no type
 * system help catching an accidental duplicate/dropped entry — exactly the
 * kind of bug that looks right on a read-through and isn't. These tests
 * exist to actually run it, not just review it.
 */
describe("createFakeStorageClient trash", () => {
  it("trashing a section group removes exactly one entry for it, not a duplicate", async () => {
    const client = createFakeStorageClient();
    const [notebook] = await client.listNotebooks();
    const group = await client.createSectionGroup({
      notebookId: notebook!.id,
      parentGroupId: null,
      name: "Group A",
      orderKey: "a",
    });

    const entry = await client.trashSectionGroup({ notebookId: notebook!.id, groupId: group.id });
    expect(entry.originalId).toBe(group.id);

    const remaining = await client.listSectionGroups({ notebookId: notebook!.id, parentGroupId: null });
    expect(remaining).toEqual([]);

    const trash = await client.listTrash();
    expect(trash.filter((e) => e.originalId === group.id)).toHaveLength(1);

    const restored = await client.restoreFromTrash({ entryId: entry.id });
    expect(restored.originalId).toBe(group.id);
    const afterRestore = await client.listSectionGroups({ notebookId: notebook!.id, parentGroupId: null });
    expect(afterRestore).toEqual([group]);
  });

  it("trashing a section group cascades to its nested groups, sections, and pages, and restore brings everything back", async () => {
    const client = createFakeStorageClient();
    const [notebook] = await client.listNotebooks();

    const parentGroup = await client.createSectionGroup({
      notebookId: notebook!.id,
      parentGroupId: null,
      name: "Parent",
      orderKey: "a",
    });
    const childGroup = await client.createSectionGroup({
      notebookId: notebook!.id,
      parentGroupId: parentGroup.id,
      name: "Child",
      orderKey: "a",
    });
    const section = await client.createSection({
      notebookId: notebook!.id,
      parentGroupId: childGroup.id,
      name: "Nested Section",
      color: null,
      orderKey: "a",
    });
    const page = await client.createPage({
      notebookId: notebook!.id,
      sectionId: section.id,
      parentPageId: null,
      orderKey: "a",
      title: "Nested Page",
      background: { color: null, ruleLines: "none" },
      templateId: null,
    });

    await client.trashSectionGroup({ notebookId: notebook!.id, groupId: parentGroup.id });

    expect(await client.listSectionGroups({ notebookId: notebook!.id, parentGroupId: null })).toEqual([]);
    expect(
      await client.listSectionGroups({ notebookId: notebook!.id, parentGroupId: parentGroup.id }),
    ).toEqual([]);
    expect(await client.listSections({ notebookId: notebook!.id, parentGroupId: childGroup.id })).toEqual([]);
    await expect(
      client.loadPageDocument({ notebookId: notebook!.id, sectionId: section.id, pageId: page.id }),
    ).rejects.toThrow();

    const trash = await client.listTrash();
    const parentEntry = trash.find((e) => e.originalId === parentGroup.id);
    expect(parentEntry).toBeDefined();
    // Nested items are cascaded into the SAME trash entry as the parent group, not
    // surfaced as separate top-level trash rows.
    expect(trash.filter((e) => e.originalId === childGroup.id)).toHaveLength(0);
    expect(trash.filter((e) => e.originalId === section.id)).toHaveLength(0);

    await client.restoreFromTrash({ entryId: parentEntry!.id });

    expect(await client.listSectionGroups({ notebookId: notebook!.id, parentGroupId: null })).toEqual([
      parentGroup,
    ]);
    expect(
      await client.listSectionGroups({ notebookId: notebook!.id, parentGroupId: parentGroup.id }),
    ).toEqual([childGroup]);
    expect(await client.listSections({ notebookId: notebook!.id, parentGroupId: childGroup.id })).toEqual([
      section,
    ]);
    const restoredDoc = await client.loadPageDocument({
      notebookId: notebook!.id,
      sectionId: section.id,
      pageId: page.id,
    });
    expect(restoredDoc.title).toBe("Nested Page");
  });

  it("trashing a notebook removes exactly one entry each for its top-level groups, and restore brings everything back with no duplicates", async () => {
    const client = createFakeStorageClient();
    const notebook = await client.createNotebook({
      name: "Second Notebook",
      color: null,
      parentDirectory: null,
    });

    const groupA = await client.createSectionGroup({
      notebookId: notebook.id,
      parentGroupId: null,
      name: "Group A",
      orderKey: "a",
    });
    const groupB = await client.createSectionGroup({
      notebookId: notebook.id,
      parentGroupId: null,
      name: "Group B",
      orderKey: "b",
    });
    const topSection = await client.createSection({
      notebookId: notebook.id,
      parentGroupId: null,
      name: "Top Section",
      color: null,
      orderKey: "a",
    });

    await client.trashNotebook({ notebookId: notebook.id });

    expect(await client.listNotebooks()).not.toContainEqual(notebook);
    expect(await client.listSectionGroups({ notebookId: notebook.id, parentGroupId: null })).toEqual([]);
    expect(await client.listSections({ notebookId: notebook.id, parentGroupId: null })).toEqual([]);

    const trash = await client.listTrash();
    // The notebook itself gets one entry; groupA/groupB/topSection must NOT also appear
    // as separate top-level trash rows (they're nested inside the notebook's bundle) —
    // and critically, must not appear as duplicates within that bundle either.
    expect(trash.filter((e) => e.originalId === notebook.id)).toHaveLength(1);
    expect(trash.filter((e) => e.originalId === groupA.id)).toHaveLength(0);
    expect(trash.filter((e) => e.originalId === groupB.id)).toHaveLength(0);
    expect(trash.filter((e) => e.originalId === topSection.id)).toHaveLength(0);

    const notebookEntry = trash.find((e) => e.originalId === notebook.id)!;
    await client.restoreFromTrash({ entryId: notebookEntry.id });

    expect(await client.listNotebooks()).toContainEqual(notebook);
    const restoredGroups = await client.listSectionGroups({ notebookId: notebook.id, parentGroupId: null });
    expect(restoredGroups).toHaveLength(2);
    expect(restoredGroups).toContainEqual(groupA);
    expect(restoredGroups).toContainEqual(groupB);
    expect(await client.listSections({ notebookId: notebook.id, parentGroupId: null })).toEqual([topSection]);
  });

  it("trashing a section removes its pages too, and restore brings the page back", async () => {
    const client = createFakeStorageClient();
    const [notebook] = await client.listNotebooks();
    const [section] = await client.listSections({ notebookId: notebook!.id, parentGroupId: null });
    const pagesBefore = await client.listPages({ notebookId: notebook!.id, sectionId: section!.id });
    expect(pagesBefore).toHaveLength(1);
    const [page] = pagesBefore;

    const entry = await client.trashSection({ notebookId: notebook!.id, sectionId: section!.id });
    expect(await client.listSections({ notebookId: notebook!.id, parentGroupId: null })).toEqual([]);
    await expect(
      client.loadPageDocument({ notebookId: notebook!.id, sectionId: section!.id, pageId: page!.id }),
    ).rejects.toThrow();

    await client.restoreFromTrash({ entryId: entry.id });
    expect(await client.listSections({ notebookId: notebook!.id, parentGroupId: null })).toEqual([section]);
    expect(await client.listPages({ notebookId: notebook!.id, sectionId: section!.id })).toEqual([page]);
  });

  it("emptyTrashEntry removes just one entry; emptyTrash clears everything", async () => {
    const client = createFakeStorageClient();
    const [notebook] = await client.listNotebooks();
    const groupA = await client.createSectionGroup({
      notebookId: notebook!.id,
      parentGroupId: null,
      name: "A",
      orderKey: "a",
    });
    const groupB = await client.createSectionGroup({
      notebookId: notebook!.id,
      parentGroupId: null,
      name: "B",
      orderKey: "b",
    });
    const entryA = await client.trashSectionGroup({ notebookId: notebook!.id, groupId: groupA.id });
    await client.trashSectionGroup({ notebookId: notebook!.id, groupId: groupB.id });

    await client.emptyTrashEntry({ entryId: entryA.id });
    let trash = await client.listTrash();
    expect(trash.some((e) => e.originalId === groupA.id)).toBe(false);
    expect(trash.some((e) => e.originalId === groupB.id)).toBe(true);

    await client.emptyTrash();
    trash = await client.listTrash();
    expect(trash).toEqual([]);
  });
});

describe("createFakeStorageClient createPage templates (Phase 11.1)", () => {
  it("templateId copies the source page's objects (with fresh ids) and background, not the request's", async () => {
    const client = createFakeStorageClient();
    const [notebook] = await client.listNotebooks();
    const [section] = await client.listSections({ notebookId: notebook!.id, parentGroupId: null });

    const template = await client.createPage({
      notebookId: notebook!.id,
      sectionId: section!.id,
      parentPageId: null,
      orderKey: "a",
      title: "Meeting Notes",
      background: { color: "#fffbe6", ruleLines: "college-ruled" },
      templateId: null,
    });
    await client.savePageObjects({
      notebookId: notebook!.id,
      sectionId: section!.id,
      pageId: template.id,
      objects: [
        {
          id: "obj-template-1",
          type: "text-box",
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 0 },
          bounds: { x: 0, y: 0, width: 100, height: 20 },
          data: { content: "Agenda" },
        },
      ],
      expectedModifiedAt: template.modifiedAt,
    });

    const copy = await client.createPage({
      notebookId: notebook!.id,
      sectionId: section!.id,
      parentPageId: null,
      orderKey: "b",
      title: "Meeting Notes",
      background: { color: null, ruleLines: "none" },
      templateId: template.id,
    });

    expect(copy.background).toEqual({ color: "#fffbe6", ruleLines: "college-ruled" });
    expect(copy.templateId).toBe(template.id);

    const copyDoc = await client.loadPageDocument({
      notebookId: notebook!.id,
      sectionId: section!.id,
      pageId: copy.id,
    });
    expect(copyDoc.objects).toHaveLength(1);
    expect(copyDoc.objects[0]!.id).not.toBe("obj-template-1");
    expect(copyDoc.objects[0]!.data).toEqual({ content: "Agenda" });

    // The source page's own objects are untouched by the copy.
    const templateDoc = await client.loadPageDocument({
      notebookId: notebook!.id,
      sectionId: section!.id,
      pageId: template.id,
    });
    expect(templateDoc.objects).toHaveLength(1);
    expect(templateDoc.objects[0]!.id).toBe("obj-template-1");
  });

  it("a null templateId behaves exactly as before: an empty page using the request's own background", async () => {
    const client = createFakeStorageClient();
    const [notebook] = await client.listNotebooks();
    const [section] = await client.listSections({ notebookId: notebook!.id, parentGroupId: null });

    const page = await client.createPage({
      notebookId: notebook!.id,
      sectionId: section!.id,
      parentPageId: null,
      orderKey: "a",
      title: "Untitled page",
      background: { color: null, ruleLines: "none" },
      templateId: null,
    });

    expect(page.templateId).toBeNull();
    const doc = await client.loadPageDocument({
      notebookId: notebook!.id,
      sectionId: section!.id,
      pageId: page.id,
    });
    expect(doc.objects).toEqual([]);
  });
});
