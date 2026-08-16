type Listener<TPayload> = (payload: TPayload) => void;

/** Minimal typed pub/sub used across packages so cross-cutting concerns (e.g. UI reacting to
 *  canvas-engine changes) don't require a direct dependency between those packages. */
export class EventBus<TEvents extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof TEvents, Set<Listener<unknown>>>();

  on<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as Listener<unknown>);
    this.listeners.set(event, set);
    return () => this.off(event, listener);
  }

  off<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<unknown>);
  }

  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }
}
