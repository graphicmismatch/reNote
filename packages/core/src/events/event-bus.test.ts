import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./event-bus.js";

describe("EventBus", () => {
  it("delivers emitted payloads to subscribed listeners", () => {
    const bus = new EventBus<{ ping: { count: number } }>();
    const listener = vi.fn();
    bus.on("ping", listener);

    bus.emit("ping", { count: 1 });

    expect(listener).toHaveBeenCalledWith({ count: 1 });
  });

  it("stops delivering events after unsubscribe", () => {
    const bus = new EventBus<{ ping: number }>();
    const listener = vi.fn();
    const unsubscribe = bus.on("ping", listener);

    unsubscribe();
    bus.emit("ping", 1);

    expect(listener).not.toHaveBeenCalled();
  });
});
