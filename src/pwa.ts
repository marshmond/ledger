/** Registers the offline service worker (production builds only) and asks the browser to protect stored data. */
export function startPwa() {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        /* offline support is a convenience; the app works without it */
      });
    });
  }
  // Without this, a phone may clear this site's data when storage runs low. Not every browser grants it.
  navigator.storage?.persist?.().catch(() => undefined);
}

export interface StorageStatus {
  persisted: boolean | null;
  usedBytes: number | null;
}

export async function storageStatus(): Promise<StorageStatus> {
  let persisted: boolean | null = null;
  let usedBytes: number | null = null;
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? null;
    usedBytes = (await navigator.storage?.estimate?.())?.usage ?? null;
  } catch {
    /* unsupported */
  }
  return { persisted, usedBytes };
}
