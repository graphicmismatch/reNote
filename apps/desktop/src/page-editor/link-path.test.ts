import type { PageLocationDto } from "@renote/storage-client";
import { describe, expect, it } from "vitest";
import { locationLabel, matchLinkPath, parseLinkPath } from "./link-path.js";

function location(notebookName: string, sectionName: string, pageTitle: string): PageLocationDto {
  return {
    pageId: `${notebookName}/${sectionName}/${pageTitle}`,
    pageTitle,
    sectionId: `${notebookName}/${sectionName}`,
    sectionName,
    notebookId: notebookName,
    notebookName,
  };
}

const workspace = [
  location("Research", "Ideas", "Rocket Notes"),
  location("Research", "Ideas", "Budget"),
  location("Research", "Archive", "Rocket Notes"),
  location("Recipes", "Dinner", "Chili"),
];

describe("parseLinkPath", () => {
  it("returns null for an ordinary title query", () => {
    expect(parseLinkPath("Rocket Notes")).toBeNull();
    expect(parseLinkPath("#Setup")).toBeNull();
  });

  it("reports which level is still being typed", () => {
    expect(parseLinkPath("!Res")?.stage).toBe("notebook");
    expect(parseLinkPath("!Research@")?.stage).toBe("section");
    expect(parseLinkPath("!Research@Ideas$")?.stage).toBe("page");
    expect(parseLinkPath("!Research@Ideas$Rocket Notes#Set")?.stage).toBe("anchor");
  });

  it("splits a full path, keeping the anchor null until a # is typed", () => {
    expect(parseLinkPath("!Research@Ideas$Rocket Notes")).toMatchObject({
      notebook: "Research",
      section: "Ideas",
      page: "Rocket Notes",
      anchor: null,
    });
    expect(parseLinkPath("!Research@Ideas$Rocket Notes#Setup")?.anchor).toBe("Setup");
  });
});

describe("parseLinkPath with a current location", () => {
  const here = { notebookName: "Research", sectionName: "Ideas", pageTitle: "Rocket Notes" };

  it("fills in every level left empty behind a sigil", () => {
    expect(parseLinkPath("!@$#Heading 1", here)).toMatchObject({
      notebook: "Research",
      section: "Ideas",
      page: "Rocket Notes",
      anchor: "Heading 1",
    });
  });

  it("fills only the levels moved past, never the one being typed", () => {
    // `!` — still on the notebook level, so it lists everything rather than snapping to "Research".
    expect(parseLinkPath("!", here)?.notebook).toBe("");
    expect(parseLinkPath("!@", here)).toMatchObject({ notebook: "Research", section: "" });
    expect(parseLinkPath("!@$", here)).toMatchObject({
      notebook: "Research",
      section: "Ideas",
      page: "",
    });
  });

  it("leaves an explicitly typed level alone", () => {
    expect(parseLinkPath("!Recipes@$Chili", here)).toMatchObject({
      notebook: "Recipes",
      section: "Ideas",
      page: "Chili",
    });
  });
});

describe("matchLinkPath", () => {
  const match = (query: string) =>
    matchLinkPath(parseLinkPath(query)!, workspace).map((l) => `${l.sectionName}/${l.pageTitle}`);

  it("lists the whole workspace for a bare !", () => {
    expect(match("!")).toHaveLength(4);
  });

  it("narrows by substring at the level being typed", () => {
    expect(match("!Rec")).toEqual(["Dinner/Chili"]);
    expect(match("!Research@Arch")).toEqual(["Archive/Rocket Notes"]);
  });

  it("requires an exact match on every level already completed", () => {
    // "Research" and "Recipes" both contain "Re", but once `@` is typed the notebook is settled.
    expect(match("!Re@Ideas")).toEqual([]);
    expect(match("!Research@Ideas$Rocket")).toEqual(["Ideas/Rocket Notes"]);
  });

  it("still resolves a page when an anchor is being typed", () => {
    expect(match("!Research@Ideas$Rocket Notes#Set")).toEqual(["Ideas/Rocket Notes"]);
  });

  it("resolves an all-defaulted path back to the page it was typed on", () => {
    const here = { notebookName: "Research", sectionName: "Ideas", pageTitle: "Rocket Notes" };
    const path = parseLinkPath("!@$#Heading 1", here)!;
    expect(matchLinkPath(path, workspace).map((l) => l.pageId)).toEqual(["Research/Ideas/Rocket Notes"]);
    expect(path.anchor).toBe("Heading 1");
  });

  it("prefers an exactly-matching title once an anchor is being typed", () => {
    const wider = [...workspace, location("Research", "Ideas", "Rocket Notes 2")];
    const here = { notebookName: "Research", sectionName: "Ideas", pageTitle: "Rocket Notes" };
    // Substring alone would drag "Rocket Notes 2" in behind "Rocket Notes".
    expect(matchLinkPath(parseLinkPath("!@$#Setup", here)!, wider).map((l) => l.pageTitle)).toEqual([
      "Rocket Notes",
    ]);
    // An abbreviated title still matches loosely — nothing is exact, so the list stays useful.
    expect(matchLinkPath(parseLinkPath("!@$Rocket#Setup", here)!, wider).map((l) => l.pageTitle)).toEqual([
      "Rocket Notes",
      "Rocket Notes 2",
    ]);
  });

  it("separates same-titled pages in different sections by their location label", () => {
    const hits = matchLinkPath(parseLinkPath("!Research@")!, workspace).filter(
      (l) => l.pageTitle === "Rocket Notes",
    );
    expect(hits.map(locationLabel)).toEqual(["Research > Ideas", "Research > Archive"]);
  });
});
