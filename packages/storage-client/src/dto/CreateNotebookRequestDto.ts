/**
 * Request for the `create_notebook` command. `parent_directory` is an
 * optional absolute-path override; when omitted, the command falls back
 * to the app's default library root (see `crate::library`).
 */
export type CreateNotebookRequestDto = { name: string; color: string | null; parentDirectory: string | null };
