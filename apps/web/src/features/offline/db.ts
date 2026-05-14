import type { OfflineQueueItem, SmartFormLocalDraft, StarterFormLocalDraft } from "./types";

const DB_NAME = "timiq-offline-v1";
const DB_VERSION = 2;

export const STORE_QUEUE = "queue";
export const STORE_STARTER_DRAFTS = "starter_drafts";
export const STORE_SMART_FORM_DRAFTS = "smart_form_drafts";

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openTimiqOfflineDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available in this environment."));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const openReq = indexedDB.open(DB_NAME, DB_VERSION);
      openReq.onupgradeneeded = () => {
        const db = openReq.result;
        if (!db.objectStoreNames.contains(STORE_QUEUE)) {
          const q = db.createObjectStore(STORE_QUEUE, { keyPath: "id" });
          q.createIndex("by_user", "user_id", { unique: false });
          q.createIndex("by_status", "status", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_STARTER_DRAFTS)) {
          db.createObjectStore(STORE_STARTER_DRAFTS, { keyPath: "user_id" });
        }
        if (!db.objectStoreNames.contains(STORE_SMART_FORM_DRAFTS)) {
          const s = db.createObjectStore(STORE_SMART_FORM_DRAFTS, { keyPath: "draft_key" });
          s.createIndex("by_user", "user_id", { unique: false });
        }
      };
      openReq.onsuccess = () => resolve(openReq.result);
      openReq.onerror = () => reject(openReq.error ?? new Error("Could not open IndexedDB."));
    });
  }
  return dbPromise;
}

export async function clearAllTimiqOfflineData(): Promise<void> {
  if (typeof indexedDB === "undefined") {
    return;
  }
  try {
    const db = await openTimiqOfflineDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_QUEUE, STORE_STARTER_DRAFTS, STORE_SMART_FORM_DRAFTS], "readwrite");
      tx.objectStore(STORE_QUEUE).clear();
      tx.objectStore(STORE_STARTER_DRAFTS).clear();
      if (db.objectStoreNames.contains(STORE_SMART_FORM_DRAFTS)) {
        tx.objectStore(STORE_SMART_FORM_DRAFTS).clear();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

export async function idbGetAllQueueForUser(userId: string): Promise<OfflineQueueItem[]> {
  const db = await openTimiqOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, "readonly");
    const req = tx.objectStore(STORE_QUEUE).index("by_user").getAll(userId);
    req.onsuccess = () => resolve((req.result ?? []) as OfflineQueueItem[]);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPutQueueItem(item: OfflineQueueItem): Promise<void> {
  const db = await openTimiqOfflineDb();
  const tx = db.transaction(STORE_QUEUE, "readwrite");
  await reqToPromise(tx.objectStore(STORE_QUEUE).put(item));
  await txComplete(tx);
}

export async function idbDeleteQueueItem(id: string): Promise<void> {
  const db = await openTimiqOfflineDb();
  const tx = db.transaction(STORE_QUEUE, "readwrite");
  await reqToPromise(tx.objectStore(STORE_QUEUE).delete(id));
  await txComplete(tx);
}

export async function idbGetStarterDraft(userId: string): Promise<StarterFormLocalDraft | null> {
  const db = await openTimiqOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STARTER_DRAFTS, "readonly");
    const req = tx.objectStore(STORE_STARTER_DRAFTS).get(userId);
    req.onsuccess = () => resolve((req.result as StarterFormLocalDraft | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPutStarterDraft(draft: StarterFormLocalDraft): Promise<void> {
  const db = await openTimiqOfflineDb();
  const tx = db.transaction(STORE_STARTER_DRAFTS, "readwrite");
  await reqToPromise(tx.objectStore(STORE_STARTER_DRAFTS).put(draft));
  await txComplete(tx);
}

export async function idbDeleteStarterDraft(userId: string): Promise<void> {
  const db = await openTimiqOfflineDb();
  const tx = db.transaction(STORE_STARTER_DRAFTS, "readwrite");
  await reqToPromise(tx.objectStore(STORE_STARTER_DRAFTS).delete(userId));
  await txComplete(tx);
}

function smartFormDraftKey(userId: string, templateId: string): string {
  return `${userId}::${templateId}`;
}

export async function idbGetSmartFormDraft(
  userId: string,
  templateId: string,
): Promise<SmartFormLocalDraft | null> {
  const db = await openTimiqOfflineDb();
  if (!db.objectStoreNames.contains(STORE_SMART_FORM_DRAFTS)) {
    return null;
  }
  const key = smartFormDraftKey(userId, templateId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SMART_FORM_DRAFTS, "readonly");
    const req = tx.objectStore(STORE_SMART_FORM_DRAFTS).get(key);
    req.onsuccess = () => resolve((req.result as SmartFormLocalDraft | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPutSmartFormDraft(draft: SmartFormLocalDraft): Promise<void> {
  const db = await openTimiqOfflineDb();
  if (!db.objectStoreNames.contains(STORE_SMART_FORM_DRAFTS)) {
    return;
  }
  const tx = db.transaction(STORE_SMART_FORM_DRAFTS, "readwrite");
  await reqToPromise(tx.objectStore(STORE_SMART_FORM_DRAFTS).put(draft));
  await txComplete(tx);
}

export async function idbDeleteSmartFormDraft(userId: string, templateId: string): Promise<void> {
  const db = await openTimiqOfflineDb();
  if (!db.objectStoreNames.contains(STORE_SMART_FORM_DRAFTS)) {
    return;
  }
  const tx = db.transaction(STORE_SMART_FORM_DRAFTS, "readwrite");
  await reqToPromise(tx.objectStore(STORE_SMART_FORM_DRAFTS).delete(smartFormDraftKey(userId, templateId)));
  await txComplete(tx);
}
