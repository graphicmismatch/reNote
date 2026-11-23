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

// jsdom's Blob predates `.text()`/`.arrayBuffer()`, which every target browser has.
const readBlob = (blob: Blob, as: "readAsText" | "readAsArrayBuffer") =>
  new Promise<string | ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result!);
    reader.onerror = () => reject(reader.error);
    reader[as](blob);
  });
Blob.prototype.text ??= function (this: Blob) {
  return readBlob(this, "readAsText") as Promise<string>;
};
Blob.prototype.arrayBuffer ??= function (this: Blob) {
  return readBlob(this, "readAsArrayBuffer") as Promise<ArrayBuffer>;
};
