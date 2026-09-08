/**
 * idbStorage.ts
 *
 * High-capacity IndexedDB storage wrapper for large inventory datasets (10MB - 100MB+),
 * eliminating browser 5MB localStorage QuotaExceededError crashes.
 */

const DB_NAME = 'SpareShareDB';
const DB_VERSION = 1;
const STORE_NAME = 'inventory_store';
const INVENTORY_KEY = 'spareshare_inventory';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment'));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Saves inventory array to IndexedDB asynchronously.
 */
export async function setStoredInventory(parts: any[]): Promise<void> {
  if (!parts || !Array.isArray(parts)) return;

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(parts, INVENTORY_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[IDB] Failed to save inventory to IndexedDB, attempting localStorage fallback:', err);
    try {
      localStorage.setItem('spareshare_inventory', JSON.stringify(parts));
    } catch (e) {
      console.warn('[Storage Fallback] localStorage quota exceeded:', e);
    }
  }
}

/**
 * Reads inventory array from IndexedDB asynchronously.
 */
export async function getStoredInventory(): Promise<any[] | null> {
  try {
    const db = await openDB();
    const result = await new Promise<any>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(INVENTORY_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (result && Array.isArray(result) && result.length > 0) {
      return result;
    }
  } catch (err) {
    console.warn('[IDB] IndexedDB read failed, trying localStorage fallback:', err);
  }

  // Fallback to localStorage
  try {
    const local = localStorage.getItem('spareshare_inventory');
    return local ? JSON.parse(local) : null;
  } catch (e) {
    return null;
  }
}
