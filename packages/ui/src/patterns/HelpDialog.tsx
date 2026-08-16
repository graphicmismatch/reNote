import { useEffect } from "react";
import { PixelButton } from "../primitives/PixelButton.js";
import "./HelpDialog.css";

export interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

interface HelpEntry {
  /** What the user is trying to do. */
  term: string;
  /** How to do it. */
  description: string;
}

interface HelpSection {
  title: string;
  entries: HelpEntry[];
}

/**
 * The whole help text, as data rather than markup, so the dialog below stays a dozen lines of
 * rendering and every future addition is one more object literal.
 *
 * Written to describe BEHAVIOR, not the current toolbar layout: it names no tool's number key
 * and no button's position, because both change and a wrong help page is worse than none. The
 * command palette (Mod+K) already lists every command with its live shortcut, so that is what
 * this points at for specifics.
 */
const HELP_SECTIONS: ReadonlyArray<HelpSection> = [
  {
    title: "Notebooks, sections, pages",
    entries: [
      {
        term: "Workspace",
        description:
          "Every notebook lives in one workspace folder on disk. Change it with the workspace button in the header.",
      },
      {
        term: "Structure",
        description:
          "A notebook holds sections. A section holds pages. Create each with the New Notebook, New Section, and New Page buttons in the sidebar.",
      },
      { term: "Rename", description: "Double-click a name in the sidebar tree, type, then press Enter." },
      {
        term: "Delete",
        description:
          "Delete Selected moves the deepest selected item — page, else section, else notebook — to the Trash panel.",
      },
      {
        term: "Move or reorder",
        description: "Drag a page or section in the sidebar tree to reorder it or drop it somewhere else.",
      },
      {
        term: "Templates",
        description: "Duplicate Page copies a page's content and background into a new page beside it.",
      },
      {
        term: "Subpages",
        description:
          "New Subpage, Indent Page, and Outdent Page (right-click a page, or the command palette) nest a page under another one in the tree.",
      },
      {
        term: "Quick Capture",
        description:
          "Mod+Shift+N drops a fresh, dated page into a Quick Notes section with the cursor ready to type.",
      },
    ],
  },
  {
    title: "Drawing",
    entries: [
      {
        term: "Tools",
        description:
          "Pick a tool from the toolbar, or press its number key. The command palette lists every tool with its shortcut.",
      },
      {
        term: "Pen and highlighter",
        description:
          "Draw with a pointer, a pen, or a finger. Set color and thickness in the Tool Settings panel while the tool is active.",
      },
      {
        term: "Erasers",
        description:
          "The stroke eraser removes a whole stroke at once. The pixel eraser removes only the part you drag across.",
      },
      { term: "Shapes", description: "Drag with a shape tool to draw a rectangle, ellipse, line, or arrow." },
      {
        term: "Select",
        description:
          "Click an object to select it. Shift-click to add more. Drag to move, drag a handle to resize, drag the top handle to rotate.",
      },
      { term: "Lasso", description: "Drag a free shape around several objects to select all of them." },
      {
        term: "Clean up ink",
        description:
          "Turn on Recognize shapes while drawing in Settings to have a drawn line, rectangle, or ellipse snap to a clean shape as you finish the stroke. Select ink and right-click it for Convert to Shape or Straighten Stroke afterward instead.",
      },
      {
        term: "Erase by scribbling",
        description:
          "A quick back-and-forth scribble over ink erases whatever it crosses, no eraser tool needed.",
      },
      {
        term: "Copy, cut, paste, duplicate",
        description:
          "Mod+C copies the selection, Mod+X cuts it, Mod+V pastes — text and images copied from outside reNote paste too. Mod+D duplicates the selection in place. Mod+A selects everything on the page; Delete removes the selection.",
      },
      {
        term: "Right-click menu",
        description:
          "Right-click the canvas, or a row in the sidebar tree, for a menu of commands for whatever is under the pointer, including Bring to Front and Send to Back for overlapping objects.",
      },
    ],
  },
  {
    title: "Text",
    entries: [
      {
        term: "Add a text box",
        description: "Pick the Text Box tool, then click or drag on the page. Type at once.",
      },
      { term: "Edit a text box", description: "Double-click it. Press Escape, or click elsewhere, to stop." },
      {
        term: "Markdown while you type",
        description:
          "Type # for a heading, - or 1. for a list, > for a quote, ``` for code, **bold**, *italic*, ~~strikethrough~~, `code`, and | a | b | rows for a table.",
      },
      {
        term: "Colors",
        description:
          "The toolbar above a text box sets the color of the selected text, the color and opacity of the box, and the default text color.",
      },
    ],
  },
  {
    title: "Audio",
    entries: [
      {
        term: "Record a clip",
        description:
          "The Record Audio button starts recording from the microphone. A floating panel shows elapsed time and a Stop button; stopping saves the clip onto the page.",
      },
      {
        term: "Play a clip",
        description: "Click an audio clip on the page to play it with an ordinary set of playback controls.",
      },
    ],
  },
  {
    title: "Tags",
    entries: [
      {
        term: "Create a tag",
        description: "Use the form at the bottom of the Tags panel. Set a kind, a color, and a name.",
      },
      {
        term: "Tag a paragraph",
        description:
          "Put the cursor in the paragraph, then pick the tag from the picker above the text box. The picker appears once the notebook has a tag.",
      },
      {
        term: "Insert Tag",
        description:
          "The Insert Tag button drops a tag onto the page as its own small box. It uses the tag selected in the Tags panel.",
      },
      {
        term: "Find tagged pages",
        description: "Click a tag in the Tags panel. The search results show every page that carries it.",
      },
      {
        term: "Jump to a tagged line",
        description:
          "Click a tag, then pick one of its listed paragraphs to open that page with the line found and centered.",
      },
    ],
  },
  {
    title: "Links",
    entries: [
      {
        term: "Link to a page",
        description:
          "Type [[ in a text box, then type part of the title. Pick a page from the list. Pages in every notebook are offered, not only this one.",
      },
      {
        term: "Suggested links",
        description:
          "Type [[ and pause before typing anything else: the list offers pages related in meaning to the one you are on, even if they share no words with your search.",
      },
      {
        term: "Link to a new page",
        description:
          "Type a title that no page has, then press Enter. The page is created in this section and linked.",
      },
      {
        term: "Link to an exact location",
        description:
          "Type [[! to address a page by its full location: !Notebook@Section$Page#Heading. Each part narrows the list. Leave a part empty to mean the one you are in, so !@$#Setup links to the heading “Setup” on this same page.",
      },
      {
        term: "Link to a spot on this page",
        description:
          "Type a heading first, for example “# Setup”. Then type [[# and pick that heading from the list.",
      },
      {
        term: "Link button",
        description:
          "The Insert Link button drops a navigation button onto the page. It holds a target and no text. Type a page title, or # for a heading on this page, then pick from the list.",
      },
      {
        term: "Follow a link",
        description:
          "Click a link button to go to its target. For a link inside a paragraph, edit the text box first, then click the link.",
      },
      {
        term: "Change a link button",
        description:
          "Shift-click the button to select it without following it. Then double-click it to pick a new target.",
      },
      {
        term: "See what points here",
        description: "The Linked Mentions panel lists every page that links to the open page.",
      },
      {
        term: "See the whole web",
        description: "Graph View draws each page as a dot and each link as a line.",
      },
    ],
  },
  {
    title: "Finding things",
    entries: [
      {
        term: "Search",
        description:
          "Type in the Search panel. Results cover page titles and page content; if too few match the exact words, pages related in meaning are offered too.",
      },
      {
        term: "Find in page",
        description: "Mod+F opens a bar that searches the open page and steps through matches with Enter.",
      },
      {
        term: "Related Notes",
        description:
          "The Related Notes panel lists pages closest in meaning to the open page, even ones sharing no exact words with it.",
      },
      { term: "Command palette", description: "Press Mod+K for every command, with its shortcut." },
      { term: "Minimap", description: "Shows the whole page. Click it to move the view." },
      { term: "Focus mode", description: "Press Mod+. to hide both sidebars." },
    ],
  },
  {
    title: "Page setup",
    entries: [
      {
        term: "Paper",
        description:
          "Page Background sets the paper color and the rule lines: college, wide, graph, or dots.",
      },
      {
        term: "Dark paper",
        description:
          "On a dark paper color, a pen still set to its default color switches to white, and back again.",
      },
    ],
  },
  {
    title: "Undo and safety",
    entries: [
      {
        term: "Undo",
        description: "Mod+Z undoes, Mod+Shift+Z redoes. The History panel jumps to any earlier step.",
      },
      {
        term: "Autosave",
        description:
          "The open page is saved on a timer. The Autosave panel restores the last snapshot. Set the interval in Settings.",
      },
      {
        term: "Trash",
        description: "Deleted items wait in the Trash panel until you restore them or empty it.",
      },
      {
        term: "Backup",
        description: "Back up a notebook to a .renotebackup.zip file, and restore one from the same file.",
      },
      {
        term: "Import and export",
        description:
          "Import a text file onto a page. Export a page, a section, or a notebook as PDF or Markdown.",
      },
      {
        term: "Changed outside reNote",
        description:
          "If a page's file changes outside reNote while it is open, a bar offers to keep your version or reload the other one from disk — nothing is overwritten silently.",
      },
    ],
  },
];

/**
 * The app's help page: what each part of reNote does and how to reach it. Built on the same
 * backdrop/panel/Escape-to-close chrome as `SettingsDialog`, since both are app-level modals and
 * a reader should not have to learn a second set of dialog behavior to read the manual.
 */
export function HelpDialog({ open, onClose }: HelpDialogProps): JSX.Element | null {
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="renote-help-dialog-backdrop" onClick={onClose}>
      <div
        className="renote-help-dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Help"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="renote-help-dialog-title-strip">
          <span className="renote-help-dialog-title">Help</span>
          <PixelButton type="button" onClick={onClose}>
            Close
          </PixelButton>
        </div>
        <p className="renote-help-dialog-intro">
          reNote is an infinite-canvas notebook. Draw, type, tag, and link anywhere on a page. Everything is
          stored as plain files in your workspace folder.
        </p>
        {HELP_SECTIONS.map((section) => (
          <section className="renote-help-dialog-section" key={section.title}>
            <h2 className="renote-help-dialog-section-title">{section.title}</h2>
            <dl className="renote-help-dialog-entry-list">
              {section.entries.map((entry) => (
                <div className="renote-help-dialog-entry" key={entry.term}>
                  <dt className="renote-help-dialog-entry-term">{entry.term}</dt>
                  <dd className="renote-help-dialog-entry-description">{entry.description}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
