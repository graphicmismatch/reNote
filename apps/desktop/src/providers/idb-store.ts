import type { ClientStore, StoredAsset, StateSnapshot } from "./browser-storage-client.js";

// Local-first persistence in IndexedDB: one "state" record holding every notebook/section/page
// (rewritten whole on each change) and one record per asset (images/audio are written once).
// ponytail: whole-state rewrite per mutation — fine for thousands of pages; switch to
// per-record puts with dirty tracking if large workspaces make saves slow.

const DB_NAME = "renote";
const STATE_KEY = "main";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  const open = indexedDB.open(DB_NAME, 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore("state");
    open.result.createObjectStore("assets");
  };
  return request(open);
}

export async function openIdbStore(): Promise<ClientStore> {
  // Without this, the browser may evict the whole database under storage pressure.
  void navigator.storage?.persist?.();

  const db = await openDb();
  const read = db.transaction(["state", "assets"], "readonly");
  const state = (await request(read.objectStore("state").get(STATE_KEY))) as StateSnapshot | undefined;
  const assetStore = read.objectStore("assets");
  const [keys, values] = await Promise.all([request(assetStore.getAllKeys()), request(assetStore.getAll())]);
  const assets = new Map(keys.map((key, i) => [String(key), values[i] as StoredAsset]));

  const reportFailure = (error: unknown) => {
    console.error("Failed to save to local storage.", error);
    window.alert("reNote couldn't save your last change to this device's storage. Is the disk full?");
  };
  const write = (storeName: string, fn: (store: IDBObjectStore) => void) => {
    const tx = db.transaction(storeName, "readwrite");
    fn(tx.objectStore(storeName));
    tx.onerror = () => reportFailure(tx.error);
  };

  return {
    state: state ?? null,
    assets,
    // `put` structured-clones synchronously, so the snapshot is consistent even though the
    // client keeps mutating its live objects right after this returns.
    saveState: (snapshot) => write("state", (store) => store.put(snapshot, STATE_KEY)),
    putAsset: (path, asset) => write("assets", (store) => store.put(asset, path)),
    deleteAsset: (path) => write("assets", (store) => store.delete(path)),
  };
}
