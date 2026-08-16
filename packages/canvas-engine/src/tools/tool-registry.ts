import type { Tool } from "./tool.js";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private activeTool: Tool | null = null;

  register(tool: Tool): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool "${tool.id}" is already registered.`);
    }
    this.tools.set(tool.id, tool);
  }

  activate(toolId: string): void {
    const next = this.tools.get(toolId);
    if (!next) {
      throw new Error(`No tool registered for "${toolId}".`);
    }
    this.activeTool?.onCancel();
    this.activeTool = next;
  }

  get active(): Tool | null {
    return this.activeTool;
  }

  get registeredToolIds(): readonly string[] {
    return Array.from(this.tools.keys());
  }
}
