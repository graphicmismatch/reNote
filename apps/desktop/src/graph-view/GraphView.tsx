import { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { darkChromeTokens, lightChromeTokens, useTheme } from "@renote/ui";
import type { PageLinkDto, StorageClient } from "@renote/storage-client";
import { useStorageClient } from "../providers/StorageProvider.js";
import "./GraphView.css";

export interface GraphViewProps {
  /** No graph to show without an open notebook — renders the empty state until one is set. */
  notebookId: string | null;
  /** Fired when a node is clicked, with that page's owning section id and its own id — the
   *  caller wires this to open the page in the editor and switch `viewMode` back to `"editor"`. */
  onNavigate: (sectionId: string, pageId: string) => void;
}

interface GraphNode {
  id: string;
  title: string;
  sectionId: string;
  x: number;
  y: number;
}

/**
 * Recursively collects every page directly or indirectly under `parentGroupId` (`null` = the
 * notebook's top level) — the same recursive section/section-group walk `AppShell.tsx`'s
 * `buildGroupLevel`/`buildTreeNodes` already perform for the navigation tree, reimplemented here
 * flattened to "just give me every page in the notebook" rather than a lazily-expanded tree,
 * since the graph view always wants the whole notebook's pages at once as graph nodes.
 */
async function collectAllPages(
  client: StorageClient,
  notebookId: string,
  parentGroupId: string | null,
): Promise<GraphNode[]> {
  const [groups, sections] = await Promise.all([
    client.listSectionGroups({ notebookId, parentGroupId }),
    client.listSections({ notebookId, parentGroupId }),
  ]);

  const nodes: GraphNode[] = [];
  for (const section of sections) {
    const pages = await client.listPages({ notebookId, sectionId: section.id });
    for (const page of pages) {
      nodes.push({ id: page.id, title: page.title, sectionId: section.id, x: 0, y: 0 });
    }
  }
  for (const group of groups) {
    nodes.push(...(await collectAllPages(client, notebookId, group.id)));
  }
  return nodes;
}

const REPULSION = 12000;
const SPRING_LENGTH = 160;
const SPRING_STRENGTH = 0.02;
const CENTERING_STRENGTH = 0.01;
const ITERATIONS = 300;
const NODE_RADIUS = 24;

/**
 * A small hand-rolled force-directed layout — naive O(n²) pairwise repulsion plus spring-modeled
 * edges pulling linked nodes toward a rest length, run for a FIXED number of iterations rather
 * than a live `requestAnimationFrame` physics loop. A static one-shot layout computed once per
 * data load is simpler than live physics and adequate at the realistic personal-notebook page
 * counts (dozens to low hundreds) this project targets — no `d3-force`/Barnes-Hut needed. Mutates
 * `nodes`' `x`/`y` in place.
 *
 * Self-link edges (`sourcePageId === targetPageId`) contribute no spring force — there is no
 * meaningful "pull a node toward itself" — so they're filtered out of the physics inputs (but
 * still rendered separately, see `GraphView`'s draw step below, which just skips drawing a
 * visible line for them rather than treating them as an error).
 */
function runForceLayout(nodes: GraphNode[], edges: PageLinkDto[], width: number, height: number): void {
  if (nodes.length === 0) return;
  const indexOf = new Map(nodes.map((node, index) => [node.id, index]));
  const centerX = width / 2;
  const centerY = height / 2;

  // Circular initial placement — deterministic and already a reasonable starting layout before
  // any iterations run at all.
  nodes.forEach((node, index) => {
    const angle = (index / nodes.length) * Math.PI * 2;
    const radius = Math.min(width, height) / 3;
    node.x = centerX + radius * Math.cos(angle);
    node.y = centerY + radius * Math.sin(angle);
  });

  const springPairs = edges
    .map((edge) => ({ a: indexOf.get(edge.sourcePageId), b: indexOf.get(edge.targetPageId) }))
    .filter(
      (pair): pair is { a: number; b: number } =>
        pair.a !== undefined && pair.b !== undefined && pair.a !== pair.b,
    );

  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    const dx = new Array<number>(nodes.length).fill(0);
    const dy = new Array<number>(nodes.length).fill(0);

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        let deltaX = a.x - b.x;
        let deltaY = a.y - b.y;
        let distSq = deltaX * deltaX + deltaY * deltaY;
        if (distSq < 1) {
          // Coincident (or nearly) points: nudge apart deterministically by index parity rather
          // than dividing by ~zero below.
          deltaX = i % 2 === 0 ? 1 : -1;
          deltaY = j % 2 === 0 ? 1 : -1;
          distSq = deltaX * deltaX + deltaY * deltaY;
        }
        const dist = Math.sqrt(distSq);
        const force = REPULSION / distSq;
        const fx = (deltaX / dist) * force;
        const fy = (deltaY / dist) * force;
        dx[i] = (dx[i] ?? 0) + fx;
        dy[i] = (dy[i] ?? 0) + fy;
        dx[j] = (dx[j] ?? 0) - fx;
        dy[j] = (dy[j] ?? 0) - fy;
      }
    }

    for (const { a, b } of springPairs) {
      const nodeA = nodes[a]!;
      const nodeB = nodes[b]!;
      const deltaX = nodeB.x - nodeA.x;
      const deltaY = nodeB.y - nodeA.y;
      const dist = Math.max(1, Math.sqrt(deltaX * deltaX + deltaY * deltaY));
      const force = (dist - SPRING_LENGTH) * SPRING_STRENGTH;
      const fx = (deltaX / dist) * force;
      const fy = (deltaY / dist) * force;
      dx[a] = (dx[a] ?? 0) + fx;
      dy[a] = (dy[a] ?? 0) + fy;
      dx[b] = (dx[b] ?? 0) - fx;
      dy[b] = (dy[b] ?? 0) - fy;
    }

    nodes.forEach((node, index) => {
      const centeringX = (centerX - node.x) * CENTERING_STRENGTH;
      const centeringY = (centerY - node.y) * CENTERING_STRENGTH;
      node.x += (dx[index] ?? 0) + centeringX;
      node.y += (dy[index] ?? 0) + centeringY;
    });
  }
}

/** Re-centers/scales `nodes` in place so the whole laid-out graph fits within `width`x`height`
 *  with `padding` on every side, regardless of how spread out the simulation left it. */
function fitToViewport(nodes: GraphNode[], width: number, height: number, padding: number): void {
  if (nodes.length === 0) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x);
    maxY = Math.max(maxY, node.y);
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const scale = nodes.length === 1 ? 1 : Math.min(1, availableWidth / spanX, availableHeight / spanY);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  for (const node of nodes) {
    node.x = width / 2 + (node.x - midX) * scale;
    node.y = height / 2 + (node.y - midY) * scale;
  }
}

/**
 * A top-level, standalone view of a notebook's page-link structure: every page as a labeled
 * circle node, every wikilink (`page_link` row) as an edge between two nodes, laid out with the
 * small hand-rolled force simulation above. Deliberately does NOT reuse `PageEngine`/
 * `PixiRenderer` — both are built tightly around one page's `SceneGraph`/`ObjectTypeRegistry`
 * content model (`PixiRenderer.syncObject` requires a `PageObject`, the wrong shape entirely for
 * a graph node) — so this mounts its own fresh, minimal `PIXI.Application` directly, independent
 * of `canvas-engine`.
 *
 * A page linking to itself (a self-link) renders as a node with no visible self-loop line (drawn
 * would just be a zero-length segment) but is otherwise a completely ordinary node — clicking it
 * navigates to that page like any other.
 */
export function GraphView({ notebookId, onNavigate }: GraphViewProps) {
  const client = useStorageClient();
  const { mode } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "empty" | "ready" | "error">("loading");

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !notebookId) {
      setStatus("empty");
      return;
    }

    let cancelled = false;
    let mounted = false;
    const app = new PIXI.Application();
    const tokens = mode === "dark" ? darkChromeTokens : lightChromeTokens;

    setStatus("loading");

    Promise.all([collectAllPages(client, notebookId, null), client.listPageLinks({ notebookId })])
      .then(async ([nodes, edges]) => {
        if (cancelled) return;
        const width = container.clientWidth || 800;
        const height = container.clientHeight || 600;

        await app.init({
          width,
          height,
          backgroundColor: tokens.colorBackground,
          backgroundAlpha: 1,
          antialias: true,
          resizeTo: container,
        });
        if (cancelled) {
          app.destroy(true, { children: true });
          return;
        }
        container.appendChild(app.canvas);
        mounted = true;

        if (nodes.length === 0) {
          setStatus("empty");
          return;
        }

        runForceLayout(nodes, edges, width, height);
        fitToViewport(nodes, width, height, NODE_RADIUS * 2 + 20);
        const nodeById = new Map(nodes.map((node) => [node.id, node]));

        // Edges first, so node circles/labels always draw on top of the lines connecting them.
        const edgeGraphics = new PIXI.Graphics();
        app.stage.addChild(edgeGraphics);
        for (const edge of edges) {
          const from = nodeById.get(edge.sourcePageId);
          const to = nodeById.get(edge.targetPageId);
          if (!from || !to || from.id === to.id) continue; // self-links: no visible line to draw
          edgeGraphics
            .moveTo(from.x, from.y)
            .lineTo(to.x, to.y)
            .stroke({ width: 1, color: tokens.colorForeground, alpha: 0.6 });
        }

        for (const node of nodes) {
          const nodeContainer = new PIXI.Container();
          nodeContainer.eventMode = "static";
          nodeContainer.cursor = "pointer";
          nodeContainer.position.set(node.x, node.y);

          const circle = new PIXI.Graphics()
            .circle(0, 0, NODE_RADIUS)
            .fill({ color: tokens.colorBackground })
            .stroke({ width: 1, color: tokens.colorForeground });
          nodeContainer.addChild(circle);

          const label = new PIXI.Text({
            text: node.title,
            style: {
              fontFamily: "monospace",
              fontSize: 11,
              fill: tokens.colorForeground,
              wordWrap: true,
              wordWrapWidth: NODE_RADIUS * 4,
              align: "center",
            },
          });
          label.anchor.set(0.5, 0);
          label.position.set(0, NODE_RADIUS + 4);
          nodeContainer.addChild(label);

          nodeContainer.on("pointertap", () => {
            onNavigate(node.sectionId, node.id);
          });

          app.stage.addChild(nodeContainer);
        }

        setStatus("ready");
      })
      .catch((error: unknown) => {
        console.error("Failed to load graph view data.", error);
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      if (mounted) {
        app.destroy(true, { children: true });
      }
    };
  }, [client, notebookId, mode, onNavigate]);

  return (
    <div className="renote-graph-view">
      <div ref={containerRef} className="renote-graph-view-canvas" />
      {status === "loading" && <div className="renote-graph-view-message">Loading graph…</div>}
      {status === "empty" && <div className="renote-graph-view-message">No pages to show yet.</div>}
      {status === "error" && (
        <div className="renote-graph-view-message">Failed to load the graph. See console for details.</div>
      )}
    </div>
  );
}
