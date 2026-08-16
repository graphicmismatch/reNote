import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom has no ResizeObserver, and `PageEditorView` constructs one to keep the canvas sized to
// its container. Nothing in a jsdom test lays anything out, so an inert stub is the whole
// requirement — a test that needs real resize callbacks would have to drive them itself.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
