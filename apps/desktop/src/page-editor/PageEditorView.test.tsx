import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AddObjectCommand, type PageEngine } from "@renote/canvas-engine";
import type { PageObject } from "@renote/core";
import { ThemeProvider } from "@renote/ui";
import type { StorageClient } from "@renote/storage-client";
import { PageEditorView } from "./PageEditorView.js";
import { StorageProvider } from "../providers/StorageProvider.js";
import { createFakeStorageClient } from "../providers/fake-storage-client.js";

async function seedPage() {
  const client = createFakeStorageClient();
  const notebook = await client.createNotebook({
    name: "Conflict Test Notebook",
    color: null,
    parentDirectory: null,
  });
  const section = await client.createSection({
    notebookId: notebook.id,
    parentGroupId: null,
    name: "Section",
    color: null,
    orderKey: "a0",
  });
  const page = await client.createPage({
    notebookId: notebook.id,
    sectionId: section.id,
    parentPageId: null,
    orderKey: "a0",
    title: "Page",
    background: { color: null, ruleLines: "none" },
    templateId: null,
  });
  return { client, notebookId: notebook.id, sectionId: section.id, pageId: page.id };
}

function inkStroke(id: string): PageObject {
  return {
    id,
    type: "ink-stroke",
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 0 },
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    data: { pointDataAssetPath: "", color: "#000000", width: 2, tool: "pen" },
  } as unknown as PageObject;
}

/** Rewrites the page behind the editor's back, the way a sync client or another window would. */
async function changePageExternally(
  client: StorageClient,
  ids: { notebookId: string; sectionId: string; pageId: string },
) {
  await client.savePageObjects({ ...ids, objects: [], expectedModifiedAt: null });
}

describe("PageEditorView external-change conflict", () => {
  it("refuses to clobber an externally changed page, then saves on Keep mine", async () => {
    const { client, ...ids } = await seedPage();
    let engine: PageEngine | null = null;

    render(
      <ThemeProvider>
        <StorageProvider client={client}>
          <PageEditorView
            {...ids}
            activeToolId="select"
            onEngineReady={(ready) => {
              engine = ready;
            }}
          />
        </StorageProvider>
      </ThemeProvider>,
    );

    await waitFor(() => expect(engine).not.toBeNull());
    const ready = engine as unknown as PageEngine;

    await changePageExternally(client, ids);
    ready.commands.execute(new AddObjectCommand(inkStroke("obj-1")));

    // The debounced save fires, the guard rejects it, and the bar appears instead of the edit
    // silently overwriting whatever the external change wrote.
    const bar = await screen.findByRole("alert", {}, { timeout: 3000 });
    expect(bar).toHaveTextContent("changed outside reNote");
    const saved = await client.loadPageDocument(ids);
    expect(saved.objects).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    const overwritten = await client.loadPageDocument(ids);
    expect(overwritten.objects).toHaveLength(1);
  });

  it("does not report a conflict for the app's own rename of the open page", async () => {
    const { client, ...ids } = await seedPage();
    let engine: PageEngine | null = null;
    // Stable identity on purpose: `onEngineReady` is in the mount effect's dependency list, so a
    // fresh arrow per render would remount (and dispose) the engine on every `rerender`.
    const captureEngine = (ready: PageEngine) => {
      engine = ready;
    };
    const view = (revision?: { pageId: string; modifiedAt: string }) => (
      <ThemeProvider>
        <StorageProvider client={client}>
          <PageEditorView
            {...ids}
            activeToolId="select"
            pageRevision={revision}
            onEngineReady={captureEngine}
          />
        </StorageProvider>
      </ThemeProvider>
    );

    const { rerender } = render(view());
    await waitFor(() => expect(engine).not.toBeNull());
    const ready = engine as unknown as PageEngine;

    // A rename stamps a fresh `modifiedAt` on the same page file, exactly like an external
    // change would — `AppShell` hands the new one back down, so this must not conflict.
    const renamed = await client.renamePage({ ...ids, title: "Renamed" });
    rerender(view({ pageId: ids.pageId, modifiedAt: renamed.modifiedAt }));

    ready.commands.execute(new AddObjectCommand(inkStroke("obj-1")));

    await waitFor(async () => expect((await client.loadPageDocument(ids)).objects).toHaveLength(1), {
      timeout: 3000,
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
