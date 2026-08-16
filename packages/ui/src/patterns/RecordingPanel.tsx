import { PixelButton } from "../primitives/PixelButton.js";
import "./RecordingPanel.css";

export interface RecordingPanelProps {
  /** Wall-clock seconds elapsed since recording started, ticked by the caller. */
  elapsedSeconds: number;
  onStop: () => void;
}

function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

/**
 * A small floating panel shown while `AppShell.handleRecordAudio` has a `MediaRecorder` running
 * (Phase 12) — same "fixed, top-right, pixel-bordered" shape `FindBar` already uses. Purely
 * presentational: the caller owns the recorder and the elapsed-time ticker.
 */
export function RecordingPanel({ elapsedSeconds, onStop }: RecordingPanelProps) {
  return (
    <div className="renote-recording-panel" role="status">
      <span className="renote-recording-panel-dot" aria-hidden="true" />
      <span>Recording… {formatElapsed(elapsedSeconds)}</span>
      <PixelButton type="button" onClick={onStop}>
        Stop
      </PixelButton>
    </div>
  );
}
