// Browser-local recovery snapshots. No passwords/tokens and no server writes.
// Isolated by browser origin, signed-in user, authoring surface, and automation ID.
export interface DraftSnapshot<T> {
  key: string;
  baseline: string; // JSON snapshot of server version at editor-open
  payload: T;
  savedAt: number;
}

const DB_NAME = "aeolus-automation-drafts";
const STORE_NAME = "snapshots";

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function transaction<R>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, resolve: (value: R) => void) => void): Promise<R> {
  const db = await openDraftDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    let result: R;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    tx.oncomplete = () => { db.close(); resolve(result); };
    operation(tx.objectStore(STORE_NAME), (value) => { result = value; });
  });
}

export function readAutomationDraft<T>(key: string): Promise<DraftSnapshot<T> | undefined> {
  return transaction("readonly", (store, done) => {
    const req = store.get(key);
    req.onsuccess = () => done(req.result as DraftSnapshot<T> | undefined);
  });
}
// Serialize writes and deletes for the same key. A save acknowledgement must not
// race an in-flight IndexedDB put and accidentally resurrect a cleared draft.
const queued = new Map<string, Promise<void>>();
function sequence(key: string, operation: () => Promise<void>): Promise<void> {
  const previous = queued.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  queued.set(key, next);
  void next.finally(() => { if (queued.get(key) === next) queued.delete(key); }).catch(() => undefined);
  return next;
}
export function putAutomationDraft<T>(draft: DraftSnapshot<T>): Promise<void> {
  return sequence(draft.key, () => transaction("readwrite", (store, done) => { store.put(draft); done(); }));
}
export function deleteAutomationDraft(key: string): Promise<void> {
  return sequence(key, () => transaction("readwrite", (store, done) => { store.delete(key); done(); }));
}
