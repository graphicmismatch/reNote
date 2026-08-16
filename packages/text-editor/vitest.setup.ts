// jsdom does not implement layout, so a few DOM APIs that prosemirror-view
// touches for coordinate math (never for correctness in these tests) need
// narrow no-op polyfills. Without these, mounting an EditorView under jsdom
// throws.
Range.prototype.getClientRects = () => {
  return {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  } as unknown as DOMRectList;
};

Range.prototype.getBoundingClientRect = () => new DOMRect();
