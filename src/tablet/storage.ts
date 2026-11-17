/**
 * The tablet's own small storage (a separate browser database with its own name; it shares nothing with Ledger). A plain key-value store so the
 * retrieval logic can be tested with a memory copy. Values may include a CryptoKey: browsers can store a non-extractable key in IndexedDB, which
 * stops a script from copying the key's bytes. That does NOT protect against a person using the unlocked tablet (the app, which they can open,
 * can still use the key), and it does not survive clearing the browser's site data: the display must then be paired again.
 */
export interface KeyValue {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  clear(): Promise<void>;
}

export function memoryKv(): KeyValue {
  const m = new Map<string, unknown>();
  return {
    get: async <T,>(k: string) => m.get(k) as T | undefined,
    set: async (k, v) => void m.set(k, v),
    del: async (k) => void m.delete(k),
    clear: async () => m.clear(),
  };
}

const STORE = 'kv';
export function idbKv(name = 'ledger-display-tablet'): KeyValue {
  let opened: Promise<IDBDatabase> | null = null;
  const open = () => (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { opened = null; reject(r.error ?? new Error('storage unavailable')); };
  }));
  const run = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = f(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('storage error'));
      tx.onabort = () => reject(tx.error ?? new Error('storage error'));
    });
  };
  return {
    get: <T,>(k: string) => run<T | undefined>('readonly', (s) => s.get(k) as IDBRequest<T | undefined>),
    set: async (k, v) => void (await run('readwrite', (s) => s.put(v, k))),
    del: async (k) => void (await run('readwrite', (s) => s.delete(k))),
    clear: async () => void (await run('readwrite', (s) => s.clear())),
  };
}
