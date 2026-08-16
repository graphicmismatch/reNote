//! The "names are unique within their parent" rule, enforced in one place for every
//! create/rename command that can introduce a duplicate:
//!
//! - a **notebook** name is unique within the workspace,
//! - a **section** name is unique within its notebook (across section groups, not just within
//!   one — sections nest, the rule doesn't),
//! - a **page** title is unique within its section.
//!
//! Together those make `Notebook > Section > Page` an unambiguous address for every page in the
//! workspace, which is exactly what the frontend's `[[!Notebook@Section$Page#Heading` link syntax
//! resolves against (see `crate::link::list_page_locations`).
//!
//! Two ways to apply it, and which one a command uses is the whole design here:
//!
//! - **Creating** something uses `free_*`, which appends `" 2"`, `" 3"`… to the requested name
//!   until it's free. Every create command is handed a generic default ("New Section",
//!   "Untitled page") that the user renames afterward, so clicking "New Page" twice has to make
//!   a second page rather than fail.
//! - **Renaming** something uses `ensure_*_free`, which errors. That name came from the user's
//!   own keystrokes, so a taken one must be reported back, never silently altered.
//!
//! ponytail: enforced at this command layer (the frontend's only funnel), not inside
//! `renote-storage`. Restore-from-trash and backup import move whole folders back into place
//! rather than going through any create/rename call, so they can still land a duplicate name;
//! push the rule down into `renote-storage`'s writes if that ever happens in practice.

use std::path::Path;

/// Case- and surrounding-whitespace-insensitive name equality — the comparison every check below
/// uses. Case-insensitive because notebook and section folders are named after these names (see
/// `renote_storage::notebook`'s module docs) and case-insensitive filesystems (macOS, Windows)
/// would collide on them anyway; applying the same rule to page titles keeps one rule, not three.
fn same_name(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

/// Whether `name` is already used by something other than `except_id` (the item being renamed —
/// a no-op rename to its own current name must stay legal).
fn is_taken(taken: &[(String, String)], name: &str, except_id: Option<&str>) -> bool {
    taken.iter().any(|(id, existing)| Some(id.as_str()) != except_id && same_name(existing, name))
}

/// `name`, or the first of `"<name> 2"`, `"<name> 3"`… that isn't taken.
fn free_variant(taken: &[(String, String)], name: &str) -> String {
    if !is_taken(taken, name, None) {
        return name.to_string();
    }
    // Bounded by the number of existing names + 1: each iteration rules one of them out, so this
    // always terminates well before `suffix` runs away.
    (2..)
        .map(|suffix| format!("{name} {suffix}"))
        .find(|candidate| !is_taken(taken, candidate, None))
        .expect("an unbounded suffix range always yields a free name")
}

/// `(id, name)` of every notebook directly under `root`.
fn taken_notebooks(root: &Path) -> Result<Vec<(String, String)>, String> {
    let notebooks = renote_storage::list_notebooks(root).map_err(|err| err.to_string())?;
    Ok(notebooks.into_iter().map(|n| (n.id, n.name)).collect())
}

/// `(id, name)` of every section in a notebook, at any nesting depth — read from that notebook's
/// own index, the only place that knows its whole section tree without a recursive folder walk.
fn taken_sections(notebook_dir: &Path, notebook_id: &str) -> Result<Vec<(String, String)>, String> {
    let conn =
        renote_index::open_or_rebuild(notebook_dir, notebook_id).map_err(|err| err.to_string())?;
    renote_index::list_section_names(&conn, notebook_id).map_err(|err| err.to_string())
}

/// `(id, title)` of every page in a section.
fn taken_pages(section_dir: &Path) -> Result<Vec<(String, String)>, String> {
    let pages = renote_storage::list_pages(section_dir).map_err(|err| err.to_string())?;
    Ok(pages.into_iter().map(|p| (p.id, p.title)).collect())
}

/// Fails unless `name` is free among the notebooks under `root`. For renames — see module docs.
pub fn ensure_notebook_name_free(
    root: &Path,
    name: &str,
    except_id: Option<&str>,
) -> Result<(), String> {
    if is_taken(&taken_notebooks(root)?, name, except_id) {
        return Err(format!("a notebook named \"{name}\" already exists in this workspace"));
    }
    Ok(())
}

/// Fails unless `name` is free among every section in the notebook. For renames.
pub fn ensure_section_name_free(
    notebook_dir: &Path,
    notebook_id: &str,
    name: &str,
    except_id: Option<&str>,
) -> Result<(), String> {
    if is_taken(&taken_sections(notebook_dir, notebook_id)?, name, except_id) {
        return Err(format!("a section named \"{name}\" already exists in this notebook"));
    }
    Ok(())
}

/// Fails unless `title` is free among the pages in `section_dir`. For renames.
pub fn ensure_page_title_free(
    section_dir: &Path,
    title: &str,
    except_id: Option<&str>,
) -> Result<(), String> {
    if is_taken(&taken_pages(section_dir)?, title, except_id) {
        return Err(format!("a page titled \"{title}\" already exists in this section"));
    }
    Ok(())
}

/// `name`, suffixed until free among the notebooks under `root`. For creation.
pub fn free_notebook_name(root: &Path, name: &str) -> Result<String, String> {
    Ok(free_variant(&taken_notebooks(root)?, name))
}

/// `name`, suffixed until free among the notebook's sections. For creation.
pub fn free_section_name(
    notebook_dir: &Path,
    notebook_id: &str,
    name: &str,
) -> Result<String, String> {
    Ok(free_variant(&taken_sections(notebook_dir, notebook_id)?, name))
}

/// `title`, suffixed until free among the section's pages. For creation.
pub fn free_page_title(section_dir: &Path, title: &str) -> Result<String, String> {
    Ok(free_variant(&taken_pages(section_dir)?, title))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn taken(names: &[&str]) -> Vec<(String, String)> {
        names.iter().enumerate().map(|(i, n)| (format!("id-{i}"), n.to_string())).collect()
    }

    #[test]
    fn same_name_ignores_case_and_surrounding_whitespace_only() {
        assert!(same_name("Recipes", " recipes "));
        assert!(same_name("Étude", "étude"));
        assert!(!same_name("Recipes", "Recipe"));
        assert!(!same_name("My Notes", "MyNotes"));
    }

    #[test]
    fn free_variant_counts_up_past_every_taken_name() {
        assert_eq!(free_variant(&taken(&["Other"]), "New Section"), "New Section");
        assert_eq!(free_variant(&taken(&["New Section"]), "New Section"), "New Section 2");
        assert_eq!(
            free_variant(&taken(&["new section", "New Section 2"]), "New Section"),
            "New Section 3"
        );
    }

    #[test]
    fn a_rename_never_conflicts_with_the_item_being_renamed() {
        let existing = taken(&["Recipes", "Research"]);
        assert!(is_taken(&existing, "recipes", None));
        assert!(!is_taken(&existing, "Recipes", Some("id-0")));
        assert!(is_taken(&existing, "Recipes", Some("id-1")));
    }

    #[test]
    fn names_are_checked_against_what_is_actually_on_disk() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path();

        let notebook = renote_storage::create_notebook(root, "Research", None).expect("notebook");
        assert!(ensure_notebook_name_free(root, "research", None).is_err());
        assert!(ensure_notebook_name_free(root, "Research", Some(&notebook.id)).is_ok());
        assert_eq!(free_notebook_name(root, "Research").expect("free"), "Research 2");

        let notebook_dir = Path::new(&notebook.path).to_path_buf();
        let section =
            renote_storage::create_section(&notebook_dir, &notebook.id, None, "Ideas", None, "a0")
                .expect("section");
        let section_dir = renote_storage::section_dir(&notebook_dir, &section.id);
        let page = renote_storage::create_page(
            &section_dir,
            &section.id,
            None,
            "a0",
            "Rocket Notes",
            renote_storage::PageBackground {
                color: None,
                rule_lines: renote_storage::PageRuleLines::None,
            },
            None,
        )
        .expect("page");

        assert!(ensure_page_title_free(&section_dir, "rocket notes", None).is_err());
        assert!(ensure_page_title_free(&section_dir, "Rocket Notes", Some(&page.id)).is_ok());
        assert_eq!(free_page_title(&section_dir, "Rocket Notes").expect("free"), "Rocket Notes 2");
        assert_eq!(free_page_title(&section_dir, "Untitled page").expect("free"), "Untitled page");
    }
}
