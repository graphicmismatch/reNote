import { EventBus, type PageObjectId } from "@renote/core";

export interface SelectionEvents extends Record<string, unknown> {
  changed: readonly PageObjectId[];
}

export class SelectionManager {
  readonly events = new EventBus<SelectionEvents>();
  private selected = new Set<PageObjectId>();

  set(ids: readonly PageObjectId[]): void {
    this.selected = new Set(ids);
    this.events.emit("changed", this.selectedIds);
  }

  add(id: PageObjectId): void {
    this.selected.add(id);
    this.events.emit("changed", this.selectedIds);
  }

  remove(id: PageObjectId): void {
    if (!this.selected.has(id)) return;
    this.selected.delete(id);
    this.events.emit("changed", this.selectedIds);
  }

  /** Adds `id` if not selected, removes it if it is — shift-click multi-select. */
  toggle(id: PageObjectId): void {
    if (this.selected.has(id)) {
      this.remove(id);
    } else {
      this.add(id);
    }
  }

  clear(): void {
    if (this.selected.size === 0) return;
    this.selected.clear();
    this.events.emit("changed", this.selectedIds);
  }

  get selectedIds(): readonly PageObjectId[] {
    return Array.from(this.selected);
  }

  isSelected(id: PageObjectId): boolean {
    return this.selected.has(id);
  }
}
