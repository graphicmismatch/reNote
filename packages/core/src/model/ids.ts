/** Branded string IDs so a NotebookId can't be passed where a PageId is expected. */
export type NotebookId = string & { readonly __brand: "NotebookId" };
export type SectionGroupId = string & { readonly __brand: "SectionGroupId" };
export type SectionId = string & { readonly __brand: "SectionId" };
export type PageId = string & { readonly __brand: "PageId" };
export type TagId = string & { readonly __brand: "TagId" };
export type PageObjectId = string & { readonly __brand: "PageObjectId" };

export function newId<T extends string>(): T {
  return crypto.randomUUID() as T;
}
