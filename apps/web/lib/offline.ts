/**
 * P1 safety boundary: offline writes are intentionally disabled until device
 * binding, protected storage, tenant/session expiry, logout cleanup and safe
 * replay semantics are implemented and independently tested.
 *
 * `disableLegacyOfflineQueue` removes queued request bodies left by earlier
 * versions so they cannot be replayed under a new login or tenant context.
 * The caller receives the number of removed operations so the UI can warn the
 * user that those changes were not synchronized.
 */
export type OfflineOperation = { id: string; url: string; method: string; body: unknown; createdAt: string; retries: number };
const DB = 'clinai-offline-v1';
const STORE = 'operations';

function openLegacyDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function disableLegacyOfflineQueue(): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  const db = await openLegacyDb();
  if (!db) return 0;
  let count = 0;
  try {
    count = await new Promise<number>((resolve, reject) => {
      if (!db.objectStoreNames.contains(STORE)) return resolve(0);
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).count();
      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Offline queue database is still open in another tab.'));
  });
  return count;
}

/** Refuses to persist clinical writes on a browser device. */
export async function enqueueOperation(_op: Omit<OfflineOperation, 'id' | 'createdAt' | 'retries'>): Promise<boolean> {
  await disableLegacyOfflineQueue();
  return false;
}

/** There are no replayable operations in the P1 build. */
export async function pendingOperations(): Promise<OfflineOperation[]> {
  await disableLegacyOfflineQueue();
  return [];
}

/** Refuses to replay requests from local browser storage. */
export async function flushOperations(_token: string): Promise<number> {
  await disableLegacyOfflineQueue();
  return 0;
}
