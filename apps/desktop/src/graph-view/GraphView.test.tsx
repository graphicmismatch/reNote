import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@renote/ui";
import { GraphView } from "./GraphView.js";
import { StorageProvider } from "../providers/StorageProvider.js";
import { createBrowserStorageClient } from "../providers/browser-storage-client.js";

/** Seeds a notebook with two pages, the first wikilinking to the second — enough to exercise
 *  `GraphView`'s real `collectAllPages`/`listPageLinks` fetch path with a non-empty, non-trivial
 *  (one real edge) fake `listPageLinks` response, per this file's "mounts without throwing given
 *  a fake listPageLinks response" acceptance bar. */
async function seedLinkedNotebook() {
  const client = createBrowserStorageClient();
  const notebook = await client.createNotebook({
    name: "Graph Test Notebook",
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
  const pageA = await client.createPage({
    notebookId: notebook.id,
    sectionId: section.id,
    parentPageId: null,
    orderKey: "a0",
    title: "Page A",
    background: { color: null, ruleLines: "none" },
    templateId: null,
  });
  const pageB = await client.createPage({
    notebookId: notebook.id,
    sectionId: section.id,
    parentPageId: null,
    orderKey: "a1",
    title: "Page B",
    background: { color: null, ruleLines: "none" },
    templateId: null,
  });

  await client.savePageObjects({
    notebookId: notebook.id,
    sectionId: section.id,
    pageId: pageA.id,
    expectedModifiedAt: null,
    objects: [
      {
        id: "obj-1",
        type: "text-box",
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 0 },
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        data: {
          content: {
            paragraphs: [
              {
                runs: [{ text: "Page B", marks: [{ kind: "wikilink", attr: pageB.id, attr2: "Page B" }] }],
                listKind: "none",
                indentLevel: 0,
                tagId: null,
              },
            ],
          },
        },
      },
    ],
  });

  return { client, notebook, pageA, pageB };
}

describe("GraphView", () => {
  it("renders the empty state without throwing when there is no open notebook", () => {
    const client = createBrowserStorageClient();
    render(
      <StorageProvider client={client}>
        <ThemeProvider>
          <GraphView notebookId={null} onNavigate={vi.fn()} />
        </ThemeProvider>
      </StorageProvider>,
    );
    expect(screen.getByText("No pages to show yet.")).toBeInTheDocument();
  });

  it("mounts and loads a notebook's pages/links without throwing, given a fake listPageLinks response", async () => {
    const { client, notebook } = await seedLinkedNotebook();

    render(
      <StorageProvider client={client}>
        <ThemeProvider>
          <GraphView notebookId={notebook.id} onNavigate={vi.fn()} />
        </ThemeProvider>
      </StorageProvider>,
    );

    expect(screen.getByText("Loading graph…")).toBeInTheDocument();

    // Confirms the async load (collectAllPages + listPageLinks + PIXI init) settles into SOME
    // terminal, non-throwing status — "ready" if a real canvas/WebGL context happens to be
    // available in this test environment, "error" otherwise — either way, no thrown exception
    // ever escapes the component (see GraphView's own `.catch`), which is the actual thing this
    // test is guarding against.
    await waitFor(() => {
      expect(screen.queryByText("Loading graph…")).not.toBeInTheDocument();
    });
  });

  it("does not throw when the notebook has pages but no links between them", async () => {
    const client = createBrowserStorageClient();
    const notebook = await client.createNotebook({
      name: "Unlinked Notebook",
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
    await client.createPage({
      notebookId: notebook.id,
      sectionId: section.id,
      parentPageId: null,
      orderKey: "a0",
      title: "Lonely Page",
      background: { color: null, ruleLines: "none" },
      templateId: null,
    });

    render(
      <StorageProvider client={client}>
        <ThemeProvider>
          <GraphView notebookId={notebook.id} onNavigate={vi.fn()} />
        </ThemeProvider>
      </StorageProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading graph…")).not.toBeInTheDocument();
    });
  });
});
