import { useLiveQuery } from 'dexie-react-hooks';
import { acceptableAttention, type AttentionItem, type AttentionRead, type AttentionSource } from './attention';

/**
 * Builds a module's `contributes.attention` from a plain async reader. The reader calls the module's EXISTING loader (the same one its Today card or
 * Overview page uses) and maps what comes back to items; it never writes. It re-runs by itself when any table it read changes (the same live query the
 * Today cards use). A read that throws is reported as `failed` with no items, so one module can never hide the others or show a made-up zero.
 */
export function liveAttention(moduleId: string, read: (today: string) => Promise<AttentionItem[]>): AttentionSource {
  return {
    useItems(today: string): AttentionRead {
      const r = useLiveQuery(async () => {
        try { return { items: acceptableAttention(moduleId, await read(today)), failed: false }; } catch (e) { console.error(`Needs you: ${moduleId} could not be read`, e); return { items: [] as AttentionItem[], failed: true }; }
      }, [today]);
      return r ? { items: r.items, ready: true, failed: r.failed } : { items: [], ready: false };
    },
  };
}
