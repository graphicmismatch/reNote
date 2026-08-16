import "./WorkspacePicker.css";
import { PixelButton } from "../primitives/PixelButton.js";

export interface WorkspacePickerProps {
  /**
   * Called when the user clicks the "Choose Workspace Folder..." button.
   * `packages/ui` has zero Tauri knowledge (boundary rule), so the actual
   * native directory-picker dialog call (the Tauri dialog plugin's
   * directory-mode `open`) lives in `apps/desktop`, which passes this
   * prop down.
   */
  onChooseFolder: () => void;
}

/**
 * Full-screen gate shown in place of the app when no workspace has been
 * chosen yet (first run, or a fresh install with nothing to migrate). See
 * `apps/desktop/src/providers/WorkspaceProvider.tsx`, which renders this
 * instead of `children` while `getWorkspacePath()` has resolved to `null`.
 */
export function WorkspacePicker({ onChooseFolder }: WorkspacePickerProps): JSX.Element {
  return (
    <div className="renote-workspace-picker-backdrop">
      <div
        className="renote-workspace-picker-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Choose Workspace"
      >
        <div className="renote-workspace-picker-title">Welcome to reNote</div>
        <p className="renote-workspace-picker-description">
          Choose a folder on your computer to store your notebooks in. This becomes your workspace — reNote
          will reopen it automatically next time.
        </p>
        <PixelButton type="button" onClick={onChooseFolder}>
          Choose Workspace Folder...
        </PixelButton>
      </div>
    </div>
  );
}
