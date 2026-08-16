mod asset;
mod audio;
mod autosave;
mod backup;
pub mod dto;
mod export;
mod import;
mod library;
mod link;
mod naming;
mod notebook;
mod page;
mod search;
mod section;
mod semantic;
mod system;
mod tag;
mod trash;
mod workspace;

/// Registers every Tauri command this crate owns onto the given builder.
/// Called from the root `renote_lib::run()`, which is the only place
/// `tauri::generate_context!()` is invoked (see that crate's doc comment
/// for why). Generic over `Runtime` so this crate never needs to know
/// which concrete Tauri runtime is in use.
pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.manage(audio::AudioCaptureState::default()).invoke_handler(tauri::generate_handler![
        system::app_version,
        notebook::list_notebooks,
        notebook::create_notebook,
        notebook::rename_notebook,
        section::list_sections,
        section::list_section_groups,
        section::create_section,
        section::create_section_group,
        section::rename_section,
        section::rename_section_group,
        section::move_section,
        section::move_section_group,
        page::list_pages,
        page::create_page,
        page::load_page_objects,
        page::save_page_objects,
        page::update_page_background,
        page::rename_page,
        page::set_page_parent,
        page::move_page,
        page::reorder_pages,
        search::search,
        trash::trash_notebook,
        trash::trash_section_group,
        trash::trash_section,
        trash::trash_page,
        trash::list_trash,
        trash::restore_from_trash,
        trash::empty_trash_entry,
        trash::empty_trash,
        backup::export_notebook_backup,
        backup::import_notebook_backup,
        workspace::get_workspace_path,
        workspace::set_workspace_path,
        workspace::list_recent_workspace_paths,
        tag::list_tags,
        tag::create_tag,
        tag::update_tag,
        tag::delete_tag,
        tag::list_tagged_paragraphs,
        autosave::get_autosave_status,
        autosave::restore_autosave,
        autosave::save_autosave,
        asset::save_image_asset,
        asset::save_audio_asset,
        asset::resolve_asset_path,
        asset::read_audio_asset,
        asset::copy_page_asset,
        asset::delete_page_asset,
        import::import_plain_text_file,
        export::export_page_pdf,
        export::export_section_pdf,
        export::export_notebook_pdf,
        export::export_page_plain_text,
        export::export_page_markdown,
        export::export_section_markdown,
        export::export_notebook_markdown,
        link::list_backlinks,
        link::resolve_wikilink_target,
        link::create_linked_page,
        link::list_page_links,
        link::list_page_locations,
        semantic::find_related_pages,
        audio::start_native_audio_capture,
        audio::stop_native_audio_capture,
    ])
}
