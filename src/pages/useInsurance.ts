import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Policy } from '../lib/protection';

/** Insurance policies you have entered (stored with your other settings, so they are in backups). */
export function useInsurance() {
  const row = useLiveQuery(() => db.settings.get('insurance'), []);
  const policies = ((row?.value as Policy[] | undefined) ?? []).filter((p) => p && typeof p.id === 'string');
  const save = (list: Policy[]) => db.settings.put({ key: 'insurance', value: list });
  return {
    policies,
    add: (p: Policy) => save([...policies, p]),
    update: (id: string, patch: Partial<Policy>) => save(policies.map((p) => (p.id === id ? { ...p, ...patch } : p))),
    remove: (id: string) => save(policies.filter((p) => p.id !== id)),
  };
}
