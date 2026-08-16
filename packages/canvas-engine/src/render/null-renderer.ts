import type { PageBackground, PageObject } from "@renote/core";
import type { ObjectTypeRegistry } from "../objects/registry.js";
import type { RendererInterface } from "./renderer-interface.js";

/** No-op renderer used by tests and any headless context (CI, tool-registry logic, etc). */
export class NullRenderer implements RendererInterface {
  private container: HTMLElement | null = null;

  mount(container: HTMLElement, _objectTypes: ObjectTypeRegistry): void {
    this.container = container;
  }

  /** No real canvas exists here — `container` itself is the closest stand-in, matching this
   *  class's existing "no-op, just enough to keep PageEngine's pointer-dispatcher wiring happy"
   *  role (see `RendererInterface.getInteractionElement`'s doc comment for why a real renderer
   *  hands back its canvas specifically, not its container — that distinction has nothing to
   *  test against here since `NullRenderer` never renders a DOM overlay on top of anything). */
  getInteractionElement(): HTMLElement {
    return this.container ?? document.createElement("div");
  }

  resize(_width: number, _height: number): void {
    // intentionally no-op
  }

  setCamera(_x: number, _y: number, _zoom: number): void {
    // intentionally no-op
  }

  syncObject(_object: PageObject): void {
    // intentionally no-op
  }

  removeObject(_objectId: string): void {
    // intentionally no-op
  }

  setBackground(_background: PageBackground): void {
    // intentionally no-op
  }

  dispose(): void {
    // intentionally no-op
  }
}
