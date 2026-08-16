import { describe, expect, it } from "vitest";
import { CommandStack } from "./command-stack.js";

interface CounterState {
  value: number;
}

function increment(by: number) {
  return {
    id: `inc-${by}-${Math.random()}`,
    label: `+${by}`,
    kind: "counter",
    do: (state: CounterState) => {
      state.value += by;
    },
    undo: (state: CounterState) => {
      state.value -= by;
    },
  };
}

describe("CommandStack", () => {
  it("applies commands and supports undo/redo", () => {
    const state: CounterState = { value: 0 };
    const stack = new CommandStack(state);

    stack.execute(increment(1));
    stack.execute(increment(2));
    expect(state.value).toBe(3);

    stack.undo();
    expect(state.value).toBe(1);

    stack.redo();
    expect(state.value).toBe(3);
  });

  it("jumps directly to an arbitrary history entry, like clicking a Paint.NET history row", () => {
    const state: CounterState = { value: 0 };
    const stack = new CommandStack(state);

    stack.execute(increment(1)); // index 0 -> value 1
    stack.execute(increment(2)); // index 1 -> value 3
    stack.execute(increment(4)); // index 2 -> value 7

    stack.jumpTo(0);
    expect(state.value).toBe(1);
    expect(stack.pointerIndex).toBe(0);

    stack.jumpTo(2);
    expect(state.value).toBe(7);

    stack.jumpTo(-1);
    expect(state.value).toBe(0);
  });

  it("truncates the redo tail when a new command is executed after jumping back", () => {
    const state: CounterState = { value: 0 };
    const stack = new CommandStack(state);

    stack.execute(increment(1));
    stack.execute(increment(2));
    stack.execute(increment(4));
    stack.jumpTo(0);

    stack.execute(increment(100));

    expect(state.value).toBe(101);
    expect(stack.history).toHaveLength(2);
    expect(stack.canRedo).toBe(false);
  });

  it("rejects out-of-range jumpTo indices", () => {
    const stack = new CommandStack<CounterState>({ value: 0 });
    stack.execute(increment(1));

    expect(() => stack.jumpTo(5)).toThrow(RangeError);
    expect(() => stack.jumpTo(-2)).toThrow(RangeError);
  });

  it("caps retained history depth, dropping the oldest entries first", () => {
    const state: CounterState = { value: 0 };
    const stack = new CommandStack(state, { maxHistoryEntries: 3 });

    for (let i = 1; i <= 5; i += 1) {
      stack.execute(increment(1));
    }

    expect(state.value).toBe(5);
    expect(stack.history).toHaveLength(3);
    expect(stack.pointerIndex).toBe(2);
  });

  it("emits a changed event with the current entries and pointer on every mutation", () => {
    const state: CounterState = { value: 0 };
    const stack = new CommandStack(state);
    const seen: number[] = [];
    stack.events.on("changed", (snapshot) => seen.push(snapshot.pointer));

    stack.execute(increment(1));
    stack.execute(increment(1));
    stack.undo();

    expect(seen).toEqual([0, 1, 0]);
  });
});
