import type { EditableCommand, PageObject, PageObjectId } from "@renote/core";
import type { SceneGraph } from "../scene/scene-graph.js";

/** Adds a fresh object to the scene; undo removes it again. */
export class AddObjectCommand implements EditableCommand<SceneGraph> {
  readonly id: string;
  readonly label: string;
  readonly kind: string;

  constructor(private readonly object: PageObject) {
    this.id = `add-${object.id}`;
    this.label = `Add ${object.type}`;
    this.kind = object.type;
  }

  do(scene: SceneGraph): void {
    scene.add(this.object);
  }

  undo(scene: SceneGraph): void {
    scene.remove(this.object.id);
  }
}

/** Removes an existing object from the scene; undo re-adds the exact object that was removed. */
export class RemoveObjectCommand implements EditableCommand<SceneGraph> {
  readonly id: string;
  readonly label: string;
  readonly kind: string;

  constructor(private readonly object: PageObject) {
    this.id = `remove-${object.id}`;
    this.label = `Remove ${object.type}`;
    this.kind = object.type;
  }

  do(scene: SceneGraph): void {
    scene.remove(this.object.id);
  }

  undo(scene: SceneGraph): void {
    scene.add(this.object);
  }
}

/**
 * Replaces an object's data/transform/bounds wholesale. The previous state is normally captured
 * at construction time — read from the scene graph via `objectId` and deep-cloned via
 * `structuredClone` before the caller mutates anything — so a later in-place mutation of the
 * live object (e.g. `UpdateObjectCommand` running through this class again) can never
 * retroactively corrupt what `undo` restores.
 *
 * `explicitPrevious` overrides that auto-capture: a caller that already live-mutated the scene
 * itself for gesture preview (e.g. `SelectTool` calling `scene.update()` on every pointermove of
 * a drag, exactly like `PenTool`/`ShapeTool`'s existing live-preview pattern) would otherwise
 * have this constructor capture the *last live-preview frame* as "previous" instead of the
 * object's true pre-gesture state, corrupting undo. Pass the object snapshotted before the first
 * live mutation instead; omitted, behavior is identical to before this parameter existed.
 */
export class UpdateObjectCommand implements EditableCommand<SceneGraph> {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  private readonly previous: PageObject;

  constructor(
    scene: SceneGraph,
    objectId: PageObjectId,
    private readonly next: PageObject,
    explicitPrevious?: PageObject,
  ) {
    const source = explicitPrevious ?? scene.get(objectId);
    if (!source) {
      throw new Error(`UpdateObjectCommand: no object "${objectId}" exists in the scene to update.`);
    }
    this.previous = structuredClone(source);
    this.id = `update-${objectId}-${Date.now()}`;
    this.label = `Update ${next.type}`;
    this.kind = next.type;
  }

  do(scene: SceneGraph): void {
    scene.update(this.next);
  }

  undo(scene: SceneGraph): void {
    scene.update(this.previous);
  }
}
