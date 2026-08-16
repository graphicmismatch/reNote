import { EventBus } from "@renote/core";

/**
 * {color, width} for one ink-producing or size-bearing tool (pen, highlighter, a shape tool,
 * an eraser's radius). `color` is meaningless for eraser tools — they just never read it —
 * rather than splitting into two registry types, since every consumer already keys by tool id
 * and only reads the fields it cares about.
 */
export interface InkToolSettings {
  color: string;
  width: number;
}

export interface InkSettingsChangedPayload {
  toolId: string;
  settings: InkToolSettings;
}

export interface InkSettingsEvents extends Record<string, unknown> {
  changed: InkSettingsChangedPayload;
}

/**
 * Per-tool-id mutable `{color, width}` settings, read live by `PenTool`/`ShapeTool`/eraser
 * tools on every stroke rather than baked in once at construction. This is what lets a
 * color/width picker in apps/desktop change what the *next* gesture looks like without
 * recreating the tool instance (which would lose in-progress gesture state) or threading a
 * prop through every tool class individually. Each tool id is independent — the highlighter
 * never shares the pen's color, and each shape kind/eraser has its own entry.
 *
 * `register()` seeds a tool's starting values (called once by `registerBuiltInTools`, before
 * any UI can read/write); `setColor`/`setWidth` are the live mutation path a settings UI calls.
 */
export class InkSettingsRegistry {
  readonly events = new EventBus<InkSettingsEvents>();
  private readonly settings = new Map<string, InkToolSettings>();
  /**
   * Tool ids whose color has never been explicitly set by the user via `setColor` since this
   * registry instance was created (or last re-registered fresh). Only `setDefaultColor` (the
   * auto black/white ink-switch's sole write path) consults this — it's what lets the
   * auto-switch keep steering a tool's color as the page background changes, but only until
   * the user picks a color of their own, at which point their choice must survive every future
   * background change unchanged.
   */
  private readonly stillAtDefaultColor = new Set<string>();

  /**
   * Seeds a tool's starting values — a no-op if the tool id already has an entry, so it's
   * safe to call every time `registerBuiltInTools` runs (once per `PageEngine` mount, e.g.
   * on every page switch in `apps/desktop`) without clobbering a value the user already
   * chose on a shared registry instance that outlives any single mount. For that same reason,
   * a tool already marked as user-customized (see `stillAtDefaultColor`) is NOT reset back to
   * "still default" by a later re-registration — only a brand-new registry instance (e.g. a
   * full page reload) starts a tool fresh.
   */
  register(toolId: string, defaults: InkToolSettings): void {
    if (this.settings.has(toolId)) return;
    this.settings.set(toolId, defaults);
    this.stillAtDefaultColor.add(toolId);
  }

  get(toolId: string): InkToolSettings | undefined {
    return this.settings.get(toolId);
  }

  setColor(toolId: string, color: string): void {
    const current = this.settings.get(toolId);
    if (!current) return;
    // The user (via ToolSettingsPanel's color picker, the only caller of this method) has now
    // explicitly chosen this tool's color — permanently disqualify it from the auto black/white
    // ink-switch until this registry itself is reseeded (see `stillAtDefaultColor`'s doc comment).
    this.stillAtDefaultColor.delete(toolId);
    const next = { ...current, color };
    this.settings.set(toolId, next);
    this.events.emit("changed", { toolId, settings: next });
  }

  setWidth(toolId: string, width: number): void {
    const current = this.settings.get(toolId);
    if (!current) return;
    const next = { ...current, width };
    this.settings.set(toolId, next);
    this.events.emit("changed", { toolId, settings: next });
  }

  /**
   * Writes a tool's color ONLY if it's still at its seeded default (see `stillAtDefaultColor`)
   * — a silent no-op otherwise. This is the one and only write path the auto black/white
   * ink-switch (`apps/desktop`'s `applyAutoInkColorForBackground`) is allowed to call: unlike
   * `setColor`, it never marks the tool as user-customized, so it can keep being called again on
   * every future background change without ever fighting a color the user picked themselves.
   */
  setDefaultColor(toolId: string, color: string): void {
    if (!this.stillAtDefaultColor.has(toolId)) return;
    const current = this.settings.get(toolId);
    if (!current) return;
    const next = { ...current, color };
    this.settings.set(toolId, next);
    this.events.emit("changed", { toolId, settings: next });
  }
}
