import type { PageLocationDto } from "@renote/storage-client";

/**
 * The explicit-location link syntax: `[[!Notebook@Section$Page#Heading`, addressing any page in
 * the workspace from any other, rather than relying on the plain `[[title` search finding the
 * right one. Each sigil introduces one level of the address:
 *
 * - `!` notebook, `@` section, `$` page, `#` heading within that page.
 *
 * Every level after the first is optional *while typing* — `!Research@Ide` is a perfectly valid
 * in-progress path, and `stage` says which level the user is still on, so the popover can list
 * that level's matches. An address is unambiguous once complete because `renote-commands`'
 * `naming` module keeps each of those names unique within its parent.
 *
 * A level left empty but closed off by the next sigil means "the one I'm already in": from
 * Notebook 1 > Section 1 > Page 1, `!@$#Heading 1` addresses
 * `!Notebook 1@Section 1$Page 1#Heading 1`, and `!@Section 2` stays inside Notebook 1. That only
 * applies to levels the user has moved *past* — the level still being typed stays empty-means-
 * everything, so a bare `[[!` still lists the whole workspace to browse.
 *
 * ponytail: sigils can't appear inside a name (a section literally named "A@B" is unaddressable
 * this way). Add escaping if anyone ever names something that.
 */
/** Where the page being linked *from* lives — what an omitted level falls back to. */
export type LinkPathContext = Pick<PageLocationDto, "notebookName" | "sectionName" | "pageTitle">;

export interface LinkPath {
  notebook: string;
  section: string;
  page: string;
  /** Heading within the target page, or `null` when no `#` was typed. Carried into the link's
   *  mark verbatim and matched by heading text when the link is followed (see `page-anchors.ts`'s
   *  `findAnchorObject`), so it needs no resolution here.
   *  ponytail: typed free-hand, never suggested — the target page's headings live in a page file
   *  this popover hasn't loaded, unlike the `[[#` flow's, which are on screen already. A heading
   *  that doesn't match simply lands on the page without scrolling. Load the target document to
   *  offer them if a mistyped anchor ever proves annoying. */
  anchor: string | null;
  /** The level the user is still typing — the one to match loosely (substring); everything
   *  before it is matched exactly. */
  stage: "notebook" | "section" | "page" | "anchor";
}

const LINK_PATH = /^!([^@$#]*)(?:@([^$#]*))?(?:\$([^#]*))?(?:#(.*))?$/;

/**
 * Parses an explicit-location query, or `null` if `query` isn't one (i.e. doesn't start with
 * `!`) — in which case the caller falls back to the ordinary `[[title` page search.
 *
 * `here` fills in the levels left empty behind a sigil (see this interface's doc comment).
 * Omitting it, or passing one for a page too new to be in the location list yet, just leaves
 * those levels empty, which matches everything — the behavior before defaults existed.
 */
export function parseLinkPath(query: string, here?: LinkPathContext): LinkPath | null {
  const match = LINK_PATH.exec(query);
  if (!match) return null;
  const [, notebook = "", section, page, anchor] = match;
  const stage =
    anchor !== undefined
      ? "anchor"
      : page !== undefined
        ? "page"
        : section !== undefined
          ? "section"
          : "notebook";

  /** A level defaults to `here`'s only when it is BOTH empty and already left behind — the one
   *  still being typed keeps its "empty lists everything" meaning. */
  const orHere = (typed: string | undefined, level: LinkPath["stage"], fallback: string) =>
    typed !== undefined && typed.trim() === "" && stage !== level ? fallback : (typed ?? "");

  return {
    notebook: orHere(notebook, "notebook", here?.notebookName ?? ""),
    section: orHere(section, "section", here?.sectionName ?? ""),
    page: orHere(page, "page", here?.pageTitle ?? ""),
    anchor: anchor ?? null,
    stage,
  };
}

function equalName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Loose match for the level currently being typed: an empty segment matches everything, so
 *  `[[!` immediately lists the whole workspace. */
function partialName(name: string, typed: string): boolean {
  const wanted = typed.trim().toLowerCase();
  return wanted === "" || name.toLowerCase().includes(wanted);
}

/**
 * The pages `path` currently addresses: every level before `path.stage` must match exactly, the
 * level being typed matches on substring. Always returns *pages* (never bare notebooks or
 * sections) even for a half-typed path, since a link needs a page to point at either way — so
 * `[[!Res` already narrows the list to pages in notebooks matching "Res", and each row's own
 * label (see `locationLabel`) is what tells them apart.
 */
export function matchLinkPath(path: LinkPath, locations: PageLocationDto[]): PageLocationDto[] {
  const matches = locations.filter((location) => {
    if (path.stage === "notebook") return partialName(location.notebookName, path.notebook);
    if (!equalName(location.notebookName, path.notebook)) return false;
    if (path.stage === "section") return partialName(location.sectionName, path.section);
    if (!equalName(location.sectionName, path.section)) return false;
    return partialName(location.pageTitle, path.page);
  });

  // Once the user has moved past the page level (an anchor is being typed), an exactly-matching
  // title wins outright — "Untitled page" must not drag "Untitled page 2" along with it. Kept as
  // a preference rather than a hard exact match so a still-abbreviated title (`$Rocket#Setup`)
  // doesn't empty the list out mid-typing.
  if (path.stage === "anchor" && path.page.trim() !== "") {
    const exact = matches.filter((location) => equalName(location.pageTitle, path.page));
    if (exact.length > 0) return exact;
  }
  return matches;
}

/** `Notebook > Section` — the "where this page lives" line shown under every link suggestion. */
export function locationLabel(location: PageLocationDto): string {
  return `${location.notebookName} > ${location.sectionName}`;
}
