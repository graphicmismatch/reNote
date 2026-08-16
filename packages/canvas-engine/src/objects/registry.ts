import type { ObjectTypeDefinition } from "./object-type-definition.js";

/**
 * Maps object-type string -> its behavior. This is what replaces a giant
 * switch statement: every consumer (renderer, hit-tester, serializer) looks
 * a type up here instead of branching on it directly.
 */
export class ObjectTypeRegistry {
  private readonly definitions = new Map<string, ObjectTypeDefinition<string, unknown>>();

  register<TType extends string, TData>(definition: ObjectTypeDefinition<TType, TData>): void {
    if (this.definitions.has(definition.type)) {
      throw new Error(`Object type "${definition.type}" is already registered.`);
    }
    this.definitions.set(definition.type, definition as ObjectTypeDefinition<string, unknown>);
  }

  get(type: string): ObjectTypeDefinition<string, unknown> {
    const definition = this.definitions.get(type);
    if (!definition) {
      throw new Error(`No object type registered for "${type}".`);
    }
    return definition;
  }

  has(type: string): boolean {
    return this.definitions.has(type);
  }

  get registeredTypes(): readonly string[] {
    return Array.from(this.definitions.keys());
  }
}
